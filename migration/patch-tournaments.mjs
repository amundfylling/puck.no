// One-off patch: improve prices/playingSystem frontmatter for tournament files,
// re-parsing the saved raw HTML (no network). Handles EN ("Prices", "Playing system")
// and NO ("Deltakeravgift") labels inside <br>-separated rich-text paragraphs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, "migration", "raw", "pages");
const OUT = path.join(ROOT, "src", "content", "tournaments");

const PRICE_LINE = /^(Prices?|Deltakeravgift|Deltageravgift|Påmeldingsavgift)\s*:?\s*$/i;
const SYSTEM_LINE = /^(Playing system|Spillsystem)\s*:?\s*$/i;
const STOP_LINE = /^(New player\?|Registrer|Påmeldte|Tidsskjema|Prices?|Deltakeravgift|Playing system|Grunnspill)/i;

function linesOfParagraph($, p) {
  const html = $(p).html() || "";
  return html
    .split(/<br[^>]*>/i)
    .map((frag) => cheerio.load(`<span>${frag}</span>`)("span").text().replace(/\s+/g, " ").trim());
}

function extract($, main, labelRe) {
  let found = null;
  main.find("p").each((_, p) => {
    if (found) return false;
    const lines = linesOfParagraph($, p);
    const idx = lines.findIndex((l) => labelRe.test(l));
    if (idx === -1) return;
    const collected = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (STOP_LINE.test(l)) break;
      if (l) collected.push(l);
    }
    found = collected.join("; ") || null;
    return false;
  });
  return found;
}

const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".md"));
for (const f of files) {
  const slug = f.replace(/\.md$/, "");
  const rawPath = path.join(RAW, `tournament-${slug}.html`);
  if (!fs.existsSync(rawPath)) {
    console.log(`no raw html for ${slug}`);
    continue;
  }
  const $ = cheerio.load(fs.readFileSync(rawPath, "utf8"));
  const main = $("main#PAGES_CONTAINER");
  const prices = extract($, main, PRICE_LINE);
  const playingSystem = extract($, main, SYSTEM_LINE);
  let md = fs.readFileSync(path.join(OUT, f), "utf8");
  const setFm = (md, key, val) => {
    const line = val == null ? `${key}: null` : `${key}: ${JSON.stringify(val)}`;
    return md.replace(new RegExp(`^${key}:.*$`, "m"), line);
  };
  md = setFm(md, "prices", prices);
  md = setFm(md, "playingSystem", playingSystem);
  fs.writeFileSync(path.join(OUT, f), md);
  console.log(`${slug}:`);
  console.log(`  prices: ${prices}`);
  console.log(`  system: ${playingSystem ? playingSystem.slice(0, 90) + (playingSystem.length > 90 ? "…" : "") : null}`);
}
