#!/usr/bin/env node
/**
 * One-off fix-up (kept for reference, like patch-tournaments.mjs).
 *
 * Strips the leading page-title heading from selected page bodies. The old
 * Wix pages repeated the page title as the first content heading; Phase 2
 * templates render a single <h1> from frontmatter `title`, so the duplicate
 * first heading is removed here. A leading image paragraph (when present)
 * is kept. Body text otherwise stays verbatim.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const base = new URL('../src/content/pages/', import.meta.url).pathname;
const files = [
  'om-oss.md',
  'lokalligaer.md',
  'lær-bordhockey.md',
  'ressurser.md',
  'services-1.md',
  'lær-bordhockey-kombinasjoner.md',
  'en/om-oss.md',
  'en/lokalligaer.md',
  'en/lær-bordhockey.md',
  'en/ressurser.md',
  'en/services-1.md',
  'en/lær-bordhockey-kombinasjoner.md',
];

for (const file of files) {
  const p = base + file;
  const text = readFileSync(p, 'utf8');
  const fmEnd = text.indexOf('---', 4);
  if (fmEnd === -1) throw new Error(`no frontmatter end in ${file}`);
  const head = text.slice(0, fmEnd + 3);
  let body = text.slice(fmEnd + 3).replace(/^\s+/, '');

  // keep a leading image paragraph
  let image = '';
  const imgMatch = body.match(/^!\[[^\]]*\]\([^)]*\)\n*/);
  if (imgMatch) {
    image = imgMatch[0];
    body = body.slice(image.length).replace(/^\s+/, '');
  }

  const heading = body.match(/^#{1,2} [^\n]+\n*/);
  if (!heading) {
    console.log('NO LEADING HEADING:', file);
    continue;
  }
  body = body.slice(heading[0].length);
  writeFileSync(p, `${head}\n${image}\n${body}`);
  console.log('stripped', JSON.stringify(heading[0].trim()), 'from', file);
}
