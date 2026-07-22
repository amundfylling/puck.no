# puck.no — NBHF website rebuild

Rebuild of https://www.puck.no/ (Wix) as a static Astro site for Norges
Bordhockeyforbund (NBHF, the Norwegian table hockey federation). Content is
bilingual: Norwegian (default, at `/...`) and English (at `/en/...`).

## Status

- **Phase 1 (done):** content & media migration from the live Wix site.
  Markdown content, structured data, and all media assets are in the repo.
- **Phase 2 (done):** Astro static site — layouts, routing, SEO, RSS,
  media pipeline. Redirects in `public/_redirects`.
- **Phase 3 (done):** tournament registration — Cloudflare Pages Functions
  in `functions/` + D1 (`migrations/`, seed via `scripts/seed-d1.mjs`),
  Turnstile-protected form on upcoming tournament pages, CSV admin export.
  Remaining launch steps (real `database_id`, real Turnstile keys,
  Cloudflare Access policy) are Phase 5 — see README.md.
- **Phase 4 (done):** Sveltia CMS at `/admin/` (`public/admin/index.html` +
  `config.yml`, GitHub backend, Norwegian UI). Board members edit news,
  tournaments, pages, timers and årsmøte PDFs in the browser — see
  `REDIGERING.md` (Norwegian guide). Auth runs through a sveltia-cms-auth
  Cloudflare Worker (GitHub OAuth) — deployment is Phase 5 (LAUNCH.md).
  CMS saves commit directly to `main` (publish_mode: simple); developers
  still use pull requests.
- **Phase 5 (docs done, launch pending):** `LAUNCH.md` is the full
  Norwegian runbook — deploy to the free `puck-no.pages.dev` domain first,
  verify everything, then cut `puck.no` over. Repo niceties: MIT `LICENSE`,
  Dependabot, PR previews. If local originals are ever lost, re-fetch them
  from the (still live) Wix CDN with `node migration/restore-originals.mjs`
  (verifies sha256 against `migration/manifest.json`).

## Toolchain

- Astro 7 (static output) + TypeScript (strict) + Tailwind CSS 4 (via
  `@tailwindcss/vite`). zod schemas come from `astro/zod`.
- **Node ≥ 22.12 required** (Astro 7). On this machine Node 20 is the
  default — use the nvm Node 24:
  `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`.
- Commands:
  - `npm run dev` — dev server
  - `npm run build` — runs `prebuild` (image optimizer) then `astro build`
  - `npm run preview` — serve the production build
  - `npm run check` — `astro check` (must stay 0 errors / 0 warnings)
  - `npm run check-links` — crawls `dist/` and fails on any broken internal
    link (honours `public/_redirects` sources; run after a build)

## Repository structure

```
src/
  content.config.ts      # content collections (glob loader, zod schemas,
                         # path-based ids: "index", "en/index", ...)
  content/
    pages/               # static pages, Norwegian (index.md = front page)
      en/                # static pages, English
    posts/               # blog posts, Norwegian
      en/                # blog posts, English
    tournaments/         # tournament pages, Norwegian (Norwegian slugs; body
                         # text is intentionally verbatim, often English)
      en/                # tournament pages, English (`lang: "en"` frontmatter)
  data/                  # structured JSON (unchanged from Phase 1, see below)
  layouts/BaseLayout.astro  # <head> (SEO/OG/hreflang/JSON-LD), header, footer
  components/            # Header, Footer, HomePage, BlogIndex, PostCard,
                         # PostArticle, TournamentList, TournamentCard,
                         # AudioPlayer (vanilla-JS island), GalleryGrid
                         # (lightbox island), Arsmoter, RegistrationForm
                         # (live form -> /api/registrations), ParticipantList
                         # (hydrates from the API), CloudflareAnalytics
  lib/                   # i18n.ts (nav + UI strings + page/post mirrors),
                         # dates.ts (Norwegian date parsing), content.ts
                         # (collection helpers, tournament status), seo.ts
                         # (seo.json lookup), rss.ts, timere.ts, galleries.ts
  pages/                 # routes — see "Routing" below (+ /admin/pameldinger)
  styles/global.css      # Tailwind import, @theme tokens (brand red/navy),
                         # font pairing (Bricolage Grotesque display + Geist
                         # body, self-hosted via @fontsource-variable/* imported
                         # in BaseLayout), .rich-text
                         # styles for rendered markdown, hub/board/card styles
functions/               # Cloudflare Pages Functions (TypeScript):
  _middleware.ts                    # serves /404.html (no) or /en/404/ (en)
                                    # with a real 404 status on misses
  api/registrations.ts            # POST register player/team (Turnstile)
  api/tournaments/[slug]/players.ts  # GET public participant list
  api/admin/registrations.csv.ts  # GET full CSV export (Access-protected)
migrations/              # D1 schema migrations (0001_init.sql)
wrangler.toml            # D1 binding DB (placeholder database_id, see README)
.dev.vars.example        # local env template (Cloudflare TEST keys are safe)
scripts/
  fetch-ranking.mjs      # prebuild step 1: ITHF ranking -> src/data/ranking.json
                         # (committed fallback) + public/ranking.json (served)
  optimize-media.mjs     # prebuild step 2: image pipeline (see "Media pipeline")
  check-links.mjs        # dist link checker
  seed-d1.mjs            # "participants export wix.csv" (git-ignored) -> seed SQL
                         # + regenerates registrations-snapshot.json (public fields)
media-originals/         # ORIGINAL images (git-ignored, local disk only)
  images/  galleries/
public/
  media/images|galleries # web-optimized variants (generated by prebuild,
                         # committed; the om-oss board photos also get 400px
                         # .avif/.webp variants for the <picture> markup in
                         # om-oss.md — see EXTRA_VARIANTS in optimize-media.mjs)
  media/audio|pdf        # originals (small enough, kept as-is)
  _redirects             # Cloudflare Pages 301s
  _headers               # security headers (CSP/HSTS/...) + removes the Pages
                         # default ACAO:* 
  robots.txt  favicon.svg  favicon.png
src/assets/images/       # sources for Astro's <Image>/<Picture>/getImage
                         # pipeline (hero.png — front-page hero + og:image),
                         # committed so CI builds can resolve the imports
migration/               # Phase 1 scraper + one-off fix-ups (raw/ git-ignored)
dist/                    # build output (git-ignored)
```

