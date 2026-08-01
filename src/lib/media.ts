import path from 'node:path';
import sharp from 'sharp';

export interface ImageDimensions {
  width: number;
  height: number;
}

// Vite bundles this module before static rendering, so import.meta.url no
// longer points at src/lib in the generated entrypoint. Astro commands run
// from the project root; resolve public/ from that stable root instead.
const publicDir = path.resolve(process.cwd(), 'public');
const metadataCache = new Map<string, Promise<ImageDimensions | null>>();

/**
 * Read the intrinsic dimensions of a checked-in image under public/media.
 *
 * This helper only runs while Astro renders the static site. Invalid, remote,
 * or missing paths fail open so an editor typo is still reported by the link
 * checker rather than crashing every content render with a filesystem error.
 */
export function getPublicImageDimensions(src: string | null | undefined): Promise<ImageDimensions | null> {
  if (!src?.startsWith('/media/')) return Promise.resolve(null);

  const cleanSrc = src.split(/[?#]/, 1)[0];
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(cleanSrc.slice(1));
  } catch {
    return Promise.resolve(null);
  }

  const absolutePath = path.resolve(publicDir, relativePath);
  if (!absolutePath.startsWith(`${publicDir}${path.sep}`)) return Promise.resolve(null);

  let pending = metadataCache.get(absolutePath);
  if (!pending) {
    pending = sharp(absolutePath)
      .metadata()
      .then(({ width, height }) =>
        Number.isInteger(width) && Number.isInteger(height) && width! > 0 && height! > 0
          ? { width: width!, height: height! }
          : null,
      )
      .catch(() => null);
    metadataCache.set(absolutePath, pending);
  }
  return pending;
}
