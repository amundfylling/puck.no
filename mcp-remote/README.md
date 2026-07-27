# puck-no-mcp-remote — MCP over HTTP (telefon-tilgang)

Ekstern MCP-server for puck.no-administrasjon, deployet som en Cloudflare
Worker. Gjør alle verktøyene fra den lokale MCP-serveren (`mcp/`) tilgjengelige
fra f.eks. Claude-appen på telefonen — uten lokal maskin, git-klone eller
wrangler-økt.

```
Telefon (Claude connector)
   │  HTTPS, MCP Streamable HTTP + OAuth 2.1 (PKCE)
   ▼
puck-no-mcp.workers.dev
   ├─ OAuth: GitHub-innlogging → collaborator-sjekk på repoet (som CMS-et)
   ├─ D1-binding: påmeldingsverktøy mot den levende databasen
   └─ GitHub API (PAT): innholdsverktøy committer rett til main (som CMS-et)
```

## Sikkerhetsmodell

- **Innlogging:** OAuth 2.1 med PKCE (S256). Brukeren logger inn med GitHub;
  **kun collaborators på `amundfylling/puck.no` får tilgang** — samme
  tillitsmodell som Sveltia CMS.
- **Tokens:** HMAC-signerte, uten serverlagring. Autorisasjonskode 5 min,
  tilgangstoken 30 dager (ny innlogging kreves etterpå — bevisst valg).
- **All skriving logges** (bruker, verktøy, argumenter — maskert) til
  Workers-loggene = revisjonsspor.
- **PII:** e-post/telefon maskeres i all output. `export_registrations`
  finnes IKKE her — full eksport gjøres i nettleser via den
  Access-beskyttede `/admin/pameldinger`.
- **Revokasjon:** fjern brukeren som collaborator → ingen nye tokens.
  Roter `MCP_TOKEN_SECRET` → alle utstedte tokens ugyldiggjøres øyeblikkelig.
- Bevisst utelatt: `site_health` (kan ikke kjøre bygg fra en Worker — bruk
  den lokale MCP-serveren).

## Oppsett (engang, ~15 min)

### 1. GitHub OAuth-app (innlogging)

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

- Application name: `puck.no MCP admin`
- Homepage URL: `https://puck-no-mcp.<DITT-SUBDOMENE>.workers.dev`
- Authorization callback URL: `https://puck-no-mcp.<DITT-SUBDOMENE>.workers.dev/callback`

*(Subdomenet ditt ser du i Cloudflare-dashbordet under Workers, eller kjør
først `npx wrangler deploy` én gang uten secrets for å få URL-en.)*

Kopier **Client ID** og generer en **Client Secret**.

### 2. GitHub-token (PAT) for repo-skriving

GitHub → **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**:

- Repository access: **Only select repositories** → `amundfylling/puck.no`
- Permissions: **Contents: Read and write** (Metadata: read kommer automatisk)
- Expiration: gjerne 90 dager (sett deg en påminnelse om fornyelse)

### 3. Secrets + deploy

```bash
cd mcp-remote
npm install
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID      # lim inn fra steg 1
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET  # lim inn fra steg 1
npx wrangler secret put GITHUB_TOKEN                # lim inn fra steg 2
npx wrangler secret put MCP_TOKEN_SECRET            # generer: openssl rand -hex 32
npx wrangler deploy
```

Test: `curl https://puck-no-mcp.<sub>.workers.dev/health` → `{"ok":true}`.
Og `curl -i .../mcp` skal gi `401` med `WWW-Authenticate`-header.

### 4. Koble til fra telefonen (Claude-appen)

1. Claude-appen → **Settings → Connectors → Add custom connector**
2. URL: `https://puck-no-mcp.<sub>.workers.dev/mcp` → **Add**
3. Trykk **Connect** → du sendes til GitHub-innlogging → **Authorize**
4. Ferdig — be om f.eks. «list tournaments» eller «close registration
   for norway-open-2026» i en samtale med connectoren aktivert.

Fungerer også fra Claude Desktop og andre MCP-klienter med OAuth-støtte
(samme URL; flyten er identisk).

## Verktøy (19)

Som den lokale serveren (`mcp/README.md`), minus `export_registrations`
(bruk `/admin/pameldinger` i nettleser) og `site_health` (lokalt verktøy):

- **Turneringer:** list, create, update, duplicate, close/open registration, archive
- **Påmeldinger (live D1):** list, count, add, delete (dry-run standard),
  update, move, sync_participant_snapshot, ranking_lookup
- **Innhold:** create_news_post (forsidebilde via URL), add_timer (MP3-URL),
  add_arsmote_document (PDF-URL)
- **Drift:** deploy_status

Merknader mot lokalversjonen: innholdsverktøy committer **rett til main**
(som CMS-et — ingen PR-flyt her), og filopplasting skjer via **direkte-URL**
(Workeren henter fila) i stedet for lokale filstier.

## Drift

- **Logger / revisjon:** Cloudflare → Workers & Pages → puck-no-mcp →
  Logs (eller `npx wrangler tail` — viser `tool_call`-hendelser per bruker).
- **Forny PAT (steg 2) før den utløper** — ellers feiler alle
  innholdsverktøy med 401 fra GitHub.
- **Kostnad:** innenfor Workers gratisplan (100 000 req/dag) for normal
  forbruksmønster. D1-bindingen deler kvote med nettsiden.
- **Lokal utvikling:** `npm run dev` (wrangler dev) — bruk
  `.dev.vars` for secrets lokalt (GIT-IGNORED — aldri commit!).
- **Tester:** `npm test` (16 enhetstester: krypto, PKCE, OAuth-flyt,
  MCP-ruting, D1-verktøy med falsk database).