`src/data/` (unchanged from Phase 1): `timers.json`, `galleries.json`,
`documents.json`, `registrations-snapshot.json`, `seo.json`, `tricks.json`,
`kvalifisering-em26.json`.

## Routing

- Norwegian at root, English mirror under `/en/` (gallery detail pages
  exist only in Norwegian).
- `/services-1` was renamed to `/spill-bordhockey` (301 in `_redirects`,
  `renamedPages` in `src/lib/i18n.ts` maps the slug).
- Blog: `/blog` + `/blog/<n>` (10 posts/page), `/blog/categories/<cat>`.
- Tournaments: `/turneringer` index + `/turneringer/<slug>`. Status
  (upcoming/past) is **computed from the date vs build date** in
  `lib/content.ts` (strict: only today-or-later dates are upcoming).
- RSS: `/blog-feed.xml` and `/en/blog-feed.xml` (exact old paths).
- Nordic characters in slugs stay decoded (`/lær-bordhockey`,
  `/turneringer/jæren-open-2025`).
- All page URLs use the trailing-slash form (`trailingSlash: 'always'`) —
  Cloudflare Pages 308s the slash-less form. Canonicals, hreflang, sitemap,
  nav, cards and markdown links (via the `trailingSlashLinks` hast plugin in
  `astro.config.mjs`) are all normalized; old-URL prefixes that are
  `_redirects` sources (`/members-area`, `/event-details`) keep their form.
- Security headers live in `public/_headers` (HSTS, CSP, nosniff,
  frame-ancestors, and removal of the Pages-default
  `Access-Control-Allow-Origin: *`). If you enable Web Analytics
  (`CloudflareAnalytics.astro`), extend the CSP with
  `https://static.cloudflareinsights.com` in script-src/connect-src.
- SEO: per-page `<title>`/meta description from `src/data/seo.json`
  (fallback: frontmatter), canonical, OG, hreflang no/en pairs
  (x-default → no), `@astrojs/sitemap`, JSON-LD SportsEvent on tournament
  pages + SportsOrganization on the front page.
- Analytics: `CloudflareAnalytics.astro` renders only when
  `PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` is set.

## Media pipeline

Originals live in `media-originals/` — GIT-IGNORED, kept only on local disk
(3.9 GB is too large for GitHub; purged from git history before the first
push). They are the safety master copies; `public/media/` (committed, web
variants) is what the site actually serves. `npm run prebuild`
(`scripts/optimize-media.mjs`, sharp) generates web variants into
`public/media/` at the **same relative paths** the markdown references:
max 1600 px wide, jpeg/webp q80, png palette q80; galleries additionally
get 600 px `thumbs/` for the grid. Idempotent (skips up-to-date outputs;
`FORCE=1` regenerates). Never move originals back into `public/`, and never
commit `media-originals/`. On a fresh clone without originals, prebuild
simply keeps the committed web variants; CMS uploads land in
`media-originals/images/` and get optimized at build time.

