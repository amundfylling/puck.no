# LAUNCH.md — lanseringsrunbook for puck.no

Denne guiden tar deg fra null til lansert nettside, steg for steg. Den er
skrevet for deg som **ikke har gjort dette før**. Du trenger bare en
nettleser (og to korte terminalkommandoer på Amunds maskin for database-seed).

**Strategi:** Først publiserer vi alt på et gratis Cloudflare-domene
(`puck-no.pages.dev`) og tester at alt virker. Deretter flytter vi
`puck.no` over. Den gamle Wix-siden røres ikke før helt til slutt.

**Tidsbruk:** ca. 1–2 timer totalt, fordelt på korte økter.

---

## Del 0 — Kontoer du trenger

1. **Cloudflare-konto** (gratis): https://dash.cloudflare.com/sign-up
2. **GitHub-konto** med tilgang til repoet
   https://github.com/amundfylling/puck.no (allerede på plass)

---

# STEG A — Publiser på gratis pages.dev-domene

## A1. Koble repoet til Cloudflare Pages

1. Logg inn på https://dash.cloudflare.com
2. Velg **Workers & Pages** i venstremenyen → **Create** → **Pages** →
   **Connect to Git**.
3. Godkjenn Cloudflares GitHub-app og velg repoet **amundfylling/puck.no**.
4. Bygginnstillinger:
   - **Project name:** `puck-no` (gir domenet `puck-no.pages.dev`)
   - **Production branch:** `main`
   - **Framework preset:** `Astro`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Under **Environment variables (advanced)**, legg inn:
   - `NODE_VERSION` = `24`  *(viktig — Astro 7 krever Node ≥ 22)*
6. Trykk **Save and Deploy**. Første bygg tar 3–6 minutter.
   - Feiler bygget? Sjekk at `NODE_VERSION=24` er satt, og les byggloggen.

Når bygget er grønt har du et nettsted på
**https://puck-no.pages.dev** — åpne det og klikk litt rundt.

## A2. Lag D1-databasen (påmeldinger)

1. I Cloudflare-dashbordet: **Workers & Pages** → **D1 SQL Database** →
   **Create**.
2. Navn: `puck-no` → **Create**.
3. På databasesiden står **Database ID** (en lang ID). Kopier den.
4. Lim ID-en inn i `wrangler.toml` i repoet (erstatt
   `00000000-0000-0000-0000-000000000000`). Enkleste måte:
   GitHub → repoet → `wrangler.toml` → blyant-ikonet → erstatt →
   **Commit changes**. *(ID-en er ikke hemmelig, så den kan ligge i repoet.)*
5. Kjør migrering + seed (på Amunds maskin, i repo-mappen):
   ```bash
   export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
   npx wrangler login          # åpner nettleser — logg inn og trykk Allow
   npx wrangler d1 migrations apply puck-no --remote
   npx wrangler d1 execute puck-no --remote --command="SELECT COUNT(*) AS registrations FROM registrations"
   # FORTSETT BARE hvis tallet over er 0 (helt ny/tom database).
   puck_seed_sql="$(mktemp "${TMPDIR:-/tmp}/puck-seed.XXXXXX")"
   chmod 600 "$puck_seed_sql"
   trap 'rm -f "$puck_seed_sql"' EXIT
   node scripts/seed-d1.mjs --replace --allow-delete > "$puck_seed_sql"
   npx wrangler d1 execute puck-no --remote --file="$puck_seed_sql"
   rm -f "$puck_seed_sql"
   trap - EXIT
   ```
   `--replace --allow-delete` sletter alle eksisterende påmeldinger først og
   skal derfor **kun** brukes her, mot den bekreftet nye/tomme databasen. SQL-
   filen inneholder ekte kontaktdata; `mktemp` + `chmod 600` holder den privat,
   og den slettes straks etterpå.
   Kjør alltid **alle** ventende migreringer før ny kode går live. I tillegg
   til ranking-feltene oppretter `0006` engangskoder for MCP-innlogging og
   `0007` den umiddelbare, fail-closed stengingen av påmelding.
   *(Alternativ uten terminal: åpne databasen i dashboardet → fanen
   **Console** → lim inn innholdet i hver fil under `migrations/` i
   nummerrekkefølge, deretter innholdet i seed-filen. Seed-filen inneholder
   ekte e-poster — ikke del
   den andre steder.)*

