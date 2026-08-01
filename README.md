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
- **Config:** `wrangler.toml` (D1 binding; placeholder `database_id` — create the
  real DB with `npx wrangler d1 create puck-no` and fill it in, Phase 5).
- **Schema:** ordered migrations in `migrations/`. `0004_registration_details.sql`
  adds ranking points, clubs, structured team rosters, custom-question answers
  and per-tournament ranking-refresh timestamps. `0005_ranking_value.sql` adds
  the ITHF `Player_Value` used by the WR 2020 placement-points algorithm.
- **Endpoints:**
  - `POST /api/registrations` — register player/team (Turnstile-verified).
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
    secret, else 503).
  - All `/api/admin/*` endpoints require the
    `Cf-Access-Authenticated-User-Email` header (403 otherwise) — defence in
    depth behind the platform-level Cloudflare Access policy (Phase 5).
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
node scripts/seed-d1.mjs > /tmp/seed.sql
npx wrangler d1 execute puck-no --local --file=/tmp/seed.sql

# serve static site + functions + local D1 (bindings come from wrangler.toml):
npx wrangler pages dev dist --local
```

### Seeded data (the 135 pre-migration registrations)

`scripts/seed-d1.mjs` converts the real Wix export **`participants export wix.csv`**
(repo root, GIT-IGNORED — real emails/phones, never commit it) to SQL, and
regenerates `src/data/registrations-snapshot.json` (public fields only:
name/country/world_ranking). Tournament names are mapped via `TOURNAMENT_MAP`
in the script; unmapped rows (e.g. "Norway Open 2025") are skipped and
reported. Rows sharing an email within the same tournament+type (one person
registered another) get a deterministic `+dupN` email suffix and are reported.

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
5. Cloudflare Access policy for `/admin/*` and `/api/admin/*`; set `ACCESS_TEAM_NAME`.
6. Deploy `mcp-remote/` so its Wednesday 03:00 Europe/Oslo ranking-refresh
   cron is active (see `mcp-remote/README.md`).

## Repository & workflow

- **Branch protection (recommended):** GitHub → Settings → Branches → add
  rule for `main`: require a pull request before merging (1 approval is
  enough for a small team) and require status checks if CI is added later.
  Note: the Sveltia CMS commits directly to `main` for board members — keep
  the rule but allow the CMS/GitHub-app actor, or leave protection off until
  multiple developers are active (documented decision: CMS needs direct
  commits, see `publish_mode: simple` in `public/admin/cms/config.yml`).
- **Pull requests get free preview deployments** on Cloudflare Pages
  (`https://<branch>.<project>.pages.dev`) — use them to review changes.
- **Dependabot** is configured (`.github/dependabot.yml`): weekly npm PRs.
- **License:** MIT (see `LICENSE`).
