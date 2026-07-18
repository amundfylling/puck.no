// Phase 1 media downloader: downloads everything in media-registry.json plus the
// gallery images (galleries-raw.json), verifies bytes, writes galleries.json and
// the final migration/manifest.json with sha256 + sizes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIG = path.join(ROOT, "migration");
const PUB = path.join(ROOT, "public");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const downloadProblems = [];
const mediaFiles = []; // {remote, local, bytes, sha256}

async function download(remote, localRel) {
  const dest = path.join(PUB, localRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    // already downloaded: record and skip
    const buf = fs.readFileSync(dest);
    mediaFiles.push({ remote, local: localRel, bytes: buf.length, sha256: sha256(buf) });
    return true;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(remote, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) throw new Error("empty body");
        fs.writeFileSync(dest, buf);
        mediaFiles.push({ remote, local: localRel, bytes: buf.length, sha256: sha256(buf) });
        return true;
      }
      console.log(`  HTTP ${res.status} ${remote} (attempt ${attempt})`);
    } catch (e) {
      console.log(`  error ${remote}: ${e.message} (attempt ${attempt})`);
    }
    if (attempt < 3) await sleep(2500);
  }
  downloadProblems.push({ remote, local: localRel, issue: "download-failed" });
  return false;
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(path.join(MIG, "media-registry.json"), "utf8"));
  const galleriesRaw = JSON.parse(fs.readFileSync(path.join(MIG, "galleries-raw.json"), "utf8"));

  // 1. registry: images / pdf / audio -> local paths already decided by scraper
  const entries = Object.entries(registry);
  console.log(`registry: ${entries.length} files`);
  let i = 0;
  for (const [remote, { local }] of entries) {
    i++;
    if (i % 25 === 0) console.log(`  ${i}/${entries.length}`);
    await download(remote, local);
    await sleep(DELAY_MS);
  }

  // 2. galleries: originals under public/media/galleries/<slug>/
  const galleries = {};
  for (const [slug, { title, ids }] of Object.entries(galleriesRaw)) {
    const files = [];
    for (const uri of ids) {
      const ext = (uri.match(/\.(\w+)$/) || [null, "jpg"])[1].toLowerCase();
      const short = (uri.match(/_([0-9a-f]{8})/) || [null, uri.slice(0, 8)])[1];
      const local = `/media/galleries/${slug}/${short}.${ext}`;
      files.push(local);
      await download(`https://static.wixstatic.com/media/${uri}`, local);
      await sleep(DELAY_MS);
    }
    galleries[slug] = { title, images: files };
    console.log(`gallery ${slug}: ${files.length} images`);
  }
  fs.writeFileSync(path.join(ROOT, "src/data/galleries.json"), JSON.stringify(galleries, null, 2) + "\n");

  // 3. validation: pdf magic bytes, non-zero
  for (const f of mediaFiles) {
    const abs = path.join(PUB, f.local);
    if (!fs.existsSync(abs) || fs.statSync(abs).size === 0)
      downloadProblems.push({ remote: f.remote, local: f.local, issue: "missing-or-empty" });
    if (f.local.endsWith(".pdf")) {
      const head = fs.readFileSync(abs).subarray(0, 4).toString("latin1");
      if (head !== "%PDF") downloadProblems.push({ remote: f.remote, local: f.local, issue: "bad-pdf-magic" });
    }
  }

  // 4. manifest
  const processed = JSON.parse(fs.readFileSync(path.join(MIG, "processed.json"), "utf8"));
  const scrapeProblems = JSON.parse(fs.readFileSync(path.join(MIG, "problems.json"), "utf8"));
  const count = (re) => mediaFiles.filter((f) => re.test(f.local)).length;
  const totals = {
    urls_processed: processed.length,
    media_files: mediaFiles.length,
    media_bytes: mediaFiles.reduce((a, f) => a + f.bytes, 0),
    images: count(/\/media\/images\//),
    gallery_images: count(/\/media\/galleries\//),
    pdfs: count(/\.pdf$/),
    mp3s: count(/\.mp3$/),
  };
  const manifest = {
    generated: new Date().toISOString(),
    urls: processed,
    media: mediaFiles,
    totals,
    problems: [...scrapeProblems, ...downloadProblems],
  };
  fs.writeFileSync(path.join(MIG, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (downloadProblems.length)
    fs.writeFileSync(path.join(MIG, "download-problems.json"), JSON.stringify(downloadProblems, null, 2) + "\n");
  console.log(`done. ${mediaFiles.length} files, ${totals.media_bytes} bytes, ${downloadProblems.length} download problems`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
