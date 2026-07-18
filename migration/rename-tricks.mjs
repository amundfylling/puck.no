// Rename trick-* images on disk to match the (new, transliterating) slugify names
// recorded in media-registry.json. Pairs files by their 8-char shortid suffix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const IMG = path.join(ROOT, "public", "media", "images");
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "migration", "media-registry.json"), "utf8"));

// new canonical names from registry, keyed by shortid
const newByShort = {};
for (const { local } of Object.values(registry)) {
  const m = local.match(/^\/media\/images\/(trick-.*-([0-9a-f]{8})\.\w+)$/);
  if (m) newByShort[m[2]] = m[1];
}

let renamed = 0;
for (const f of fs.readdirSync(IMG)) {
  if (!f.startsWith("trick-")) continue;
  const m = f.match(/-([0-9a-f]{8})\.\w+$/);
  if (!m) continue;
  const target = newByShort[m[1]];
  if (target && target !== f) {
    if (fs.existsSync(path.join(IMG, target))) {
      // already have the new-name file; remove the old duplicate
      fs.unlinkSync(path.join(IMG, f));
      console.log(`removed stale ${f}`);
    } else {
      fs.renameSync(path.join(IMG, f), path.join(IMG, target));
      console.log(`${f} -> ${target}`);
    }
    renamed++;
  }
}
console.log(`renamed/removed: ${renamed}`);