## A3. Slå på Turnstile (robot-sperre i påmeldingsskjemaet)

1. I dashbordet: **Turnstile** (venstremeny) → **Add widget**.
2. **Widget name:** `puck.no påmelding`.
3. **Hostname:** `puck-no.pages.dev` *(vi legger til puck.no her i steg B)*
4. **Widget mode:** Managed. Trykk **Create**.
5. Du får **Site Key** og **Secret Key** — kopier begge.
6. Gå til Pages-prosjektet (**Workers & Pages** → **puck-no**) →
   **Settings** → **Variables and Secrets**, legg inn:
   - `PUBLIC_TURNSTILE_SITE_KEY` = Site Key (type **Plaintext**, gjelder
     "Production" og "Preview")
   - `TURNSTILE_SECRET_KEY` = Secret Key (type **Secret**)
7. Gå til **Deployments** → nyeste deployment → **⋮** → **Retry deployment**
   (site-nøkkelen bakes inn i HTML-en under bygg, så vi må bygge på nytt).

## A4. Test påmeldingen ende-til-ende

På https://puck-no.pages.dev:

1. Gå til **Turneringer** → **Norway Open 2026**.
2. Sjekk at «Påmeldte spillere» viser navn, klubb, land, rankingposisjon og
   ITHF-poeng, sortert med høyest poengsum først.
3. Registrer en testspiller (søk f.eks. «test» eller bruk «Jeg finner ikke
   navnet mitt») → forvent **«Takk for din registrering!»** og at spilleren
   dukker opp i listen.
4. Registrer samme spiller-ID igjen → forvent **«Spiller er allerede
   registrert!»**. I en lagturnering skal samme spiller heller ikke kunne
   registreres på to lag.
5. Slett testspilleren fra databasen (terminal):
   ```bash
   npx wrangler d1 execute puck-no --remote --command="DELETE FROM registrations WHERE email='din-test@epost.no';"
   ```

## A5. Sveltia CMS-innlogging (redigering for styret)

Følg de fire stegene i **sveltia-cms-auth**-oppsettet (samme som tidligere
beskrevet, men bruk pages.dev-domenet):

1. Deploy https://github.com/sveltia/sveltia-cms-auth med
   **Deploy to Cloudflare**-knappen. Kopier worker-URLen
   (`https://sveltia-cms-auth.<subdomene>.workers.dev`).
2. GitHub → **Settings** → **Developer settings** → **OAuth Apps** →
   **New OAuth App**:
   - Homepage URL: `https://puck-no.pages.dev`
   - Authorization callback URL: `<worker-URL>/callback`
   - Kopier **Client ID**, generer **Client Secret**.
3. Cloudflare → **Workers & Pages** → **sveltia-cms-auth** → **Settings** →
   **Variables and Secrets**:
   - `GITHUB_CLIENT_ID` (Text)
   - `GITHUB_CLIENT_SECRET` (**Secret**)
   - `ALLOWED_DOMAINS` = `puck-no.pages.dev` *(legg til puck.no i steg B)*
4. I repoet: rediger `public/admin/cms/config.yml` (blyant på GitHub) og sett
   `base_url: <worker-URL>` → **Commit changes**. Vent på at Pages bygger
   på nytt (2–4 min).
