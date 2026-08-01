import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * These bodies are verbatim Wix snapshots retained for migration provenance.
 * Their current pages are assembled from structured data and components, so
 * rendering the snapshots would duplicate stale cards, dates and links.
 */
export const DEDICATED_BODY_SNAPSHOTS: Readonly<Record<string, string>> = {
  index: '6f8a3d28b8a5f167c1832fe11a9f277288fb629e41c66e5223d034620eb8fc4c',
  'en/index': '84e11c25e20711087e9e1b4e0d7276b3b30f5e08cb1ebd5c726fd7fd21fec35b',
  blog: 'c4ddc3e6730237d301faa68b156aa044eab8b23d2ba7eac6e047f5cd8c8c4af8',
  'en/blog': '6776bb30fe4466c1e3fef9e657fd7e44e7a376643b79338e8417db35cc9c758b',
  turneringer: '1337227696273c4f960ba1e2508e9a3df3371140aff658412c65b99ed15daddd',
  'en/turneringer': '196eda1bfc2a709a334d74c0caba9f02fa67c088f1b77d274c0e4acf129f6d62',
  bilder: 'fd55558d8d9d6eeeee096dbc0b5caba0ac82ed5ccbaf0c1c0591e6dae1675065',
  'en/bilder': 'ceae7de96507c560b999da580bc351e948051f4357d754eb8d3ce31f0281f03e',
};

const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const rawBody = (id: string) => {
  const source = readFileSync(path.resolve('src/content/pages', `${id}.md`), 'utf8');
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
};

/** Prevent a CMS body edit from succeeding while the dedicated template drops it. */
export function assertDedicatedBodyUnchanged(id: string, sourceBody = rawBody(id)): void {
  const expected = DEDICATED_BODY_SNAPSHOTS[id];
  if (!expected) throw new Error(`Missing dedicated-body policy for pages/${id}.md`);
  if (digest(sourceBody) === expected) return;

  throw new Error(
    `The Markdown body of pages/${id}.md changed, but this route uses a dedicated template ` +
      `and would not render that edit. Put introductory copy in the editable description field, ` +
      `or update the dedicated component and its body policy intentionally.`,
  );
}
