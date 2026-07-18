// Phase 1 scraper: puck.no (Wix) -> markdown content + data JSONs + media registry.
// Polite: ~1 req/s, browser UA. Raw HTML kept in migration/raw/ (git-ignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, "migration", "raw");
const RAW_PAGES = path.join(RAW, "pages");
fs.mkdirSync(RAW_PAGES, { recursive: true });

const BASE = "https://www.puck.no";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DELAY_MS = 1100;

export const problems = [];
export const documents = [];
export const mediaRegistry = new Map(); // remoteUrl -> { local, kind }
export const seo = {}; // path -> { title, description }
export const processed = []; // every URL processed + outputs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => decodeURIComponent(s);

export function problem(page, issue, details) {
  problems.push({ page, issue, details });
  console.log(`  [problem] ${page}: ${issue} — ${details}`);
}

async function fetchPage(url, rawName) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const html = await res.text();
        fs.writeFileSync(path.join(RAW_PAGES, rawName + ".html"), html);
        return { status: res.status, html };
      }
      console.log(`  HTTP ${res.status} for ${url} (attempt ${attempt})`);
    } catch (e) {
      console.log(`  fetch error for ${url}: ${e.message} (attempt ${attempt})`);
    }
    if (attempt < 2) await sleep(3000);
  }
  return { status: 0, html: null };
}

