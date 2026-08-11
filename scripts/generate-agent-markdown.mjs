#!/usr/bin/env node
/** Generate Markdown representations of public HTML pages for negotiation. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import TurndownService from 'turndown';

const DIST = path.resolve('dist');
const OUTPUT = path.join(DIST, '__agent-markdown');

async function* htmlFiles(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    const relative = path.relative(DIST, target);
    if (entry.isDirectory()) {
      if (relative === 'admin' || relative === '__agent-markdown') continue;
      yield* htmlFiles(target);
    } else if (entry.name.endsWith('.html')) {
      yield target;
    }
  }
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function meta(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\s+[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return null;
}

function yamlString(value) {
  return JSON.stringify(value).replaceAll('\\u2028', '\\\\u2028').replaceAll('\\u2029', '\\\\u2029');
}

function toMarkdown(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]) : null;
  const description = meta(html, 'name', 'description');
  const image = meta(html, 'property', 'og:image');
  const canonical = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i)?.[1]
    ?? null;

  const turndown = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  });
  turndown.remove(['script', 'style', 'nav', 'footer', 'form', 'noscript', 'template', 'svg', 'button']);
  let body = turndown.turndown(main)
    .replace(/\)\[/g, ') [')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body && title) body = `# ${title}`;

  const frontmatter = [];
  if (title) frontmatter.push(`title: ${yamlString(title)}`);
  if (description) frontmatter.push(`description: ${yamlString(description)}`);
  if (image) frontmatter.push(`image: ${yamlString(image)}`);
  if (canonical) frontmatter.push(`canonical: ${yamlString(canonical)}`);
  return `${frontmatter.length ? `---\n${frontmatter.join('\n')}\n---\n\n` : ''}${body}\n`;
}

await fs.rm(OUTPUT, { recursive: true, force: true });
let count = 0;
for await (const file of htmlFiles(DIST)) {
  const relative = path.relative(DIST, file).replace(/\.html$/, '.md');
  const target = path.join(OUTPUT, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, toMarkdown(await fs.readFile(file, 'utf8')));
  count++;
}
console.log(`generate-agent-markdown: wrote ${count} public page variant(s)`);
