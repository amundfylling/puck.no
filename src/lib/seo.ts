import seoData from '../data/seo.json';

type SeoEntry = { title: string; description: string };
const table = seoData as Record<string, SeoEntry>;

/** Paths that changed after the scrape; look up the old path in seo.json. */
const legacyPath: Record<string, string> = {
  '/spill-bordhockey': '/services-1',
  '/en/spill-bordhockey': '/en/services-1',
};

/**
 * Original <title> + meta description from the live Wix site, keyed by path
 * (e.g. "/om-oss", "/en/post/..."). Returns null when the old site had no
 * entry for the path (new pages, pagination etc.) — caller falls back.
 */
export function seoForPath(path: string): SeoEntry | null {
  const key = legacyPath[path] ?? path;
  const entry = table[key];
  if (!entry) return null;
  return { title: entry.title, description: entry.description };
}