// ---------- media registry ----------
function extFromUri(uri) {
  const m = uri.match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : "jpg";
}
function shortId(uri) {
  const m = uri.match(/_([0-9a-f]{8})[0-9a-f]*~mv2/i) || uri.match(/_([0-9a-f]{8})/i);
  return m ? m[1] : uri.replace(/[^0-9a-z]/gi, "").slice(0, 8);
}
const usedLocals = new Map(); // local path -> remoteUrl
// remoteUrl: original file URL (no transform suffix)
export function registerMedia(remoteUrl, kind, nameHint, { fullName = false } = {}) {
  if (mediaRegistry.has(remoteUrl)) return mediaRegistry.get(remoteUrl).local;
  const uri = remoteUrl.split("/").pop();
  const ext = extFromUri(uri);
  let base = fullName ? nameHint : `${nameHint}-${shortId(uri)}`;
  let local = `/media/${kind}/${base}.${ext}`;
  // avoid collisions between different remotes
  let n = 2;
  while (usedLocals.has(local) && usedLocals.get(local) !== remoteUrl) {
    local = `/media/${kind}/${base}-${n++}.${ext}`;
  }
  usedLocals.set(local, remoteUrl);
  mediaRegistry.set(remoteUrl, { local, kind });
  return local;
}
export function registerImageUri(uri, nameHint) {
  // uri is normally "3b4118_....~mv2.jpg", but some widgets store a full URL
  if (/^https?:\/\//.test(uri)) {
    const stripped = uriFromWixUrl(uri);
    if (!stripped) return null;
    uri = stripped;
  }
  const remote = `${"https://static.wixstatic.com/media/" + uri}`;
  return registerMedia(remote, "images", nameHint);
}
// extract original uri from any wixstatic URL (strip transform /v1/... suffix)
export function uriFromWixUrl(url) {
  const m = url.match(/static\.wixstatic\.com\/media\/([^/\s"]+)/);
  return m ? m[1] : null;
}

// ---------- html -> markdown ----------
const td = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  br: "  \n",
});
td.use(gfm);
td.remove(["script", "style", "svg", "noscript", "button", "input", "select", "textarea", "form", "iframe"]);
// drop empty links and empty headings
td.addRule("dropEmpty", {
  filter: (node) =>
    (node.nodeName === "A" && !node.textContent.trim() && !node.querySelector("img")) ||
    (/^H[1-6]$/.test(node.nodeName) && !node.textContent.trim()),
  replacement: () => "",
});
td.keep = td.keep.bind(td);

function ytLinkFromEl($, el) {
  // react-player preview button with ytimg background
  const html = $.html(el);
  let m = html.match(/ytimg\.com\/vi\/([\w-]+)\//);
  if (m) return `https://youtu.be/${m[1]}`;
  m = html.match(/youtube\.com\/(?:embed\/|watch\?v=)([\w-]+)/);
  if (m) return `https://youtu.be/${m[1]}`;
  return null;
}

// Cheerio-side transformation of a content root; returns cleaned HTML string.
export function prepareContent($, root, ctx) {
  const $root = $(root);
  // 0a. drop Wix show-more truncated duplicates: a paragraph ending in "..." whose
  // words are a strict subset of another paragraph's words on the same page
  {
    const paras = [];
    $root.find("p").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) paras.push({ el, t, words: new Set(t.toLowerCase().replace(/[.,!?…]/g, "").split(/\s+/)) });
    });
    for (const p of paras) {
      if (!/(\.\.\.|…)$/.test(p.t)) continue;
      const dup = paras.some(
        (o) =>
          o.el !== p.el &&
          !/(\.\.\.|…)$/.test(o.t) &&
          o.words.size >= p.words.size &&
          [...p.words].every((w) => o.words.has(w))
      );
      if (dup) $(p.el).remove();
    }
  }
  // 0b. drop Wix default placeholder social links (facebook.com/wix etc.)
  $root.find("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (/^https?:\/\/(www\.)?(facebook|twitter|instagram|linkedin)\.com\/wix\/?$/i.test(href)) {
      problem(ctx.page, "placeholder-social-link", `removed Wix default link: ${href}`);
      const li = $(el).closest("li");
      if (li.length) li.remove();
      else $(el).remove();
    }
  });
  // 0c. demote counter-widget headings (digits/parens only) to paragraphs
  $root.find("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const t = $(el).text().trim();
    if (/^[\d\s()]+$/.test(t)) $(el).replaceWith(`<p>${t}</p>`);
  });
  // 0d. normalize table cells so GFM tables don't break on nested blocks;
  // promote a headerless first row to <th>+thead so turndown-gfm converts it
  $root.find("table").each((_, t) => {
    const $t = $(t);
    if (!$t.find("thead").length && !$t.find("th").length) {
      const firstTr = $t.find("tr").first();
      if (firstTr.length) {
        firstTr.find("td").each((_, c) => $(c).replaceWith(`<th>${$(c).html()}</th>`));
        const thead = $("<thead></thead>");
        firstTr.remove();
        thead.append(firstTr);
        $t.prepend(thead);
      }
    }
  });
  $root.find("td, th").each((_, el) => {
    if ($(el).find("a").length) {
      $(el).html($(el).html().replace(/\s+/g, " "));
    } else {
      const t = $(el).text().replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
      $(el).text(t);
    }
  });
  // 0e. remove Wix form widgets (registration forms, search boxes, maps)
  {
    let removed = 0;
    $root.find(".wixui-text-input, .wixui-dropdown, .wixui-switch, .wixui-checkbox").each((_, el) => {
      $(el).remove();
      removed++;
    });
    $root.find(".wixui-button").each((_, el) => {
      if ($(el).is("a[href]") || $(el).find("a[href]").length) return; // real link button: keep
      $(el).remove();
      removed++;
    });
    // form feedback messages (visible only after submit on the live site)
    $root.find("[data-testid='richTextElement']").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (/^(Takk for din registrering!|Spiller er allerede registrert!|Thank you for registering!)$/.test(t)) {
        $(el).remove();
        removed++;
      }
    });
    if (removed)
      problem(ctx.page, "form-widget", `removed ${removed} Wix form widget elements (registration/search form needs Phase 2 replacement)`);
  }
  $root.find(".wixui-google-map").each((_, el) => {
    problem(ctx.page, "map-embed", "Google Map embed removed (client-rendered, no static equivalent)");
    $(el).remove();
  });
  // images: wow-image / [data-image-info]
  $root.find("[data-image-info]").each((_, el) => {
    try {
      const info = JSON.parse($(el).attr("data-image-info"));
      const uri = info?.imageData?.uri;
      if (!uri) return;
      const local = registerImageUri(uri, ctx.slug);
      const alt = $(el).find("img").attr("alt") || info?.imageData?.name || "";
      $(el).replaceWith(`<p class="md-img"><img src="${local}" alt="${escapeAttr(alt)}"/></p>`);
    } catch {
      problem(ctx.page, "image-parse", "could not parse data-image-info");
    }
  });
  // plain imgs pointing at wixstatic (not already handled)
  $root.find("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src.startsWith("/media/")) return; // already rewritten
    const uri = uriFromWixUrl(src);
    if (!uri) return;
    if (/[?&]w_96\b|\/w_96,/.test(src) && !$(el).attr("data-image-info")) {
      $(el).remove(); // tiny blurred placeholder
      return;
    }
    const local = registerImageUri(uri, ctx.slug);
    const alt = $(el).attr("alt") || "";
    $(el).replaceWith(`<p class="md-img"><img src="${local}" alt="${escapeAttr(alt)}"/></p>`);
  });
  // videos: figure-VIDEO / react-player / iframes (skip nested duplicates)
  $root.find("[data-hook^='figure-VIDEO'], .react-player, [data-hook='video-player']").each((_, el) => {
    if ($(el).parents("[data-hook^='figure-VIDEO'], .react-player, [data-hook='video-player']").length) return;
    const fromMap = !ytLinkFromEl($, el) && ctx.videoMap && ctx.videoMap[ctx.page];
    const url = ytLinkFromEl($, el) || (ctx.videoMap && ctx.videoMap[ctx.page]);
    if (url) {
      if (fromMap) problem(ctx.page, "video-embed-recovered", `empty SSR video shell replaced with recovered URL: ${url}`);
      $(el).replaceWith(`<p><a href="${url}">${url}</a></p>`);
    }
    else {
      problem(ctx.page, "video-embed", "video embed without recognizable URL removed");
      $(el).remove();
    }
  });
  $root.find("iframe").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (/youtube|youtu\.be/.test(src)) {
      const url = ytLinkFromEl($, el) || src;
      $(el).replaceWith(`<p><a href="${url}">${url}</a></p>`);
    } else {
      problem(ctx.page, "iframe-embed", `iframe removed: ${src.slice(0, 120)}`);
    }
  });
  // PDF/document links
  $root.find("a[href*='ugd/']").each((_, el) => {
    // normalize: /en/_files/ugd/<id> serves the same file as /_files/ugd/<id>
    const href = ($(el).attr("href") || "").replace(`${BASE}/en/_files/`, `${BASE}/_files/`);
    const id = href.split("/").pop().replace(".pdf", "");
    const local = registerMedia(href, "pdf", id, { fullName: true });
    $(el).attr("href", local);
    if (ctx.page !== "/årsmøter" && ctx.page !== "/en/årsmøter") {
      const text = $(el).text().trim();
      if (!documents.some((d) => d.sourceUrl === href))
        documents.push({ title: text || id, year: null, file: local, sourceUrl: href, page: ctx.page });
    }
  });
  // internal links -> local decoded paths
  $root.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith(BASE)) {
      $(el).attr("href", decode(href.slice(BASE.length)) || "/");
    } else if (href.startsWith("/")) {
      $(el).attr("href", decode(href));
    }
  });
  // forms: log and remove (turndown would anyway)
  $root.find("form").each((_, el) => {
    problem(ctx.page, "form-widget", "Wix form removed (needs Phase 2 replacement)");
  });
  return $root.html() || "";
}
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function toMarkdown(html) {
  let md = td.turndown(html || "");
  md = md
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\[\s*\]\(\s*\)\s*$/gm, "")
    .trim();
  // collapse consecutive identical images (Wix renders mobile+desktop duplicates)
  let prev;
  do {
    prev = md;
    md = md.replace(/(!\[[^\]]*\]\([^)]+\))\n\n\1/g, "$1");
  } while (md !== prev);
  return md;
}

