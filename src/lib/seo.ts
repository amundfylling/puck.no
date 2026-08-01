import seoData from '../data/seo.json';
import { resolveEditableSeo, type EditableSeo, type SeoEntry } from './meta';

type LegacySeoEntry = { title: string; description: string };
const table = seoData as Record<string, LegacySeoEntry>;

/** Paths that changed after the scrape; look up the old path in seo.json. */
const legacyPath: Record<string, string> = {
  '/spill-bordhockey': '/services-1',
  '/en/spill-bordhockey': '/en/services-1',
};

/**
 * Original <title> + meta description from the live Wix site, keyed by path
 * (e.g. "/om-oss", "/en/post/..."). This is read-only migration data and
 * must only be used as a fallback behind current content.
 */
export function seoForPath(path: string): SeoEntry | null {
  const key = legacyPath[path] ?? path;
  const entry = table[key];
  if (!entry) return null;
  return { title: entry.title, description: entry.description };
}

/** Editable frontmatter is authoritative; seo.json is a migration fallback. */
export function seoForContent(path: string, editable: EditableSeo): SeoEntry {
  return resolveEditableSeo(editable, seoForPath(path));
}
