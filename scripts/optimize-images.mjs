import { readdirSync, statSync, mkdirSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import sharp from "sharp";

const DIR = "public/media/images";
const BACKUP_DIR = "migration/optimized-originals";
const MAX_WIDTH = 1600;
const QUALITY = 80;
const MIN_BYTES = 150 * 1024; // only touch files larger than 150 KB
const EXTS = new Set([".png", ".jpg", ".jpeg"]);
const SCAN_EXT = new Set([".md", ".mdx", ".json", ".astro", ".ts", ".tsx"]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

mkdirSync(BACKUP_DIR, { recursive: true });
const converted = [];
let saved = 0;

for (const file of walk(DIR)) {
  const ext = extname(file).toLowerCase();
  if (!EXTS.has(ext)) continue;
  const before = statSync(file).size;
  if (before < MIN_BYTES) continue;
  const target = file.slice(0, -ext.length) + ".webp";
  const img = sharp(file);
  const meta = await img.metadata();
  if (meta.width > MAX_WIDTH) img.resize({ width: MAX_WIDTH });
  await img.webp({ quality: QUALITY }).toFile(target);
  const after = statSync(target).size;
  saved += before - after;
  converted.push({ from: "/" + file.replace(/^public\//, "").replaceAll("\\", "/"),
                   to: "/" + target.replace(/^public\//, "").replaceAll("\\", "/") });
  renameSync(file, join(BACKUP_DIR, basename(file)));
  console.log(`${(before/1024).toFixed(0)} KB → ${(after/1024).toFixed(0)} KB  ${basename(target)}`);
}

// Rewrite references in src/
for (const file of walk("src")) {
  if (!SCAN_EXT.has(extname(file))) continue;
  let text = readFileSync(file, "utf8");
  let changed = false;
  for (const { from, to } of converted) {
    if (text.includes(from)) { text = text.split(from).join(to); changed = true; }
  }
  if (changed) writeFileSync(file, text);
}

console.log(`\nConverted ${converted.length} images, saved ${(saved/1024/1024).toFixed(1)} MB, originals backed up to ${BACKUP_DIR}`);