5. Test: gå til https://puck-no.pages.dev/admin/cms/ → **Logg inn med GitHub**
   → godkjenn → du skal se CMS-et med Nyheter, Turneringer osv.
   - Styremedlemmer må ha GitHub-konto og være lagt til som **collaborators**
     på repoet (GitHub → repo → **Settings** → **Collaborators** → invite).
   - Blank side? Sjekk at den avslappede CSP-en for `/admin/cms/*` ligger i
     `public/_headers` (den skal være der allerede).

## A6. Beskytt admin-sidene (Cloudflare Access)

CSV-eksporten inneholder e-poster og telefonnummer og må ikke være åpen.
Dette er **to uavhengige sperrer** (belte og bukseseler):

1. **I koden (allerede på plass):** `/api/admin/*` verifiserer signaturen,
   utstederen, utløpstiden og applikasjonens `aud` i Access-tokenet
   (`Cf-Access-Jwt-Assertion`). En vanlig e-postheader gir aldri tilgang.
   Endepunktet feiler lukket (`503`) frem til team-domene og AUD er satt.
   Adminportalen (`/admin/`) henter all sanntidsdata via API-et og er `noindex`.
   Alle skrivende kall krever dessuten JSON fra samme origin.
2. **Cloudflare Access (settes opp her):** en innloggingsside FORAN både
   `/admin/*` og `/api/admin/*`, slik at uvedkommende aldri når koden.

**⚠️ VIKTIG: Dette steget må være fullført FØR DNS-bytte i steg B** — ellers
ligger personopplysninger åpent på www.puck.no.

Slik setter du opp Cloudflare Access:

1. I dashbordet: **Zero Trust** (venstremeny). Første gang: velg team-navn
   (f.eks. `nbhf`) — det gir `nbhf.cloudflareaccess.com`.
2. **Access** → **Applications** → **Add an application** → **Self-hosted**:
   - **Application name:** `puck.no admin`
   - **Subdomain + Domain:** `puck-no.pages.dev`
   - **Path:** legg til BEGGE disse stiene i samme applikasjon:
     - `admin` (dekker `/admin` og `/admin/*`)
     - `api/admin` (dekker `/api/admin/*`)
   - **Policy (Allow):** velg *Emails* og legg inn e-postadressene til
     styremedlemmene som skal ha tilgang (f.eks. `amund.fylling@puck.no`).
   - **Login-metoder:** bruk standarden *One-time PIN* — styret skriver
     e-postadressen sin og får en engangskode på mail. Ingen passord.
3. Åpne applikasjonen igjen: **Access controls** → **Applications** →
   **Configure** → **Additional settings**, og kopier **Application Audience
   (AUD) Tag**. I Pages-prosjektet: **Settings** → **Variables and Secrets**,
   legg inn disse som vanlige variabler i Production og Preview:
   - `ACCESS_TEAM_NAME` = team-navnet (f.eks. `nbhf`)
   - `ACCESS_POLICY_AUD` = AUD-taggen du nettopp kopierte
   Kjør deretter **Retry deployment**. Begge må være satt; API-et feiler lukket
   hvis konfigurasjonen mangler eller tokenet gjelder en annen applikasjon.
4. Test i et **privat vindu**:
   - https://puck-no.pages.dev/admin/pameldinger → skal vise
     Cloudflare-innloggingssiden (engangskode på mail).
   - https://puck-no.pages.dev/api/admin/registrations.csv?slug=norway-open-2026
     UTEN innlogging → skal også vise Access-innlogging/avvisning, aldri CSV.
   - Etter innlogging: trykk **Last ned CSV** på en turnering → sjekk at
     filen åpnes i Excel/Numbers og har alle kolonner.
5. **Før DNS-bytte (steg B):** legg `www.puck.no` (og `puck.no`) til som
   domain i samme applikasjon — se steg B3 — og verifiser at sperren virker
   på www-domenet FØR du peker DNS om.

### Valgfritt: GITHUB_TOKEN (åpne/stenge-knappen i portalen)

