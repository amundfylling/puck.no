#!/usr/bin/env node
/**
 * Restore media-originals/ from the live Wix CDN using migration/manifest.json.
 * Needed only if the local originals are lost (they are git-ignored by design).
 * Downloads each image, verifies sha256, ~1 req/s. Audio/PDF originals are
 * already committed under public/media and are skipped.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'migration/manifest.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = manifest.media.filter((m) => m.local.startsWith('/media/images/') || m.local.startsWith('/media/galleries/'));
console.log(`restore-originals: ${targets.length} filer skal lastes ned`);

let ok = 0, skipped = 0, failed = 0;
const failures = [];
for (const m of targets) {
  const rel = m.local.replace(/^\/media\//, '');
  const dest = path.join(ROOT, 'media-originals', rel);
  try {
    const existing = await fs.stat(dest).catch(() => null);
    if (existing && existing.size === m.bytes) {
      skipped++;
      continue;
    }
    const res = await fetch(m.remote, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash !== m.sha256) throw new Error(`sha256 mismatch (${buf.length} bytes)`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    ok++;
    if (ok % 50 === 0) console.log(`restore-originals: ${ok} nedlastet...`);
    await sleep(1000); // vær høflig
  } catch (err) {
    failed++;
    failures.push({ remote: m.remote, error: err.message });
    console.error(`FEIL ${m.remote}: ${err.message}`);
  }
}
console.log(`restore-originals: ${ok} nedlastet, ${skipped} fantes fra før, ${failed} feilet`);
if (failures.length) {
  await fs.writeFile(path.join(ROOT, 'migration', 'restore-failures.json'), JSON.stringify(failures, null, 1));
  process.exit(1);
}
