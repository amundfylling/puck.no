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
   node scripts/seed-d1.mjs > /tmp/seed.sql
   npx wrangler d1 execute puck-no --remote --file=/tmp/seed.sql
   ```
   *(Alternativ uten terminal: åpne databasen i dashboardet → fanen
   **Console** → lim inn innholdet i `migrations/0001_init.sql`, deretter
   innholdet i seed-filen. Seed-filen inneholder ekte e-poster — ikke del
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
2. Sjekk at «Påmeldte spillere» viser 12 spillere (Rainers Kalnins øverst).
3. Registrer en testspiller (søk f.eks. «test» eller bruk «Jeg finner ikke
   navnet mitt») → forvent **«Takk for din registrering!»** og at spilleren
   dukker opp i listen.
4. Registrer samme e-post igjen → forvent **«Spiller er allerede
   registrert!»**.
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
4. I repoet: rediger `public/admin/config.yml` (blyant på GitHub) og sett
   `base_url: <worker-URL>` → **Commit changes**. Vent på at Pages bygger
   på nytt (2–4 min).
5. Test: gå til https://puck-no.pages.dev/admin/ → **Logg inn med GitHub**
   → godkjenn → du skal se CMS-et med Nyheter, Turneringer osv.
   - Styremedlemmer må ha GitHub-konto og være lagt til som **collaborators**
     på repoet (GitHub → repo → **Settings** → **Collaborators** → invite).

## A6. Beskytt admin-sidene (Cloudflare Access)

CSV-eksporten inneholder e-poster og telefonnummer og må ikke være åpen.

1. I dashbordet: **Zero Trust** (venstremeny). Første gang: velg team-navn
   (f.eks. `nbhf`) — det gir `nbhf.cloudflareaccess.com`.
2. **Access** → **Applications** → **Add an application** → **Self-hosted**:
   - **Application name:** `puck.no admin`
   - **Subdomain + Domain:** `puck-no.pages.dev`
   - **Path:** `admin` *(legg også til en tilsvarende app med path
     `api/admin`, eller bruk én app med begge paths)*
   - **Policy:** *Emails* — legg inn e-postadressene til styremedlemmene
     (f.eks. `amund.fylling@puck.no`).
3. I Pages-prosjektet: **Settings** → **Variables and Secrets** →
   `ACCESS_TEAM_NAME` = `nbhf.cloudflareaccess.com` (ditt team-navn).
4. Test: åpne https://puck-no.pages.dev/admin/pameldinger i et privat
   vindu → du skal få en Cloudflare-innloggingsside der du skriver
   e-posten din og får en engangskode på mail. Etter innlogging: trykk
   **Last ned CSV** på en turnering → sjekk at filen åpnes i Excel/Numbers
   og har alle kolonner.

## A7. (Valgfritt) Web Analytics

1. Dashbord → **Analytics & Logs** → **Web Analytics** → **Add a site** →
   hostname `puck-no.pages.dev`. Kopier **JS-snippet token**.
2. Pages → **Settings** → **Variables and Secrets** →
   `PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` = token → retry deployment.
3. Ingen informasjonskapsler, ingen banner nødvendig.

## A8. Akseptansetest på pages.dev (sjekkliste)

- [ ] Forsiden, Nyheter, en bloggpost, Turneringer, én turneringsside,
      Timere (spill av 5 sek), Bilder + et galleri, Årsmøter (åpne en PDF),
      Om oss — alt på norsk OG engelsk (språkbryter øverst).
- [ ] Påmelding + duplikat + «Påmeldte spillere» (A4).
- [ ] CMS-innlogging og en testendring (A5) — f.eks. endre en tittel, lagre,
      se den live etter noen minutter (og endre tilbake).
- [ ] Admin-CSV bak Access (A6).
- [ ] Gamle URL-er: `https://puck-no.pages.dev/services-1` skal gi 301 til
      `/spill-bordhockey`; `/turneringer/norway-open-2025` →
      `/turneringer/norway-open-2026`.
