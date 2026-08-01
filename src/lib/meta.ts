export const META_DESCRIPTION_MAX_LENGTH = 160;

export interface SeoEntry {
  title: string;
  description: string | null;
}

export interface EditableSeo {
  title?: string | null;
  seoTitle?: string | null;
  description?: string | null;
}

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() || null;

/**
 * Resolve metadata without allowing the read-only Wix migration snapshot to
 * override content that editors can change in frontmatter.
 */
export function resolveEditableSeo(editable: EditableSeo, legacy: SeoEntry | null): SeoEntry {
  return {
    title: clean(editable.seoTitle) ?? clean(editable.title) ?? clean(legacy?.title) ?? '',
    description: clean(editable.description) ?? clean(legacy?.description),
  };
}

/** Collapse whitespace and keep search-result copy within a practical limit. */
export function normalizeMetaDescription(value: string, max = META_DESCRIPTION_MAX_LENGTH): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;

  const candidate = normalized.slice(0, max - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  const cutAt = lastSpace >= Math.floor(max * 0.7) ? lastSpace : candidate.length;
  return `${candidate.slice(0, cutAt).replace(/[\s,;:–—-]+$/u, '')}…`;
}
