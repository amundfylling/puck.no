#!/usr/bin/env node
/**
 * Prebuild: generate web-optimized image variants from media-originals/ into
 * public/media/ at the SAME relative paths the markdown references.
 *
 *  - media-originals/images/<file>          -> public/media/images/<file>          (max 1600px wide)
 *  - media-originals/galleries/<slug>/<f>   -> public/media/galleries/<slug>/<f>   (max 1600px wide, lightbox)
 *                                            -> public/media/galleries/<slug>/thumbs/<f> (max 600px wide, grid)
 *
 * Formats are kept as-is (jpg stays jpg, png stays png) so existing
 * /media/... references keep working. Idempotent: skips outputs that are
 * newer than their source. Set FORCE=1 to regenerate everything.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'media-originals');
const OUT = path.join(ROOT, 'public', 'media');
const FORCE = process.env.FORCE === '1';
const CONCURRENCY = 8;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function fresh(dest, src) {
  if (FORCE) return false;
  try {
    const [d, s] = await Promise.all([fs.stat(dest), fs.stat(src)]);
    return d.mtimeMs >= s.mtimeMs;
  } catch {
    return false;
  }
}

async function optimize(src, dest, maxWidth) {
  if (await fresh(dest, src)) return 'skip';
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const img = sharp(src).rotate(); // respect EXIF orientation
  const meta = await img.metadata();
  if (meta.width && meta.width > maxWidth) img.resize({ width: maxWidth });
  const ext = path.extname(src).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') img.jpeg({ quality: 80, mozjpeg: true });
  else if (ext === '.png') img.png({ compressionLevel: 9, palette: true, quality: 80 });
  else if (ext === '.webp') img.webp({ quality: 80 });
  else throw new Error(`Unsupported image type: ${src}`);
  await img.toFile(dest);
  return 'done';
}

// Extra modern-format variants for the om-oss board photos. Markdown content
// cannot use Astro's <Image>/<Picture>, so the <picture> markup in
// src/content/pages/om-oss.md (and en/om-oss.md) references these generated
// variants directly; the optimized PNG stays as the fallback.
const EXTRA_VARIANTS = { pattern: /^om-oss-.+\.png$/, widths: [400], formats: ['avif', 'webp'] };

async function variant(src, dest, width, format) {
  if (await fresh(dest, src)) return 'skip';
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const img = sharp(src).rotate().resize({ width, withoutEnlargement: true });
  if (format === 'avif') img.avif({ quality: 60 });
  else img.webp({ quality: 80 });
  await img.toFile(dest);
  return 'done';
}

const jobs = [];
try {
  for await (const src of walk(SRC)) {
    const rel = path.relative(SRC, src); // e.g. images/foo.jpg or galleries/slug/foo.jpg
    const ext = path.extname(src).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
    const dest = path.join(OUT, rel);
    if (rel.startsWith('galleries' + path.sep)) {
      const dir = path.dirname(dest);
      jobs.push(() => optimize(src, path.join(dir, 'thumbs', path.basename(dest)), 600));
      jobs.push(() => optimize(src, dest, 1600));
    } else {
      jobs.push(() => optimize(src, dest, 1600));
      if (EXTRA_VARIANTS.pattern.test(path.basename(src))) {
        const base = path.basename(src, ext);
        for (const w of EXTRA_VARIANTS.widths) {
          for (const f of EXTRA_VARIANTS.formats) {
            jobs.push(() => variant(src, path.join(path.dirname(dest), `${base}-${w}.${f}`), w, f));
          }
        }
      }
    }
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    // No originals (fresh clone / originals kept off-git). The committed
    // web variants in public/media are used as-is — nothing to do.
    console.log('optimize-media: media-originals/ mangler — bruker committede varianter i public/media (ingenting å gjøre)');
    process.exit(0);
  }
  throw err;
}

let done = 0, skipped = 0, failed = 0;
async function worker(queue) {
  while (queue.length) {
    const job = queue.shift();
    try {
      const r = await job();
      if (r === 'skip') skipped++; else done++;
    } catch (err) {
      failed++;
      console.error('ERROR', err.message);
    }
  }
}
const queue = [...jobs];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`optimize-media: ${done} generated, ${skipped} up-to-date, ${failed} failed (${jobs.length} total)`);
if (failed) process.exit(1);