Knappen «Åpen/Stengt» ved hver kommende turnering i adminportalen committer
frontmatter-endringen til main via GitHub API-et (samme mekanisme som
CMS-et). Uten token svarer endepunktet `503` og knappen viser en forklaring.

1. GitHub → **Settings** → **Developer settings** → **Personal access
   tokens** → **Tokens (classic)** → **Generate new token**:
   - **Scope:** `repo` (full kontroll — trengs for å committe).
   - Navn f.eks. `puck-no-pages`, utløpstid etter eget valg.
2. Pages → **puck-no** → **Settings** → **Variables and Secrets** →
   legg til `GITHUB_TOKEN` som **Secret** → retry deployment.
3. Test med en ekte, kommende turnering: «Steng» skal avvise nye API-kall med
   én gang, mens skjemaets visning synkroniseres ved neste bygg. «Åpne» kan
   aldri overstyre lukket frontmatter og er derfor helt synkronisert senest
   ved neste bygg. Commitet skal dukke opp i repo-historikken.

## A7. Slå på ukentlig rankingoppdatering

Rankingoppdateringen kjører i den eksterne admin-Workeren. Følg oppsettet i
`mcp-remote/README.md`, og deploy fra repoet:

```bash
cd mcp-remote
npm install
npx wrangler deploy
```

`mcp-remote/wrangler.toml` registrerer to UTC-cronforsøk hver onsdag. Workeren
sjekker Europe/Oslo-tid, slik at bare kjøringen kl. 03:00 gjør arbeid gjennom
hele året. Den oppdaterer bare kommende turneringer og lar gamle rankingverdier
stå hvis ITHF-kilden ikke kan hentes. Oppdateringen omfatter også ITHF-feltet
`Player_Value`, som WR 2020-beregningen bruker for poeng per plassering.
Kontroller første kjøring i **Workers & Pages → puck-no-mcp → Logs**.

### Daglig bygg for riktig turneringsstatus

Kommende/tidligere-status regnes ved statisk bygg. Opprett derfor en
**Production deploy hook** i Pages-prosjektets **Settings → Builds &
deployments → Deploy hooks**. Legg hook-URL-en inn i GitHub-repoets
**Settings → Secrets and variables → Actions** som hemmeligheten
`CLOUDFLARE_PAGES_DEPLOY_HOOK`. Workflowen
`.github/workflows/daily-rebuild.yml` kaller den én gang daglig og kan også
kjøres manuelt. Det offentlige API-et avviser uansett påmelding etter
sluttdato, men dette daglige bygget holder lister og statustekst oppdatert.

## A8. (Valgfritt) Web Analytics

1. Dashbord → **Analytics & Logs** → **Web Analytics** → **Add a site** →
   hostname `puck-no.pages.dev`. Kopier **JS-snippet token**.
2. Pages → **Settings** → **Variables and Secrets** →
   `PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` = token → retry deployment.
3. Utvid CSP-en i `public/_headers` med `https://static.cloudflareinsights.com`
   i `script-src` og `connect-src` (beacon-scriptet ellers blokkert).
4. Ingen informasjonskapsler, ingen banner nødvendig.

## A9. Akseptansetest på pages.dev (sjekkliste)

- [ ] Forsiden, Nyheter, en bloggpost, Turneringer, én turneringsside,
      Timere (spill av 5 sek), Bilder + et galleri, Årsmøter (åpne en PDF),
      Om oss — alt på norsk OG engelsk (språkbryter øverst).
- [ ] Påmelding + duplikat + «Påmeldte spillere» (A4).
- [ ] CMS-innlogging og en testendring (A5) — f.eks. endre en tittel, lagre,
      se den live etter noen minutter (og endre tilbake).
- [ ] Admin-CSV bak Access (A6).
- [ ] Gamle URL-er: `https://puck-no.pages.dev/services-1` skal gi 301 til
      `/spill-bordhockey/`; `/turneringer/norway-open-2025` skal gi 200 med
      eget 2025-innhold (deltakerliste fra 2025).
