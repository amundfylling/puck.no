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

### Seeded data (the 132 pre-migration registrations)

`scripts/seed-d1.mjs` converts `src/data/registrations-snapshot.json` to SQL.
The old Wix site never published emails/phones, so seeded rows get deterministic
placeholder emails (`seed-<slug>-<n>@seed.puck.no`, type `player`) to satisfy the
NOT NULL + unique constraints. **Real emails/phones were not migratable** — export
them from Wix before cancelling the Wix subscription if they are needed.

## Data & privacy (GDPR)

Registration stores: name, country (optional), email, phone (optional), world
ranking (optional), tournament, type (player/team) and a timestamp.

- **Why:** to administer tournament participation (participant lists, contact
  before/after events).
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