function yamlEscape(s) {
  if (s == null) return '""';
  return JSON.stringify(String(s));
}
export function frontmatter(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) lines.push(`${k}: null`);
    else if (Array.isArray(v)) lines.push(`${k}: [${v.map(yamlEscape).join(", ")}]`);
    else if (typeof v === "number") lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${yamlEscape(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function getSeo($) {
  return {
    title: ($("title").first().text() || "").trim(),
    description: ($('meta[name="description"]').attr("content") || "").trim(),
  };
}

// ---------- special pages: client-side widgets with real content ----------
// These pages render key content client-side; URLs/mappings captured via Playwright recon.

// /lær-bordhockey-videoer: one YouTube embed per lesson (mapping: migration/videos-raw.json)
function insertLessonVideos(urlPath, md) {
  const raw = path.join(ROOT, "migration", "videos-raw.json");
  if (!fs.existsSync(raw)) return md;
  const map = JSON.parse(fs.readFileSync(raw, "utf8"))[urlPath];
  if (!map) return md;
  let n = 0;
  for (const { lesson, youtube } of map) {
    const headingRe = new RegExp(`^(#+\\s*${lesson.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*$`, "m");
    const link = `\n\n[https://youtu.be/${youtube}](https://youtu.be/${youtube})`;
    if (headingRe.test(md)) {
      md = md.replace(headingRe, `$1${link}`);
      n++;
    } else {
      problem(urlPath, "lesson-heading-not-found", `could not place video ${youtube} for "${lesson}"`);
    }
  }
  if (n !== map.length) problem(urlPath, "lesson-video-mismatch", `placed ${n}/${map.length} videos`);
  return md;
}

// /timere: 9 audio players, client-rendered; names/urls in migration/timers-mapping.json
function appendTimers(urlPath, md) {
  const timers = JSON.parse(fs.readFileSync(path.join(ROOT, "migration", "timers-mapping.json"), "utf8"));
  const slugify = (s) =>
    s
      .toLowerCase()
      .replace(/[äâàá]/g, "a")
      .replace(/[öôóò]/g, "o")
      .replace(/[üûùú]/g, "u")
      .replace(/[éèê]/g, "e")
      .replace(/['’.]/g, "")
      .replace(/[^a-z0-9æøå]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const lines = timers.map((t) => `- [${t.name}](/media/audio/${slugify(t.name)}.mp3) (${t.duration_hint})`);
  problem(urlPath, "audio-widget", "9 Wix audio players replaced by download links to local MP3 files");
  return md + "\n\n" + lines.join("\n") + "\n";
}

// /lær-bordhockey-kombinasjoner: tricks app (filesusr HTML component) with `plays` data array
const TRICKS_EMBED = "https://www-puck-no.filesusr.com/html/3b4118_f70ed992bf63bdb966e84854e385e853.html";
let tricksCache = null;
async function loadTricks() {
  if (tricksCache) return tricksCache;
  const { html } = await fetchPage(TRICKS_EMBED, "embed-kombinasjoner");
  await sleep(DELAY_MS);
  if (!html) return null;
  const m = html.match(/const plays = (\[[^]*?\]);/);
  if (!m) return null;
  const plays = new Function(`return ${m[1]}`)();
  tricksCache = plays;
  return plays;
}
async function appendTricks(noPath, lang, urlPath, md) {
  const plays = await loadTricks();
  if (!plays) {
    problem(urlPath, "embed-fetch-failed", `tricks embed unavailable: ${TRICKS_EMBED}`);
    return md;
  }
  const slugify = (s) =>
    s
      .toLowerCase()
      .replace(/[äâàá]/g, "a")
      .replace(/[öôóò]/g, "o")
      .replace(/[üûùú]/g, "u")
      .replace(/[éèê]/g, "e")
      .replace(/['’.]/g, "")
      .replace(/[^a-z0-9æøå]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
  const items = plays.map((p) => {
    const remote = p.Kombo;
    const uri = uriFromWixUrl(remote);
    const local = uri ? registerMedia(remote, "images", `trick-${slugify(p.Namn)}`) : null;
    return { Namn: p.Namn, Spiller: p.Spiller, Vanskelighetsgrad: p.Vanskelighetsgrad, Forklåring: p.Forklåring, Kombo: local || remote };
  });
  if (lang === "no") {
    fs.writeFileSync(path.join(ROOT, "src/data/tricks.json"), JSON.stringify(items, null, 2) + "\n");
  }
  const rows = items.map(
    (t) =>
      `| ${esc(t.Namn)} | ${esc((t.Spiller || []).join(", "))} | ${esc(t.Vanskelighetsgrad)} | ${esc(t.Forklåring)} | ![${esc(t.Namn)}](${t.Kombo}) |`
  );
  problem(urlPath, "embed-widget", `tricks filter app (${items.length} tricks) flattened to table; structured copy in src/data/tricks.json`);
  return md + `\n\n| Trekk | Posisjon | Vanskelighetsgrad | Forklåring | Kombo |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

// /kvalifisering-mesterskap: standings app (filesusr HTML component), fully SSR'd inside embed
const KVAL_EMBED = "https://www-puck-no.filesusr.com/html/3b4118_432bf5557564639cc27edd57d9a65aae.html";
let kvalCache = null;
async function loadKval() {
  if (kvalCache) return kvalCache;
  const { html } = await fetchPage(KVAL_EMBED, "embed-kvalifisering");
  await sleep(DELAY_MS);
  if (!html) return null;
  const $ = cheerio.load(html);
  const tabs = $("div.navbar a").map((_, a) => $(a).text().trim()).get();
  const updated = $(".update-badge").text().replace(/\s+/g, " ").trim();
  const categories = [];
  $("section").each((i, sec) => {
    const name = tabs[i] || `Kategori ${i + 1}`;
    const players = [];
    $(sec)
      .find("details")
      .each((_, d) => {
        const rank = $(d).find(".player-rank").text().trim();
        const pname = $(d).find(".player-name").text().trim();
        const status = $(d).find(".status-badge").text().trim();
        const points = $(d).find(".points-pill").text().replace(/[^0-9]/g, "");
        const count = $(d).find(".tournaments-count").text().replace(/\s+/g, " ").trim();
        const results = [];
        $(d)
          .find("table tbody tr")
          .each((_, tr) => {
            const c = $(tr).find("td").map((__, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
            if (c.length >= 4) results.push({ Turnering: c[0], Posisjon: c[1], Poeng: c[2], Type: c[3] });
          });
        players.push({ rank, name: pname, status, points, tournaments: count, results });
      });
    categories.push({ name, players });
  });
  kvalCache = { updated, categories };
  return kvalCache;
}
async function appendKval(noPath, lang, urlPath, md) {
  const data = await loadKval();
  if (!data) {
    problem(urlPath, "embed-fetch-failed", `kvalifisering embed unavailable: ${KVAL_EMBED}`);
    return md;
  }
  if (lang === "no") {
    fs.writeFileSync(path.join(ROOT, "src/data/kvalifisering-em26.json"), JSON.stringify(data, null, 2) + "\n");
  }
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
  let out = md + `\n\n${data.updated}\n`;
  for (const cat of data.categories) {
    out += `\n## ${cat.name}\n`;
    for (const p of cat.players) {
      out += `\n### ${esc(p.rank)}. ${esc(p.name)} — ${esc(p.status)} (Poeng: ${esc(p.points)}, ${esc(p.tournaments)})\n\n`;
      out += `| Turnering | Posisjon | Poeng | Type |\n| --- | --- | --- | --- |\n`;
      out += p.results.map((r) => `| ${esc(r.Turnering)} | ${esc(r.Posisjon)} | ${esc(r.Poeng)} | ${esc(r.Type)} |`).join("\n");
      out += "\n";
    }
  }
  const total = data.categories.reduce((a, c) => a + c.players.length, 0);
  problem(urlPath, "embed-widget", `qualification standings app (${total} players, 4 categories) flattened to markdown tables; structured copy in src/data/kvalifisering-em26.json`);
  return out;
}

async function appendSpecialContent(noPath, lang, urlPath, md) {
  if (noPath === "/lær-bordhockey-videoer") return insertLessonVideos(urlPath, md);
  if (noPath === "/timere") return appendTimers(urlPath, md);
  if (noPath === "/lær-bordhockey-kombinasjoner") return appendTricks(noPath, lang, urlPath, md);
  if (noPath === "/kvalifisering-mesterskap") return appendKval(noPath, lang, urlPath, md);
  return md;
}

// ---------- page scraping ----------
const NAV_ORDER = {
  "": 0,
  "services-1": 1,
  lokalligaer: 2,
  "lær-bordhockey": 3,
  turneringer: 4,
  blog: 5,
  ressurser: 6,
  timere: 7,
  "kvalifisering-mesterskap": 8,
  bilder: 9,
  "om-oss": 10,
  "årsmøter": 11,
};

async function scrapeStaticPage(noPath, lang) {
  const urlPath = lang === "en" ? `/en${noPath === "/" ? "" : noPath}` : noPath;
  const url = BASE + (urlPath === "/" ? "/" : encodeURI(urlPath));
  const slug = noPath === "/" ? "index" : decode(noPath.replace(/^\//, ""));
  const { status, html } = await fetchPage(url, `page-${lang}-${slug}`);
  await sleep(DELAY_MS);
  if (!html) {
    problem(urlPath, "fetch-failed", `status ${status}`);
    return null;
  }
  const $ = cheerio.load(html);
  const s = getSeo($);
  seo[urlPath === "/" ? "/" : urlPath] = s;
  const main = $("main#PAGES_CONTAINER");
  if (!main.length) problem(urlPath, "no-main", "PAGES_CONTAINER not found");
  // årsmøter PDFs get year-based names; must register before generic link rewrite
  if (noPath === "/årsmøter" && lang === "no") harvestDocuments($, urlPath);
  const contentHtml = prepareContent($, main, { page: urlPath, slug });
  let md = toMarkdown(contentHtml);
  md = await appendSpecialContent(noPath, lang, urlPath, md);
  const h1 = main.find("h1").first().text().trim();
  const title = s.title.replace(/\s*\|\s*Bordhockeyforbundet\s*$/, "").trim() || h1;
  const out = lang === "en" ? `src/content/pages/en/${slug}.md` : `src/content/pages/${slug}.md`;
  const fm = frontmatter({
    title,
    slug,
    lang,
    description: s.description || null,
    seoTitle: s.title,
    menuOrder: NAV_ORDER[noPath.replace(/^\//, "")] ?? null,
  });
  fs.writeFileSync(path.join(ROOT, out), fm + md + "\n");
  processed.push({ url, outputs: [out] });
  console.log(`page ${urlPath} -> ${out} (${md.length} chars)`);
  return { urlPath, slug, md };
}

// ---------- blog post scraping ----------
async function scrapePost(postPath, lang) {
  const urlPath = lang === "en" ? `/en${postPath}` : postPath;
  const url = BASE + encodeURI(urlPath);
  const slug = decode(postPath.replace(/^\/post\//, ""));
  const { status, html } = await fetchPage(url, `post-${lang}-${slug}`);
  await sleep(DELAY_MS);
  if (!html) {
    problem(urlPath, "fetch-failed", `status ${status}`);
    return null;
  }
  const $ = cheerio.load(html);
  seo[urlPath] = getSeo($);
  const title = $('[data-hook="post-title"]').first().text().trim();
  // excerpt: og:description (short form); body: full post-description block
  const description = (
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    ""
  ).trim();
  // pubDate from embedded JSON (datePublished) or RSS fallback handled by caller
  let pubDate = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || null;
  const categories = [];
  $('[data-hook="post-footer"] a[href*="categories"], [data-hook="post"] a[href*="categories"]').each((_, el) => {
    if ($(el).closest("[data-hook='blog-desktop-header-container'],header,nav").length) return;
    const c = $(el).text().trim();
    if (c && !categories.includes(c)) categories.push(c);
  });
  // cover: hero image or og:image
  let cover = null;
  const heroInfo = $('[data-hook="post-hero-image"]').find("[data-image-info]").attr("data-image-info");
  if (heroInfo) {
    try {
      const uri = JSON.parse(heroInfo)?.imageData?.uri;
      if (uri) cover = registerImageUri(uri, slug);
    } catch {}
  }
  if (!cover) {
    const og = $('meta[property="og:image"]').attr("content");
    const uri = og && uriFromWixUrl(og);
    if (uri) cover = registerImageUri(uri, slug);
  }
  if (!cover) problem(urlPath, "no-cover", "no cover image found");
  // body: the entire post content (text + media) lives in post-description in SSR
  const desc = $('[data-hook="post-description"]').first();
  if (!desc.length || !desc.text().trim()) problem(urlPath, "empty-body", "post-description empty/missing");
  // some videos are empty lazy shells in SSR; recovered URLs live in videos-raw.json
  let videoMap = null;
  const vraw = path.join(ROOT, "migration", "videos-raw.json");
  if (fs.existsSync(vraw)) videoMap = JSON.parse(fs.readFileSync(vraw, "utf8")).posts || null;
  const contentHtml = prepareContent($, desc, { page: urlPath, slug, videoMap });
  const md = toMarkdown(contentHtml);
  const out = lang === "en" ? `src/content/posts/en/${slug}.md` : `src/content/posts/${slug}.md`;
  const fm = frontmatter({
    title,
    slug,
    lang,
    pubDate,
    categories,
    cover,
    description: description || null,
  });
  fs.writeFileSync(path.join(ROOT, out), fm + md + "\n");
  processed.push({ url, outputs: [out] });
  console.log(`post ${urlPath} -> ${out} (${md.length} chars, cover: ${!!cover}, pubDate: ${pubDate})`);
  return { urlPath, slug, md, pubDate, categories };
}

// ---------- tournament scraping ----------
const registrations = {};
async function scrapeTournament(slugEncoded) {
  const slug = decode(slugEncoded);
  const urlPath = `/turneringer/${slug}`;
  const url = BASE + encodeURI(urlPath);
  const { status, html } = await fetchPage(url, `tournament-${slug}`);
  await sleep(DELAY_MS);
  if (!html) {
    problem(urlPath, "fetch-failed", `status ${status}`);
    return null;
  }
  const $ = cheerio.load(html);
  seo[urlPath] = getSeo($);
  const main = $("main#PAGES_CONTAINER");
  // participant table -> structured JSON
  const players = [];
  main.find("table").each((_, table) => {
    const head = $(table).find("tr").first().text();
    if (!/Navn/.test(head) || !/Land/.test(head)) return;
    $(table)
      .find("tr")
      .slice(1)
      .each((_, tr) => {
        const cells = $(tr).find("td,th").map((__, c) => $(c).text().trim()).get();
        if (cells.length >= 4 && cells[1])
          players.push({ name: cells[1], country: cells[2], world_ranking: cells[3] });
        else if (cells.length >= 3 && cells[1])
          players.push({ name: cells[1], country: cells[2], world_ranking: cells[3] ?? "" });
      });
  });
  if (players.length) registrations[slug] = players;
  else problem(urlPath, "no-participants", "no participant table found");
  // frontmatter fields
  const name = main.find("h1").first().text().trim();
  const dateText = main.find("h2").first().text().trim() || null;
  // line-based extraction from <br>-separated rich-text paragraphs
  const PRICE_LINE = /^(Prices?|Deltakeravgift|Deltageravgift|Påmeldingsavgift)\s*:?\s*$/i;
  const SYSTEM_LINE = /^(Playing system|Spillsystem)\s*:?\s*$/i;
  const STOP_LINE = /^(New player\?|Registrer|Påmeldte|Tidsskjema|Prices?|Deltakeravgift|Playing system|Grunnspill)/i;
  const extractSection = (labelRe) => {
    let found = null;
    main.find("p").each((_, p) => {
      if (found) return false;
      const lines = ($(p).html() || "")
        .split(/<br[^>]*>/i)
        .map((frag) => cheerio.load(`<span>${frag}</span>`)("span").text().replace(/\s+/g, " ").trim());
      const idx = lines.findIndex((l) => labelRe.test(l));
      if (idx === -1) return;
      const collected = [];
      for (let i = idx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (STOP_LINE.test(l)) break;
        if (l) collected.push(l); // skip blank lines, don't stop at them
      }
      found = collected.join("; ") || null;
      return false;
    });
    return found;
  };
  const playingSystem = extractSection(SYSTEM_LINE);
  const prices = extractSection(PRICE_LINE);
  const yearMatch = (slug + " " + (dateText || "")).match(/(20\d{2})/);
  const tStatus = yearMatch && Number(yearMatch[1]) >= 2026 ? "upcoming" : "past";
  const contentHtml = prepareContent($, main, { page: urlPath, slug });
  const md = toMarkdown(contentHtml);
  const out = `src/content/tournaments/${slug}.md`;
  const fm = frontmatter({
    name,
    slug,
    date: dateText,
    location: null,
    prices,
    playingSystem,
    status: tStatus,
  });
  fs.writeFileSync(path.join(ROOT, out), fm + md + "\n");
  processed.push({ url, outputs: [out] });
  console.log(`tournament ${urlPath} -> ${out} (${md.length} chars, players: ${players.length})`);
  return { slug, md, players: players.length };
}

// ---------- årsmøter documents ----------
function harvestDocuments($, urlPath) {
  $("a[href*='ugd/'][href$='.pdf']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href.startsWith("http")) return; // already rewritten ones skipped
    let year = null;
    $(el)
      .parents()
      .each((__, anc) => {
        if (year) return false;
        if ($(anc).find("a[href*='ugd/']").length === 1) {
          const m = $(anc).text().match(/(19|20)\d{2}/);
          if (m) {
            year = m[0];
            return false;
          }
        }
      });
    const id = href.split("/").pop().replace(".pdf", "");
    const name = year ? `arsmote-${year}` : id;
    const local = registerMedia(href, "pdf", name, { fullName: true });
    if (documents.some((d) => d.sourceUrl === href)) return;
    documents.push({
      title: year ? `Årsmøtereferat ${year}` : id,
      year: year ? Number(year) : null,
      file: local,
      sourceUrl: href,
      page: urlPath,
    });
  });
}

// ---------- main ----------
async function main() {
  const PAGES = [
    "/",
    "/om-oss",
    "/services-1",
    "/lokalligaer",
    "/lær-bordhockey",
    "/lær-bordhockey-videoer",
    "/lær-bordhockey-kombinasjoner",
    "/turneringer",
    "/timere",
    "/ressurser",
    "/kvalifisering-mesterskap",
    "/bilder",
    "/blog",
    "/årsmøter",
  ];

  // 1. tournaments (NO)
  const TOURNAMENTS = [
    "norway-open-2026",
    "duo-nm-2026",
    "norgesmesterskapet-2026-dame",
    "norgesmesterskapet-2026-veteran",
    "norgesmesterskapet-2026-junior",
    "norgesmesterskapet-2026-u13",
    "norgesmesterskapet-2026",
    "trondheim-open-2025",
    "jæren-open-2025",
    "bergen-open-2025",
    "sudden-death-cup",
    "norway-open-2025",
  ];
  console.log("== tournaments ==");
  for (const t of TOURNAMENTS) await scrapeTournament(t);

  // 2. blog posts NO (sitemap is authoritative)
  const sitemap = fs.readFileSync(path.join(RAW, "blog-posts-sitemap.xml"), "utf8");
  const noPosts = [...sitemap.matchAll(/<loc>(https:\/\/www\.puck\.no\/post\/[^<]+)<\/loc>/g)].map((m) =>
    decode(m[1].replace(BASE, ""))
  );
  console.log(`== ${noPosts.length} NO posts ==`);
  for (const p of noPosts) await scrapePost(p, "no");

  // 3. EN posts (known + any discovered in en-blog-links.json if present)
  const enExtraPath = path.join(ROOT, "migration", "en-posts.json");
  let enPosts = [
    "/post/norway-open-2025-drama-world-stars-and-cinnamon-buns",
    "/post/who-will-win-the-norwegian-championship-2025",
  ];
  if (fs.existsSync(enExtraPath)) enPosts = JSON.parse(fs.readFileSync(enExtraPath, "utf8"));
  console.log(`== ${enPosts.length} EN posts ==`);
  for (const p of enPosts) await scrapePost(p, "en");

  // 4. static pages NO + EN
  console.log("== static pages ==");
  for (const p of PAGES) await scrapeStaticPage(p, "no");
  for (const p of PAGES) await scrapeStaticPage(p, "en");

  // 5. data files
  fs.writeFileSync(
    path.join(ROOT, "src/data/registrations-snapshot.json"),
    JSON.stringify({ snapshot_date: new Date().toISOString().slice(0, 10), tournaments: registrations }, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(ROOT, "src/data/documents.json"), JSON.stringify(documents, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "src/data/seo.json"), JSON.stringify(seo, null, 2) + "\n");

  // timers (mapping captured during recon)
  const timersMap = JSON.parse(fs.readFileSync(path.join(ROOT, "migration", "timers-mapping.json"), "utf8"));
  const slugify = (s) =>
    s
      .toLowerCase()
      .replace(/[äâàá]/g, "a")
      .replace(/[öôóò]/g, "o")
      .replace(/[üûùú]/g, "u")
      .replace(/[éèê]/g, "e")
      .replace(/['’.]/g, "")
      .replace(/[^a-z0-9æøå]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const timers = timersMap.map((t) => {
    const file = `/media/audio/${slugify(t.name)}.mp3`;
    mediaRegistry.set(t.url, { local: file, kind: "audio" });
    return { title: t.name, file, duration_hint: t.duration_hint };
  });
  fs.writeFileSync(path.join(ROOT, "src/data/timers.json"), JSON.stringify(timers, null, 2) + "\n");

  // media registry + problems + processed
  const reg = {};
  for (const [remote, v] of mediaRegistry) reg[remote] = v;
  fs.writeFileSync(path.join(ROOT, "migration", "media-registry.json"), JSON.stringify(reg, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "migration", "processed.json"), JSON.stringify(processed, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "migration", "problems.json"), JSON.stringify(problems, null, 2) + "\n");
  console.log(`\nDone. problems: ${problems.length}, media: ${mediaRegistry.size}, urls: ${processed.length}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