- [ ] RSS: `https://puck-no.pages.dev/blog-feed.xml` åpnes som XML.
- [ ] Sjekk på mobil (eller smalt vindu): meny, skjema, galleri.

---

# STEG B — Flytt puck.no til den nye siden

**Gjør dette først når A9 er krysset av.** Frem til nå er den gamle
Wix-siden urørt.

> **Domenespesifikk merknad (2026-08-11):** `puck.no` er registrert hos
> Simply.com, men bruker fortsatt Wix-navnetjenerne. Følg den verifiserte,
> e-postbevarende planen i `DNS-CUTOVER.md` og importer
> `puck.no.cloudflare-stage.txt` før navnetjenerbyttet. Den inneholder 12
> verifiserte poster, inkludert begge aktive DKIM-postene. Ikke importer den
> inaktive Simply-eksporten direkte. Planen flytter først DNS uten å endre
> noen tjenester, tester e-post, og bytter deretter bare webpostene til Pages.

## B1. Legg puck.no inn i Cloudflare

1. Dashbord → **Add a site** (eller **Onboard a domain**) → skriv `puck.no`
   → velg **Free**-plan.
2. Cloudflare scanner DNS og viser to **Cloudflare-navnetjenere**
   (f.eks. `dana.ns.cloudflare.com`).
3. Hos Simply.com: velg `puck.no` → **DNS** → **Sæt navneservere** og bytt
   fra Wix-navnetjenerne til de to Cloudflare ga. Se `DNS-CUTOVER.md` for
   forhåndskontroll av DNSSEC, eksakt staging-sone og verifisering av e-post.
4. Vent på at Cloudflare bekrefter (typisk 5–60 min, kan ta noen timer).
   Du får e-post når domenet er aktivt.
   - **Merk:** puck.no peker nå til Cloudflare, men gamle DNS-poster
     (Wix) ligger igjen inntil vi endrer dem — siden går ikke ned av dette
     alene.

## B2. Koble domenet til Pages-prosjektet

1. **Workers & Pages** → **puck-no** → **Custom domains** →
   **Set up a custom domain** → skriv `www.puck.no` → godkjenn (Cloudflare
   lager DNS-posten selv). Gjenta for `puck.no` (naked domain).
2. Lag en eksplisitt canonical-redirect; Pages garanterer ikke automatisk
   apex→www. Gå til **Rules → Redirect Rules → Single Redirect**:
   - Når hostname er nøyaktig `puck.no`
   - Status `301`
   - Mål: samme sti på `https://www.puck.no` (behold query string)
   Test både en vanlig side og en URL med `?test=1`. Ikke lag motsatt
   www→apex-regel samtidig — det gir redirect-loop.
3. I **SSL/TLS**: sett kryptering til **Full (strict)**.
4. Nå svarer https://www.puck.no med DEN NYE siden. Den gamle Wix-siden er
   dermed avløst. (Wix-abonnementet kan sies opp når du har sett at alt er
   stabilt noen dager — alt innhold er allerede migrert.)

## B2a. Aktiver DNSSEC og agentoppdagelse (DNS-AID)

Gjør dette først når navnetjenerbyttet er fullt propagert og nettstedet svarer
stabilt gjennom Cloudflare. DNS-AID er fortsatt et aktivt IETF-utkast, så
postene må kontrolleres mot nyeste utgave ved en senere endring.

