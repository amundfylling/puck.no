/**
 * Frontmatter handling on raw text (no filesystem) — same semantics as
 * mcp/src/lib/frontmatter.js, using the bundled `yaml` package.
 */
import YAML from 'yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parse markdown text → { data, doc, body, hasFrontmatter }. */
export function parseMdText(raw) {
  const m = raw.match(FM_RE);
  if (!m) return { data: {}, doc: null, body: raw, hasFrontmatter: false };
  const doc = YAML.parseDocument(m[1]);
  return { data: doc.toJS() ?? {}, doc, body: raw.slice(m[0].length), hasFrontmatter: true };
}

export function serializeMd(doc, body) {
  return `---\n${doc.toString()}---\n${body}`;
}

/**
 * Patch frontmatter keys in raw markdown text.
 * Returns { text, before } — before holds previous values of patched keys.
 */
export function patchMdText(raw, patch) {
  const { doc, body, hasFrontmatter, data } = parseMdText(raw);
  if (!hasFrontmatter) throw new Error('no frontmatter block found');
  const before = {};
  for (const key of Object.keys(patch)) before[key] = data[key] ?? null;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    doc.set(key, value);
  }
  return { text: serializeMd(doc, body), before };
}

/** Create markdown text from an ordered key→value map + body. */
export function createMdText(fields, body) {
  const doc = new YAML.Document(fields);
  return `---\n${doc.toString()}---\n\n${String(body).replace(/\n*$/, '\n')}`;
}
