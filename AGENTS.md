# puck.no — NBHF website rebuild

Rebuild of https://www.puck.no/ (Wix) as a static Astro site for Norges
Bordhockeyforbund (NBHF, the Norwegian table hockey federation). Content is
bilingual: Norwegian (default, at `/...`) and English (at `/en/...`).

## Status

- **Phase 1 (done):** content & media migration from the live Wix site.
  Markdown content, structured data, and all media assets are in the repo.
- **Phase 2 (todo):** Astro site implementation (layouts, routing, SEO).

## Repository structure

```
src/
  content/
    pages/           # static pages, Norwegian (index.md = front page)
      en/            # static pages, English
    posts/           # blog posts, Norwegian
      en/            # blog posts, English
    tournaments/     # tournament pages (Norwegian slugs; body text is
                     # intentionally verbatim, often English)
  data/
    timers.json                # timer audio tracks
    galleries.json             # photo galleries -> local image lists
    documents.json             # årsmøte (annual meeting) PDFs
    registrations-snapshot.json# tournament participant lists (2026-07 snapshot)
    seo.json                   # original <title> + meta description per path
    tricks.json                # 121 bordhockey tricks (kombinasjoner page app)
    kvalifisering-em26.json    # EM26 qualification standings (4 categories)
public/
  media/
    images/          # page/post images (originals from Wix)
    audio/           # timer MP3s
    pdf/             # årsmøte and other documents
    galleries/<slug>/# gallery photos
migration/
  scrape.mjs         # Phase 1 scraper (Node, cheerio + turndown)
  download-media.mjs # Phase 1 media downloader (writes manifest.json)
  verify.mjs         # Phase 1 verification script
  manifest.json      # every URL processed + every media file (bytes, sha256)
  raw/               # raw HTML of fetched pages (git-ignored)
  # recon data used by the scraper:
  timers-mapping.json   # timer name -> Wix MP3 URL (9 tracks)
  videos-raw.json       # lesson -> YouTube id mappings (Playwright recon)
  galleries-raw.json    # gallery image ids (Playwright recon)
  en-posts.json         # the 2 EN blog post paths
  # one-off fix-ups kept for reference:
  patch-tournaments.mjs # re-derives prices/playingSystem frontmatter from raw HTML
  rename-tricks.mjs     # renames trick images to transliterated slugs
```

## Rules

- No secrets in git. `.dev.vars` and `migration/raw/` are git-ignored.
- All changes to `main` go through pull requests. Never push directly.
- Content lives in `src/content/` as Markdown with YAML frontmatter.
  Body text was migrated **verbatim** from the live site — do not rewrite,
  summarise, or translate it when editing structure. Norwegian stays
  Norwegian, English stays English.
- Media files live in `public/media/` and are referenced from content as
  absolute paths (`/media/...`).
- Slugs keep decoded Nordic characters (e.g. `jæren-open-2025`,
  `lær-bordhockey`). Wix percent-encodes them in URLs; we decode for paths.

## Frontmatter conventions

- Pages: `title`, `slug`, `lang` (`no`|`en`), `description` (meta
  description), `seoTitle` (original `<title>`), `menuOrder` (from the old
  site nav; front page is `0`; `null` = not in nav).
- Posts: `title`, `slug`, `lang`, `pubDate` (ISO), `categories` (array),
  `cover` (local path), `description` (excerpt).
- Tournaments: `name`, `slug`, `date`, `location`, `prices`,
  `playingSystem`, `status` (`upcoming`|`past`). The participant list is a
  Markdown table in the body and structured data in
  `src/data/registrations-snapshot.json`.

## How to add a news post

Create `src/content/posts/<slug>.md` (and optionally
`src/content/posts/en/<slug>.md` for the English version) with the post
frontmatter above. Put the cover image in `public/media/images/` and
reference it as `/media/images/<file>`.

## How to add a tournament

Create `src/content/tournaments/<slug>.md` with the tournament frontmatter
above; set `status: upcoming`. Body: description, playing system, prices,
schedule, and the participant table. Mirror the participant list into
`src/data/registrations-snapshot.json` (or the future database) when
registrations open.
