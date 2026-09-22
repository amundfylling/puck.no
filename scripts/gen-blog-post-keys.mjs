#!/usr/bin/env node
/** Keep the public reactions API restricted to published blog posts. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../functions/lib/blog-post-keys.json', import.meta.url));
const keys = new Set();

for (const lang of ['no', 'en']) {
  const dir = lang === 'en' ? `${ROOT}/en` : ROOT;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    const source = readFileSync(`${dir}/${file}`, 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) throw new Error(`Missing frontmatter: ${lang}/${file}`);
    const data = YAML.parse(frontmatter[1]);
    if (data?.lang !== lang || typeof data.slug !== 'string' || !data.slug) {
      throw new Error(`Invalid language or slug: ${lang}/${file}`);
    }
    const key = `${lang}/${data.slug}`;
    if (keys.has(key)) throw new Error(`Duplicate blog post key: ${key}`);
    keys.add(key);
  }
}

writeFileSync(OUT, `${JSON.stringify([...keys].sort(), null, 2)}\n`);
console.log(`gen-blog-post-keys: ${keys.size} posts -> functions/lib/blog-post-keys.json`);
