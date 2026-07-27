/**
 * Frontmatter reader/writer for the content collections. Uses the `yaml`
 * package so values round-trip correctly, and splices the serialized
 * frontmatter back so the markdown body stays byte-identical.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Read a markdown file → { data, doc, body, hasFrontmatter }. */
export function readMd(absPath) {
  const raw = readFileSync(absPath, 'utf8');
  const m = raw.match(FM_RE);
  if (!m) return { data: {}, doc: null, body: raw, hasFrontmatter: false };
  const doc = YAML.parseDocument(m[1]);
  const data = doc.toJS() ?? {};
  return { data, doc, body: raw.slice(m[0].length), hasFrontmatter: true };
}

/** Serialize frontmatter + body back to disk. */
export function writeMd(absPath, doc, body) {
  writeFileSync(absPath, `---\n${doc.toString()}---\n${body}`);
}

/**
 * Patch frontmatter keys of an existing file. `patch` values of
 * undefined leave the key untouched; null writes an explicit null.
 * Returns the previous values of the patched keys.
 */
export function patchMd(absPath, patch) {
  const { doc, body, hasFrontmatter, data } = readMd(absPath);
  if (!hasFrontmatter) throw new Error(`${absPath}: no frontmatter block found`);
  const before = {};
  for (const key of Object.keys(patch)) before[key] = data[key] ?? null;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    doc.set(key, value);
  }
  writeMd(absPath, doc, body);
  return before;
}

/** Create a new markdown file from an ordered key→value map + body. */
export function createMd(absPath, fields, body) {
  const doc = new YAML.Document(fields);
  const text = `---\n${doc.toString()}---\n\n${body.replace(/\n*$/, '\n')}`;
  writeFileSync(absPath, text);
  return text;
}
