#!/usr/bin/env node
/** Structural audit of the generated site; runs after `npm run build`. */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const SITE = 'https://www.puck.no';
const failures = [];
let publicPages = 0;
let images = 0;
const canonicalPages = new Map();

async function* files(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(target);
    else yield target;
  }
}

const attribute = (tag, name) =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? null;
const count = (value, expression) => [...value.matchAll(expression)].length;
const fail = (file, message) => failures.push(`${path.relative(DIST, file)}: ${message}`);

const headers = await fs.readFile(path.join(DIST, '_headers'), 'utf8');
const htmlFiles = [];
for await (const file of files(DIST)) if (file.endsWith('.html')) htmlFiles.push(file);

for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  const relative = path.relative(DIST, file);
  const isAdmin = relative.startsWith(`admin${path.sep}`);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() ?? '';
  const lang = html.match(/<html\b[^>]*\blang=(["'])(.*?)\1/i)?.[2] ?? '';
  if (!title) fail(file, 'missing document title');
  if (!['no', 'en'].includes(lang)) fail(file, `invalid or missing html lang (${lang || 'empty'})`);

  const ids = [...html.matchAll(/\bid=(["'])(.*?)\1/gi)].map((match) => match[2]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail(file, `duplicate id(s): ${duplicates.join(', ')}`);

  for (const tag of html.matchAll(/<button\b[^>]*>/gi)) {
    if (!attribute(tag[0], 'type')) fail(file, 'button missing explicit type');
  }
  for (const tag of html.matchAll(/<a\b[^>]*\btarget=(["'])_blank\1[^>]*>/gi)) {
    const rel = attribute(tag[0], 'rel')?.split(/\s+/) ?? [];
    if (!rel.includes('noopener')) fail(file, 'target=_blank link missing rel=noopener');
  }
  for (const tag of html.matchAll(/<iframe\b[^>]*>/gi)) {
    if (!attribute(tag[0], 'title')?.trim()) fail(file, 'iframe missing title');
    if (attribute(tag[0], 'loading') !== 'lazy') fail(file, 'iframe missing loading=lazy');
    if (!attribute(tag[0], 'referrerpolicy')) fail(file, 'iframe missing referrerpolicy');
  }

  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    images++;
    const src = attribute(tag[0], 'src');
    if (attribute(tag[0], 'alt') == null) fail(file, `image missing alt (${src ?? 'unknown src'})`);
    if (src?.startsWith('/') && src !== '') {
      if (!/^\d+$/.test(attribute(tag[0], 'width') ?? '') || !/^\d+$/.test(attribute(tag[0], 'height') ?? '')) {
        fail(file, `local image missing intrinsic dimensions (${src})`);
      }
    }
  }

  if (isAdmin) {
    if (!/<meta\b[^>]*name=(["'])robots\1[^>]*content=(["'])noindex/i.test(html)) {
      fail(file, 'admin page missing noindex');
    }
    continue;
  }
  publicPages++;

  if (count(html, /<h1\b/gi) !== 1) fail(file, 'public page must contain exactly one h1');
  if (count(html, /\bbtn-primary\b/g) > 1) fail(file, 'public page contains more than one primary action');
  const description = html.match(/<meta\b[^>]*name=(["'])description\1[^>]*content=(["'])(.*?)\2/i)?.[3] ?? '';
  if (!description.trim()) fail(file, 'missing meta description');
  if ([...description].length > 160) fail(file, `meta description is ${[...description].length} characters`);
  for (const name of ['og:title', 'og:description', 'og:url', 'og:image']) {
    if (!html.includes(`property="${name}"`) && !html.includes(`property='${name}'`)) fail(file, `missing ${name}`);
  }
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    if (!html.includes(`name="${name}"`) && !html.includes(`name='${name}'`)) fail(file, `missing ${name}`);
  }
  const canonical = html.match(/<link\b[^>]*rel=(["'])canonical\1[^>]*href=(["'])(.*?)\2/i)?.[3] ?? '';
  if (!canonical.startsWith(`${SITE}/`) || (!canonical.endsWith('/') && !canonical.endsWith('/404/'))) {
    fail(file, `invalid canonical (${canonical || 'missing'})`);
  }
  const alternates = [...html.matchAll(/<link\b[^>]*\bhreflang=(["'])(.*?)\1[^>]*>/gi)]
    .map((match) => ({ lang: match[2], href: attribute(match[0], 'href') }))
    .filter((entry) => entry.href);
  if (canonicalPages.has(canonical)) fail(file, `duplicate canonical also used by ${canonicalPages.get(canonical).relative}`);
  else canonicalPages.set(canonical, { file, relative, alternates });
  if (/<(?:img|script|iframe|link|source)\b[^>]*(?:src|href)=(["'])http:\/\//i.test(html)) {
    fail(file, 'mixed-content asset URL');
  }

  for (const match of html.matchAll(/<script\b(?=[^>]*\btype=(["'])application\/ld\+json\1)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const digest = createHash('sha256').update(match[2], 'utf8').digest('base64');
    if (!headers.includes(`'sha256-${digest}'`)) fail(file, 'JSON-LD block is not allowlisted by CSP');
    try {
      JSON.parse(match[2]);
    } catch {
      fail(file, 'invalid JSON-LD');
    }
  }
}

for (const [canonical, page] of canonicalPages) {
  const no = page.alternates.find((entry) => entry.lang === 'no')?.href;
  const xDefault = page.alternates.find((entry) => entry.lang === 'x-default')?.href;
  if (no && xDefault !== no) fail(page.file, 'x-default must match the Norwegian alternate');
  for (const alternate of page.alternates.filter((entry) => entry.lang === 'no' || entry.lang === 'en')) {
    const target = canonicalPages.get(alternate.href);
    if (!target) {
      fail(page.file, `hreflang target does not exist (${alternate.href})`);
      continue;
    }
    if (!target.alternates.some((candidate) => candidate.href === canonical)) {
      fail(page.file, `hreflang is not reciprocal with ${target.relative}`);
    }
  }
}

const sitemapFiles = [];
for await (const file of files(DIST)) if (/sitemap.*\.xml$/.test(file)) sitemapFiles.push(file);
const sitemap = (await Promise.all(sitemapFiles.map((file) => fs.readFile(file, 'utf8')))).join('\n');
for (const forbidden of ['/admin/', '/404/', '/test-individuell-2026/', '/test-lagturnering-2026/']) {
  if (sitemap.includes(forbidden)) failures.push(`sitemap: forbidden route ${forbidden}`);
}

if (failures.length) {
  console.error(`audit-generated: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`audit-generated: ${publicPages} public pages, ${htmlFiles.length - publicPages} admin pages and ${images} images passed`);
