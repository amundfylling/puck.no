// Phase 1 verification: counts, file integrity, markdown hygiene.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUB = path.join(ROOT, "public");
const fail = [];
const warn = [];
const ok = (msg) => console.log("  ok  " + msg);
const bad = (msg) => {
  fail.push(msg);
  console.log(" FAIL " + msg);
};
const note = (msg) => {
  warn.push(msg);
  console.log(" warn  " + msg);
};

const ls = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)) : []);

// --- counts ---
const postsNo = ls(path.join(ROOT, "src/content/posts"), /\.md$/);
const postsEn = ls(path.join(ROOT, "src/content/posts/en"), /\.md$/);
const pagesNo = ls(path.join(ROOT, "src/content/pages"), /\.md$/);
const pagesEn = ls(path.join(ROOT, "src/content/pages/en"), /\.md$/);
const tournaments = ls(path.join(ROOT, "src/content/tournaments"), /\.md$/);
console.log("== counts ==");
postsNo.length === 35 ? ok(`NO posts: ${postsNo.length}`) : bad(`NO posts: ${postsNo.length} (expected 35)`);
postsEn.length === 2 ? ok(`EN posts: ${postsEn.length}`) : bad(`EN posts: ${postsEn.length} (expected 2)`);
pagesNo.length === 14 ? ok(`NO pages: ${pagesNo.length}`) : bad(`NO pages: ${pagesNo.length} (expected 14)`);
pagesEn.length === 14 ? ok(`EN pages: ${pagesEn.length}`) : bad(`EN pages: ${pagesEn.length} (expected 14)`);
tournaments.length === 12 ? ok(`tournaments: ${tournaments.length}`) : bad(`tournaments: ${tournaments.length} (expected 12)`);

const mp3s = ls(path.join(PUB, "media/audio"), /\.mp3$/);
const pdfs = ls(path.join(PUB, "media/pdf"), /\.pdf$/);
const images = ls(path.join(PUB, "media/images"), /\.(jpg|jpeg|png|webp|gif)$/);
mp3s.length === 9 ? ok(`mp3: ${mp3s.length}`) : bad(`mp3: ${mp3s.length} (expected 9)`);
pdfs.length === 14 ? ok(`pdf: ${pdfs.length}`) : bad(`pdf: ${pdfs.length} (expected 14)`);
console.log(`  info  images: ${images.length}`);

const galleries = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/galleries.json"), "utf8"));
const gSlugs = Object.keys(galleries);
gSlugs.length === 3 ? ok(`galleries: ${gSlugs.length}`) : bad(`galleries: ${gSlugs.length} (expected 3)`);
for (const [slug, g] of Object.entries(galleries)) {
  const dir = path.join(PUB, "media/galleries", slug);
  const onDisk = ls(dir, /\.(jpg|jpeg|png|webp)$/);
  onDisk.length === g.images.length
    ? ok(`gallery ${slug}: ${onDisk.length} files`)
    : bad(`gallery ${slug}: ${onDisk.length} on disk vs ${g.images.length} listed`);
}

// --- file integrity ---
console.log("== integrity ==");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "migration/manifest.json"), "utf8"));
let zero = 0,
  missing = 0,
  badpdf = 0;
for (const f of manifest.media) {
  const abs = path.join(PUB, f.local);
  if (!fs.existsSync(abs)) {
    missing++;
    bad(`missing: ${f.local}`);
    continue;
  }
  if (fs.statSync(abs).size === 0) {
    zero++;
    bad(`zero bytes: ${f.local}`);
  }
  if (f.local.endsWith(".pdf")) {
    const head = fs.readFileSync(abs).subarray(0, 4).toString("latin1");
    if (head !== "%PDF") {
      badpdf++;
      bad(`bad pdf magic: ${f.local}`);
    }
  }
}
if (!zero && !missing && !badpdf) ok(`all ${manifest.media.length} media files present, non-empty, PDFs valid`);

// mp3 durations via afinfo
console.log("== mp3 durations (afinfo) ==");
for (const f of mp3s) {
  try {
    const out = execFileSync("afinfo", [path.join(PUB, "media/audio", f)], { encoding: "utf8" });
    const dur = out.match(/estimated duration:\s*([\d.]+)/);
    console.log(`  ${f}: ${dur ? Math.round(dur[1]) + "s" : "?"}`);
  } catch (e) {
    bad(`afinfo failed for ${f}`);
  }
}

// --- markdown hygiene ---
console.log("== markdown hygiene ==");
const mdFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) mdFiles.push(p);
  }
};
walk(path.join(ROOT, "src/content"));
let wixClass = 0,
  wixLink = 0,
  missingMedia = 0,
  noFm = 0;
for (const f of mdFiles) {
  const text = fs.readFileSync(f, "utf8");
  if (!text.startsWith("---\n")) noFm++, bad(`no frontmatter: ${path.relative(ROOT, f)}`);
  if (/wixui-|font_\d|color_\d/.test(text)) wixClass++, bad(`wix class in ${path.relative(ROOT, f)}`);
  if (/style="/.test(text)) bad(`inline style in ${path.relative(ROOT, f)}`);
  const wixUrls = text.match(/https:\/\/static\.wixstatic\.com\S*/g);
  if (wixUrls) wixLink += wixUrls.length, bad(`${wixUrls.length} wixstatic URLs in ${path.relative(ROOT, f)}`);
  for (const m of text.matchAll(/\]\((\/media\/[^)\s]+)\)|src="(\/media\/[^"]+)"/g)) {
    const p = m[1] || m[2];
    if (!fs.existsSync(path.join(PUB, p))) missingMedia++, bad(`missing media ${p} referenced in ${path.relative(ROOT, f)}`);
  }
}
if (!wixClass && !wixLink && !missingMedia && !noFm) ok(`all ${mdFiles.length} markdown files clean`);

console.log(`\n== summary ==`);
console.log(`failures: ${fail.length}, warnings: ${warn.length}`);
process.exit(fail.length ? 1 : 0);