1. **DNS → Records → Add record**. Legg inn disse to `SVCB`-postene med TTL
   `1 hour` (Cloudflare kan vise prioritet, mål og parametre som egne felt):

   ```dns
   _index._agents.puck.no. 3600 IN SVCB 1 www.puck.no. alpn="h2,h3" port=443
   _mcp._agents.puck.no.   3600 IN SVCB 1 puck-no-mcp.amund-fylling.workers.dev. alpn="mcp,h2,h3" port=443
   ```

   `_index` peker til nettstedets `/.well-known/`-kataloger; `_mcp` peker til
   den faktiske Streamable HTTP MCP-Workeren. `mcp` er et foreslått ALPN-ID i
   DNS-AID-utkastet, ikke en ferdig IANA-standard.
2. **DNS → Settings → DNSSEC → Enable DNSSEC**. Cloudflare signerer sonen og
   viser en DS-post.
3. Hos domeneregistraren: legg inn **hele DS-posten** Cloudflare viser. Ikke
   bruk en gammel DS fra Wix. Vent på at Cloudflare viser DNSSEC som aktiv.
4. Verifiser fra en validerende resolver (eldre `dig` kjenner ikke navnet
   `SVCB`, derfor brukes typenummer 64):

   ```bash
   dig +dnssec puck.no DNSKEY @1.1.1.1
   dig +dnssec _index._agents.puck.no TYPE64 @1.1.1.1
   dig +dnssec _mcp._agents.puck.no TYPE64 @1.1.1.1
   ```

   Svarene skal inneholde postene og DNSSEC-signaturer, og en validerende
   resolver skal markere svaret autentisert (`ad`). Kjør også en ny skann hos
   isitagentready.com etter at DNS-cache/TTL har utløpt.

## B3. Oppdater tjenestene til det nye domenet

1. **Turnstile** → widgeten → **Settings** → legg til hostname
   `www.puck.no` (og `puck.no`).
2. **sveltia-cms-auth** worker → `ALLOWED_DOMAINS` =
   `puck-no.pages.dev,www.puck.no,puck.no` (behold pages.dev som fallback).
3. **Web Analytics** (A8): legg til `www.puck.no` som eget nettsted, bytt
   token i `PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` → retry deployment.
4. **Access** (A6): legg `www.puck.no` til som domain i de to
   applikasjonene (eller lag nye apper for www-domenet).
5. GitHub OAuth-app: bytt Homepage URL til `https://www.puck.no`
   (callback-URLen forblir worker-URLen — ingen endring).

## B4. Google Search Console

1. Gå til https://search.google.com/search-console → **Add property** →
   **Domain** → `puck.no`.
2. Velg **DNS-verifisering** — kopier TXT-posten.
3. Cloudflare → **DNS** → **Records** → **Add record**: type `TXT`,
   navn `@`, innhold = TXT-verdien → lagre.
4. Tilbake i Search Console → **Verify**.
5. **Sitemaps** → send inn `https://www.puck.no/sitemap-index.xml`.

## B5. Etter lansering (sjekkliste)

Gjenta hele A8-sjekklisten på https://www.puck.no. I tillegg:

- [ ] `curl -I https://www.puck.no/services-1` → `301` til `/spill-bordhockey/`
- [ ] `https://puck.no` (uten www) omdirigerer til www (eller motsatt)
- [ ] RSS valid: https://validator.w3.org/feed/ → lim inn
      `https://www.puck.no/blog-feed.xml`
- [ ] Påmelding ende-til-ende med ekte Turnstile (ikke testnøkler)

### Merk: puck-no.pages.dev er et midlertidig domene

`puck-no.pages.dev` er kun for testperioden. Når www.puck.no er bekreftet
stabilt bør det gratis pages.dev-domenet **skrås av eller begrenses**, slik
at bare www.puck.no serverer siden (ellers kan søkemotorer indeksere
duplikatinnhold, og besøkende kan havne på det gamle domenet):

1. **Workers & Pages** → **puck-no** → **Settings** → **Domains & Routes**.
2. Under **pages.dev domain**: velg **Disable** (eller hold musepekeren over
   domenet og deaktiver det).