## Rules

- No secrets in git. `.dev.vars`, `.env` and `migration/raw/` are git-ignored
  (`.dev.vars.example` holds only Cloudflare's public TEST keys).
- All changes to `main` go through pull requests. Never push directly.
- Backend (`functions/`): parameterised D1 queries only, strict server-side
  validation, Norwegian error messages, never expose email/phone publicly.
  Player identity comes from the ITHF world ranking (`playerId`); client-sent
  country/world_ranking are ignored. Duplicates are rejected per tournament
  on `player_id` for ranked players and on `lower(email)` for everyone else
  (partial unique indexes, `migrations/0002_player_id.sql`). Tournament slugs + team rules:
  `functions/lib/tournament-config.json` (GENERATED by
  `scripts/gen-tournament-config.mjs` in prebuild from tournament
  frontmatter — never edit by hand).
- PII: `participants export wix.csv` (real Wix emails/phones) is git-ignored
  and must NEVER be committed. Derived files with emails/phones stay local;
  `src/data/registrations-snapshot.json` holds public fields only.
- Content lives in `src/content/` as Markdown with YAML frontmatter.
  Body text was migrated **verbatim** from the live site — do not rewrite,
  summarise, or translate it when editing structure. Norwegian stays
  Norwegian, English stays English.
- Media files are referenced from content as absolute paths (`/media/...`).
- Slugs keep decoded Nordic characters (e.g. `jæren-open-2025`,
  `lær-bordhockey`). Wix percent-encodes them in URLs; we decode for paths.

## Frontmatter conventions

- Pages: `title`, `slug`, `lang` (`no`|`en`), `description` (meta
  description), `seoTitle` (original `<title>`), `menuOrder` (from the old
  site nav; front page is `0`; `null` = not in nav).
- Posts: `title`, `slug`, `lang`, `pubDate` (ISO), `categories` (array),
  `cover` (local path), `description` (excerpt).
- Tournaments: `name`, `slug`, `date`, `location`, `prices`,
  `playingSystem`, `status` (`upcoming`|`past` — display status is computed
  at build time, see Routing), `teamMin`/`teamMax` (both null = individual
  tournament, the default; both set = team tournament where teams register
  with teamMin–teamMax players from the ranking combobox; contact info is
  stored once per team). The participant list is rendered from
  `src/data/registrations-snapshot.json` — do NOT re-add it to the Markdown
  body (the Wix duplicate table + registration widget markup was removed in
  Phase 2, see `migration/clean-tournament-bodies.mjs`).

## How to add a news post

Create `src/content/posts/<slug>.md` (and optionally
`src/content/posts/en/<slug>.md` for the English version) with the post
frontmatter above. Put the cover image in `media-originals/images/` and
reference it as `/media/images/<file>` — the prebuild optimizer produces
the web variant automatically. If the post is a translation of another
post, add the slug pair to `postMirrorsNoToEn` in `src/lib/i18n.ts` (used
for hreflang + the language switcher).

## How to add a tournament

Create `src/content/tournaments/<slug>.md` with the tournament frontmatter
above; status is computed from `date` at build time. Body: description,
playing system, prices, `# Tidsskjema` schedule. Also create the English
mirror `src/content/tournaments/en/<slug>.md` (`lang: "en"`, same `slug` and
`date`; translated body with a `# Schedule` heading) — it renders at
`/en/turneringer/<slug>` and supplies the English name on `/en/turneringer`
and the English home page. For a team tournament set
`teamMin`/`teamMax` (e.g. `2`/`2` for Duo-NM); leave both null for an
individual tournament. Participant lists flow from registrations (Wix
export / live D1): `scripts/seed-d1.mjs` regenerates
`src/data/registrations-snapshot.json` (public fields only) for the static
build; the page hydrates live from the API. The slug + team rules reach the
API automatically via `scripts/gen-tournament-config.mjs` (prebuild — reads
only the top-level Norwegian files);
add the tournament's Wix name to `TOURNAMENT_MAP` in
`scripts/seed-d1.mjs` when seeding from an export. Upcoming tournaments get
the live registration form (`RegistrationForm.astro`).

## How to add an image / gallery photo

Put the original in `media-originals/images/` (or
`media-originals/galleries/<slug>/` and register the file in
`src/data/galleries.json`), reference it as `/media/images/<file>` (or
`/media/galleries/<slug>/<file>`), then run `npm run build` — the optimizer
emits the web variants.