- [ ] RSS: `https://puck-no.pages.dev/blog-feed.xml` åpnes som XML.
- [ ] Sjekk på mobil (eller smalt vindu): meny, skjema, galleri.

---

# STEG B — Flytt puck.no til den nye siden

**Gjør dette først når A8 er krysset av.** Frem til nå er den gamle
Wix-siden urørt.

## B1. Legg puck.no inn i Cloudflare

1. Dashbord → **Add a site** (eller **Onboard a domain**) → skriv `puck.no`
   → velg **Free**-plan.
2. Cloudflare scanner DNS og viser to **Cloudflare-navnetjenere**
   (f.eks. `dana.ns.cloudflare.com`).
3. Hos domeneregistraren for puck.no (f.eks. Domeneshop — logg inn der
   domenet forvaltes): bytt navnetjenere til de to Cloudflare ga.
   - Domeneshop: **Mine domener** → puck.no → **Navnetjenere** →
     egendefinerte → lim inn begge → lagre.
4. Vent på at Cloudflare bekrefter (typisk 5–60 min, kan ta noen timer).
   Du får e-post når domenet er aktivt.
   - **Merk:** puck.no peker nå til Cloudflare, men gamle DNS-poster
     (Wix) ligger igjen inntil vi endrer dem — siden går ikke ned av dette
     alene.

## B2. Koble domenet til Pages-prosjektet

1. **Workers & Pages** → **puck-no** → **Custom domains** →
   **Set up a custom domain** → skriv `www.puck.no` → godkjenn (Cloudflare
   lager DNS-posten selv). Gjenta for `puck.no` (naked domain — Cloudflare
   omdirigerer automatisk til www, eller motsatt, begge virker).
2. I **SSL/TLS**: sett kryptering til **Full (strict)**.
3. Nå svarer https://www.puck.no med DEN NYE siden. Den gamle Wix-siden er
   dermed avløst. (Wix-abonnementet kan sies opp når du har sett at alt er
   stabilt noen dager — alt innhold er allerede migrert.)

## B3. Oppdater tjenestene til det nye domenet

1. **Turnstile** → widgeten → **Settings** → legg til hostname
   `www.puck.no` (og `puck.no`).
2. **sveltia-cms-auth** worker → `ALLOWED_DOMAINS` =
   `puck-no.pages.dev,www.puck.no,puck.no` (behold pages.dev som fallback).
3. **Web Analytics** (A7): legg til `www.puck.no` som eget nettsted, bytt
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

- [ ] `curl -I https://www.puck.no/services-1` → `301` til `/spill-bordhockey`
- [ ] `https://puck.no` (uten www) omdirigerer til www (eller motsatt)
- [ ] RSS valid: https://validator.w3.org/feed/ → lim inn
      `https://www.puck.no/blog-feed.xml`
- [ ] Påmelding ende-til-ende med ekte Turnstile (ikke testnøkler)

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
  `scripts/seed-d1.mjs` og kjør seed på nytt (--remote).
- **Verdensrankingen** hentes automatisk ved hvert bygg og ved hver
  påmelding — ingen vedlikehold.

# Miljøvariabler — oversikt

| Variabel | Hvor | Type | Formål |
|---|---|---|---|
| `NODE_VERSION=24` | Pages (bygg) | plaintext | Astro 7 krever Node ≥ 22 |
| `PUBLIC_TURNSTILE_SITE_KEY` | Pages (bygg) | plaintext | Turnstile-widget i skjema |
| `TURNSTILE_SECRET_KEY` | Pages (runtime) | secret | Verifisering i API |
| `PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` | Pages (bygg) | plaintext | Web Analytics (valgfritt) |
| `ACCESS_TEAM_NAME` | Pages (runtime) | plaintext | Ekstra sjekk på CSV-endepunkt |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | sveltia-cms-auth worker | text/secret | CMS-innlogging |
| `ALLOWED_DOMAINS` | sveltia-cms-auth worker | text | Hvilke domener CMS kan kjøre på |

**Hemmeligheter legges ALDRI i git** — kun i Cloudflare-variabler.