3. Alternativt: behold domenet aktivt, men legg en Cloudflare Access-policy
   foran `puck-no.pages.dev/*` (samme oppsett som i A6) slik at bare styret
   når det — praktisk for fremtidige forhåndsvisninger.
4. Verifiser etterpå: `curl -I https://puck-no.pages.dev/` skal IKKE gi 200
   med nettsiden.

## B6. Rulle tilbake ved problemer

- **Nettsiden:** Cloudflare → **Workers & Pages** → **puck-no** →
  **Deployments** → finn forrige fungerende bygg → **⋮** →
  **Rollback to this deployment**. Tar under ett minutt.
- **Hele domenet til Wix (nødstilfelle):** bytt navnetjenere tilbake hos
  registraren til de gamle (noter dem FØR du bytter i B1).

## B7. Overvåkning (UptimeRobot, gratis)

1. https://uptimerobot.com → **Sign Up Free**.
2. **Add New Monitor**: type **HTTP(s)**, URL `https://www.puck.no`,
   intervall 5 min, varsel til din e-post.
3. Legg gjerne til en monitor for `https://www.puck.no/blog-feed.xml` også.

---

# Vedlikehold senere

- **Innhold:** styret bruker https://www.puck.no/admin/ (se REDIGERING.md).
- **Tekniske endringer:** branch + pull request → gratis forhåndsvisning på
  `https://<branch>.puck-no.pages.dev`.
- **Nye turneringer med seed fra Wix:** oppdater `TOURNAMENT_MAP` i
  `scripts/seed-d1.mjs`, lag en privat midlertidig fil og bruk den
  ikke-destruktive `--append`-modusen:
  ```bash
  puck_seed_sql="$(mktemp "${TMPDIR:-/tmp}/puck-seed.XXXXXX")"
  chmod 600 "$puck_seed_sql"
  trap 'rm -f "$puck_seed_sql"' EXIT
  node scripts/seed-d1.mjs --append > "$puck_seed_sql"
  npx wrangler d1 execute puck-no --remote --file="$puck_seed_sql"
  rm -f "$puck_seed_sql"
  trap - EXIT
  ```
  Kjør aldri `--replace --allow-delete` mot den levende databasen; den modusen
  begynner med `DELETE FROM registrations`.
- **Databasemigreringer (`migrations/`):** kjør alltid
  `npx wrangler d1 migrations apply puck-no --remote` FØR du merger kode som
  bruker dem — et Pages-bygg går live automatisk ved merge, og ny kode som
  forventer en kolonne som ikke finnes ennå feiler for alle påmeldinger.
- **Verdensrankingen** hentes ved hvert bygg og ved nye rangerte påmeldinger.
  Registrerte spillere i kommende turneringer oppdateres hver onsdag kl. 03:00
  Europe/Oslo av `puck-no-mcp`-Workeren. Se Worker-loggene hvis feltet «Ranking
  sist oppdatert» ikke endres. Oppdateringen lagrer både spillerens totale
  rankingpoeng og den separate `Player_Value` som brukes til å beregne WR 2020-
  poengtabellen for turneringer med valgt ITHF-rankingnivå.

# Miljøvariabler — oversikt

| Variabel | Hvor | Type | Formål |
|---|---|---|---|
| `NODE_VERSION=24` | Pages (bygg) | plaintext | Astro 7 krever Node ≥ 22 |
| `PUBLIC_TURNSTILE_SITE_KEY` | Pages (bygg) | plaintext | Turnstile-widget i skjema |
| `TURNSTILE_SECRET_KEY` | Pages (runtime) | secret | Verifisering i API |
| `PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` | Pages (bygg) | plaintext | Web Analytics (valgfritt) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | sveltia-cms-auth worker | text/secret | CMS-innlogging |
| `ALLOWED_DOMAINS` | sveltia-cms-auth worker | text | Hvilke domener CMS kan kjøre på |

**Hemmeligheter legges ALDRI i git** — kun i Cloudflare-variabler.
