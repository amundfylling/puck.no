import sharp from "sharp";
// Source: the original hero photo. Try these paths in order; use the first that exists.
import { existsSync } from "node:fs";
const candidates = ["src/assets/hero.png", "src/assets/hero.jpg",
  "migration/optimized-originals/index-2f7a1d75.png", "public/media/images/index-2f7a1d75.webp"];
const src = candidates.find(existsSync);
if (!src) { console.error("No hero source found in: " + candidates.join(", ")); process.exit(1); }
await sharp(src).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 82 })
  .toFile("public/media/images/og-default.jpg");
console.log("og-default.jpg written from " + src);
