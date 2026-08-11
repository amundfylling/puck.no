# puck.no — Norges Bordhockeyforbund

Static [Astro](https://astro.build) rebuild of https://www.puck.no/ (previously Wix),
with a Cloudflare Pages Functions + D1 backend for tournament registration.
Norwegian default (`/...`), English mirror (`/en/...`). See `AGENTS.md` for the
full project conventions.

## Requirements

- Node ≥ 22.12 (Astro 7). On this machine: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`
- `npm install`

## Everyday commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Astro dev server |
| `npm run build` | Image optimizer (prebuild) + static build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run check` | Type/astro check (keep at 0 errors / 0 warnings) |
| `npm run check-links` | Crawl `dist/`, fail on broken internal links |

## Backend (Phase 3): registration API

- **Stack:** Cloudflare Pages file-based functions in `functions/` (TypeScript) +
  D1 (SQLite) binding `DB`. Static Astro output is unchanged.
- **Config:** `wrangler.toml` contains the real `puck-no` D1 binding. A new
  environment must create its own database and replace that public ID.
- **Schema:** ordered migrations in `migrations/`. `0004_registration_details.sql`
  adds ranking points, clubs, structured team rosters, custom-question answers
  and per-tournament ranking-refresh timestamps. `0005_ranking_value.sql` adds
  the ITHF `Player_Value` used by the WR 2020 placement-points algorithm;
  later migrations add one-use remote OAuth codes and the fail-closed runtime
  registration switch. Always apply every pending migration before deploying.
- **Endpoints:**
  - `POST /api/registrations` — register player/team (Turnstile-verified).
    Public writes stop when `registrationOpen` is false or after the generated
    tournament end date in Europe/Oslo; admin corrections can still be added.
  - `GET /api/tournaments/{slug}/players` — public participant list with club,
    country, ranking position/points and team rosters; never email, phone or
    custom-question answers.
  - `POST|PATCH|DELETE /api/admin/registrations` — add, edit or delete a
    registration, including after public registration has closed.
  - `GET /api/admin/registrations.csv?slug=…` — full CSV export including
    contact details, roster JSON, ranking points and custom answers.
  - `GET /api/admin/overview.json` — dashboard data: per-tournament counts,
    registrationOpen flags, totals, recent registrations.
  - `GET /api/admin/registrations.json?slug=…` — protected registration rows
    for the portal, including contact details, rosters and custom answers.
  - `POST /api/admin/registration-open` — open/close registration; commits the
    frontmatter change to main via the GitHub API (needs the `GITHUB_TOKEN`
    secret, else 503). Closing also writes a D1 veto first, so public writes
    stop immediately; D1 can never override a CMS/frontmatter closure open.
  - All `/api/admin/*` endpoints require a valid signed Cloudflare Access JWT.
    Middleware verifies its signature, issuer, expiry and application audience
    before placing the verified identity in request context; a spoofed email
    header is never trusted. Mutations additionally require same-origin JSON.
- **Admin UI:** `/admin/` is a custom admin portal (dashboard with live
  counts, searchable/sortable registration management at `/admin/pameldinger/`,
  add/edit/delete, open/close toggle, CSV downloads, dark mode; noindex). The Sveltia CMS
  lives at `/admin/cms/`. Protect `/admin/*` + `/api/admin/*` with Access
  (Phase 5).

### Local development of the backend

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cp .dev.vars.example .dev.vars     # Cloudflare's public always-pass TEST keys
# PUBLIC_TURNSTILE_SITE_KEY is needed at BUILD time (it is baked into the HTML):
cp .dev.vars.example .env          # or just the PUBLIC_ line
npm run build

# one-time local database setup (database_name from wrangler.toml is "puck-no" —
# always use that name, NOT the binding name "DB", and do NOT pass --d1 to
# pages dev: both mistakes silently create a second, empty local database
# and every API call fails with 500 "no such table: registrations"):
npx wrangler d1 migrations apply puck-no --local
# The SQL contains PII: use a private temporary file and remove it afterwards.
puck_seed_sql="$(mktemp "${TMPDIR:-/tmp}/puck-seed.XXXXXX")"
chmod 600 "$puck_seed_sql"
trap 'rm -f "$puck_seed_sql"' EXIT
node scripts/seed-d1.mjs --replace --allow-delete > "$puck_seed_sql" # EMPTY/throwaway local DB only
npx wrangler d1 execute puck-no --local --file="$puck_seed_sql"
rm -f "$puck_seed_sql"
trap - EXIT

# serve static site + functions + local D1 (bindings come from wrangler.toml):
npx wrangler pages dev dist --local
```

The admin API has no local authentication bypass: without a real, valid Access
assertion it intentionally returns 503/403. Use `npm test` for local auth checks
and an Access-protected preview/production hostname for end-to-end admin tests.

### Seeded data (the 135 pre-migration registrations)

`scripts/seed-d1.mjs` converts the real Wix export **`participants export wix.csv`**
(repo root, GIT-IGNORED — real emails/phones, never commit it) to SQL. It refuses
to run until one explicit mode is chosen:

- `--append` is the safe mode for an existing/live database. Every insert has
  an identity guard, so rerunning the same export does not duplicate rows. It
  never deletes registrations and leaves the static snapshot untouched.
- `--backfill` only updates matching legacy ranked-player rows; it neither
  inserts nor deletes registrations.
- `--replace --allow-delete` starts with `DELETE FROM registrations` and is only
  for a confirmed empty or throwaway database. This is the only mode that
  regenerates `src/data/registrations-snapshot.json` (public fields only).

Tournament names are mapped via `TOURNAMENT_MAP`; unmapped rows are skipped and
reported. Shared contact emails are allowed for ranked players and teams. When
two unranked individuals in one tournament share an address, the required
unique guard uses a deterministic `+dupN` suffix; reports mask the address.
Generated SQL contains PII, so always redirect it to a `chmod 600` `mktemp`
file and remove that file immediately after Wrangler executes it.

### World ranking data

The registration form picks players from the live ITHF world ranking
(https://stiga.trefik.cz/ithf/ranking/ranking.txt, TSV). `scripts/fetch-ranking.mjs`
(runs first in `prebuild`) converts it to compact JSON
(`[rank, id, name, club, nation, points, playerValue]`):
`src/data/ranking.json` is the committed offline fallback, `public/ranking.json`
(generated, git-ignored) is what the client fetches lazily on first focus of
the player search. The POST endpoint re-validates `playerId` against the live
ranking server-side (cf-cached 6h) and derives name, club, country, ranking
position and ITHF points itself — client-sent ranking data is ignored. Note
the **egress dependency** on
stiga.trefik.cz at registration time: if it is down, playerId registrations
fail with a 502 asking the user to try later (fallback free-text names still
work). No secret/key is needed for the ranking fetch.

The remote admin Worker refreshes ranking data for registrations in upcoming
tournaments every Wednesday at 03:00 Europe/Oslo. This includes both total
`ranking_points` and the separate ITHF `Player_Value` (`ranking_value`). Team
points are recalculated from the highest-rated `playersPerTeam` roster members;
unranked players count as zero. If the ITHF fetch fails, the old values remain
untouched. The public participant table shows the last successful refresh time.

The championship qualification page is generated by
`scripts/fetch-qualification.mjs`. On Wednesday builds it reads the current
ITHF calendar and Norwegian player profiles and rebuilds the VM 2027 standings
for open, women, junior, veteran, kids and superveteran. On other days it carries
the deployed Wednesday snapshot forward, with `src/data/kvalifisering-vm27.json`
as the offline fallback. The existing daily Cloudflare Pages deploy hook therefore
publishes a fresh qualification table every Wednesday morning. Run
`npm run refresh-qualification` to force a local live refresh.

After first applying migrations `0004` and `0005`, existing registrations can
be backfilled once from the live ITHF feed. Preview the exact scope first, then
apply it:

```bash
npm run backfill-ranking -- --remote
npm run backfill-ranking -- --remote --apply
```

The script reads no contact details. It updates ranked individuals and links
legacy team roster names only when there is one exact ranking-name match.

### ITHF WR 2020 placement points

A tournament may set the optional `rankingLevel` to `1-world`,
`1-continental`, `2`, `3`, `4`, `5`, `6` or `10`; editors choose the same
values from a select field in Sveltia CMS. When configured, the public
tournament page shows a bilingual table of the calculated ITHF points for each
possible placement. The exact WR 2020 calculation uses the current entrant
count and each ranked entrant's live `Player_Value`, which is not the player's
total world-ranking score. Tournaments with fewer than four entrants and level
10 team tournaments award zero points. At levels 1–6, the winner receives the
algorithm's best result plus the prescribed 10-point winner bonus. Because the
table follows the current participant list and refreshed values, it may change
until registration closes.

## Data & privacy (GDPR)

Registration stores: name, club/country/ranking data (when selected from the
ITHF ranking), email, phone (optional), tournament, type, structured team roster,
configured custom-question answers and a timestamp.

- **Why:** to administer tournament participation (participant lists, contact
  before/after events).
- **Ranking data:** player names shown in the registration search come from the
  public ITHF world ranking (stiga.trefik.cz); selecting a player links the
  registration to that public ranking entry. The ranking snapshot
  (`src/data/ranking.json`) contains only already-public ranking data.
- **Public exposure:** name, club, country, ranking position/points and team
  rosters are public. Email, phone and custom answers are only available in the
  Access-protected admin portal and CSV export.
- **Export:** board members download per-tournament CSV from `/admin/pameldinger`
  (or `GET /api/admin/registrations.csv?slug=…`).
- **Deletion/correction:** anyone can request access to, correction of, or
  deletion of their data via amund.fylling@puck.no. To delete manually:
  `npx wrangler d1 execute puck-no --remote --command "DELETE FROM registrations WHERE lower(email) = lower('<email>');"`
- **Storage:** Cloudflare D1 (EU jurisdiction depends on account setup).

## Deployment (summary — full runbook in LAUNCH.md, Phase 5)

1. `npm run build` (with real `PUBLIC_TURNSTILE_SITE_KEY` in env).
2. Cloudflare Pages project from this repo; build command `npm run build`, output `dist`.
3. Create D1 (`npx wrangler d1 create puck-no`), put the real `database_id` in
   `wrangler.toml`, apply migrations + seed with `--remote`.
4. Set `TURNSTILE_SECRET_KEY` (Pages env var / secret).
5. Cloudflare Access policy for `/admin/*` and `/api/admin/*`; set
   `ACCESS_TEAM_NAME` and the application's `ACCESS_POLICY_AUD` tag. The admin
   API deliberately fails closed until both variables are configured.
6. Deploy `mcp-remote/` so its Wednesday 03:00 Europe/Oslo ranking-refresh
   cron is active (see `mcp-remote/README.md`).
7. Configure the secret `CLOUDFLARE_PAGES_DEPLOY_HOOK`; the daily workflow
   rebuilds build-time tournament status even when no content commit occurs.

## Agent and API discovery

- The homepage returns RFC 8288 `Link` response headers for the RFC 9727 API
  catalog, OpenAPI description, documentation and `llms.txt`.
- `/.well-known/api-catalog`, `/openapi.json`,
  `/.well-known/mcp/server-card.json`, OAuth protected-resource metadata,
  `/auth.md`, and the Agent Skills v0.2.0 index are built as public discovery
  documents. The MCP endpoint at `/mcp` is a same-origin facade for the
  separately deployed OAuth-protected Worker.
- Public HTML pages have build-generated Markdown variants. Pages Functions
  returns one with `Content-Type: text/markdown` and `Vary: Accept` when the
  request explicitly accepts `text/markdown`; this keeps the Free plan usable
  without Cloudflare's paid Markdown for Agents setting.
- `robots.txt` permits search and agent input but declares `ai-train=no` using
  Content Signals. Read-only WebMCP tools expose the current page and public
  tournament discovery in browsers that implement the experimental API.
- DNS-AID and DNSSEC are infrastructure changes performed after the domain
  moves from Wix DNS to Cloudflare; the exact records and verification steps
  are in `LAUNCH.md` section B2a.

## Repository & workflow

- **Branch protection (recommended):** GitHub → Settings → Branches → add
  rule for `main`: require a pull request before merging (1 approval is
  enough for a small team) and require the checks from `.github/workflows/ci.yml`.
  Note: the Sveltia CMS commits directly to `main` for board members — keep
  the rule but allow the CMS/GitHub-app actor, or leave protection off until
  multiple developers are active (documented decision: CMS needs direct
  commits, see `publish_mode: simple` in `public/admin/cms/config.yml`).
- **Pull requests get free preview deployments** on Cloudflare Pages
  (`https://<branch>.<project>.pages.dev`) — use them to review changes.
- **Dependabot** is configured (`.github/dependabot.yml`): weekly npm PRs.
- **License:** MIT (see `LICENSE`).
