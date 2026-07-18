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
- **Schema:** `migrations/0001_init.sql` (`registrations` table + unique index on
  `(tournament_slug, type, lower(email))`).
- **Endpoints:**
  - `POST /api/registrations` — register player/team (Turnstile-verified).
  - `GET /api/tournaments/{slug}/players` — public participant list (name,
    country, world_ranking only; never email/phone).
  - `GET /api/admin/registrations.csv?slug=…` — full CSV export incl. email/phone.
    Protected by Cloudflare Access (platform level, Phase 5); additionally returns
    401 when `ACCESS_TEAM_NAME` is set and the `Cf-Access-Authenticated-User-Email`
    header is missing (defence in depth).
- **Admin UI:** `/admin/pameldinger` lists tournaments with CSV download links
  (noindex; also protect `/admin/*` with Access, Phase 5).

### Local development of the backend

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cp .dev.vars.example .dev.vars     # Cloudflare's public always-pass TEST keys
# PUBLIC_TURNSTILE_SITE_KEY is needed at BUILD time (it is baked into the HTML):
cp .dev.vars.example .env          # or just the PUBLIC_ line
npm run build

# one-time local database setup:
npx wrangler d1 migrations apply DB --local
node scripts/seed-d1.mjs > /tmp/seed.sql
npx wrangler d1 execute DB --local --file=/tmp/seed.sql

# serve static site + functions + local D1:
npx wrangler pages dev dist --d1 DB --local
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
(`[rank, id, name, club, nation]`, ~7849 players, ~370KB):
`src/data/ranking.json` is the committed offline fallback, `public/ranking.json`
(generated, git-ignored) is what the client fetches lazily on first focus of
the player search. The POST endpoint re-validates `playerId` against the live
ranking server-side (cf-cached 6h) and derives name/country/WR itself —
client-sent country/WR are ignored. Note the **egress dependency** on
stiga.trefik.cz at registration time: if it is down, playerId registrations
fail with a 502 asking the user to try later (fallback free-text names still
work). No secret/key needed for the ranking fetch.

## Data & privacy (GDPR)

Registration stores: name, country (optional, from the ITHF world ranking),
email, phone (optional), world ranking (optional, from the ITHF ranking),
tournament, type (player/team) and a timestamp.

- **Why:** to administer tournament participation (participant lists, contact
  before/after events).
- **Ranking data:** player names shown in the registration search come from the
  public ITHF world ranking (stiga.trefik.cz); selecting a player links the
  registration to that public ranking entry. The ranking snapshot
  (`src/data/ranking.json`) contains only already-public ranking data.
- **Public exposure:** only name, country and world ranking are shown publicly
  (the same fields the old Wix site published). Email/phone are only available
  via the Access-protected CSV export.
- **Export:** board members download per-tournament CSV from `/admin/pameldinger`
  (or `GET /api/admin/registrations.csv?slug=…`).
- **Deletion/correction:** anyone can request access to, correction of, or
  deletion of their data via amund.fylling@puck.no. To delete manually:
  `npx wrangler d1 execute DB --remote --command "DELETE FROM registrations WHERE lower(email) = lower('<email>');"`
- **Storage:** Cloudflare D1 (EU jurisdiction depends on account setup).

## Deployment (summary — full runbook in LAUNCH.md, Phase 5)

1. `npm run build` (with real `PUBLIC_TURNSTILE_SITE_KEY` in env).
2. Cloudflare Pages project from this repo; build command `npm run build`, output `dist`.
3. Create D1 (`npx wrangler d1 create puck-no`), put the real `database_id` in
   `wrangler.toml`, apply migrations + seed with `--remote`.
4. Set `TURNSTILE_SECRET_KEY` (Pages env var / secret).
5. Cloudflare Access policy for `/admin/*` and `/api/admin/*`; set `ACCESS_TEAM_NAME`.
