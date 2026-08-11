#!/usr/bin/env node
/**
 * Link checker: crawls every .html file in dist/ and verifies that every
 * internal href/src resolves to a file in dist/. Handles Nordic characters
 * (raw or percent-encoded), root-absolute and relative URLs, and /media/...
 * assets. Exits 1 when any broken internal link is found.
 *
 *   node scripts/check-links.mjs [distDir]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.argv[2] ?? 'dist');

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.html')) yield p;
  }
}

const ATTR = /(href|src|srcset|poster)\s*=\s*"([^"]*)"/g;

function* urlsOf(html) {
  for (const m of html.matchAll(ATTR)) {
    const [, attr, raw] = m;
    if (attr === 'srcset') {
      // srcset: "url 600w, url 1600w" — or a single "url 400w" candidate.
      for (const part of raw.split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u) yield u;
      }
    } else {
      yield raw;
    }
  }
}

function isInternal(url) {
  return (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('//') &&
    !/^(mailto|tel|javascript|data|blob):/i.test(url) &&
    !url.startsWith('#') &&
    // API routes are Pages Functions (not static files in dist/)
    !url.split('?')[0].startsWith('/api/')
  );
}

async function existsForUrl(urlPath, pageFile) {
  let p = urlPath.split('#')[0].split('?')[0];
  if (!p) return true;
  let decoded;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    decoded = p;
  }
  const rel = decoded.startsWith('/')
    ? decoded.slice(1)
    : path.relative(DIST, path.resolve(path.dirname(pageFile), decoded));
  const candidates = [
    path.join(DIST, rel),
    path.join(DIST, rel, 'index.html'),
    path.join(DIST, `${rel}.html`),
  ];
  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isFile()) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

const broken = new Map(); // url -> Set of pages
const unstableImages = new Map(); // src -> Set of pages
let pages = 0;
let checked = 0;
let localImages = 0;

// Redirect sources from public/_redirects are valid URLs (they 301 in production).
const redirectRules = [];
try {
  const raw = await fs.readFile(path.resolve('public/_redirects'), 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [from, to] = t.split(/\s+/);
    if (from && to) redirectRules.push({ from, to });
  }
} catch {
  /* no redirects file */
}

function isRedirected(url) {
  const p = url.split('#')[0].split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    decoded = p;
  }
  return redirectRules.some(({ from }) =>
    from.endsWith('*') ? decoded.startsWith(from.slice(0, -1)) : decoded === from,
  );
}

for await (const file of walk(DIST)) {
  pages++;
  const html = await fs.readFile(file, 'utf8');
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = tag.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!src?.startsWith('/media/')) continue;
    localImages++;
    if (/\swidth\s*=\s*["']?\d+/i.test(tag) && /\sheight\s*=\s*["']?\d+/i.test(tag)) continue;
    if (!unstableImages.has(src)) unstableImages.set(src, new Set());
    unstableImages.get(src).add(path.relative(DIST, file));
  }
  for (const url of urlsOf(html)) {
    if (!isInternal(url)) continue;
    checked++;
    if (isRedirected(url)) continue;
    if (!(await existsForUrl(url, file))) {
      const key = url.split('#')[0];
      if (!broken.has(key)) broken.set(key, new Set());
      broken.get(key).add(path.relative(DIST, file));
    }
  }
}

// Redirect targets must exist too.
for (const { from, to } of redirectRules) {
  checked++;
  if (/^https?:\/\//i.test(to)) continue;
  if (!(await existsForUrl(to, path.join(DIST, 'index.html'))) && !isRedirected(to)) {
    if (!broken.has(to)) broken.set(to, new Set());
    broken.get(to).add(`_redirects (${from})`);
  }
}

console.log(
  `check-links: ${pages} pages, ${checked} internal links and ${localImages} local images checked`,
);
if (broken.size || unstableImages.size) {
  if (unstableImages.size) {
    console.error(`\n${unstableImages.size} local image(s) missing intrinsic width/height:`);
    for (const [src, from] of [...unstableImages.entries()].sort()) {
      console.error(`  ${src}`);
      for (const f of [...from].slice(0, 5)) console.error(`    <- ${f}`);
      if (from.size > 5) console.error(`    <- ... and ${from.size - 5} more`);
    }
  }
}
if (broken.size) {
  console.error(`\n${broken.size} broken internal link(s):`);
  for (const [url, from] of [...broken.entries()].sort()) {
    console.error(`  ${url}`);
    for (const f of [...from].slice(0, 5)) console.error(`    <- ${f}`);
    if (from.size > 5) console.error(`    <- ... and ${from.size - 5} more`);
  }
}
if (broken.size || unstableImages.size) process.exit(1);
console.log('check-links: all internal links resolve and local images have intrinsic dimensions ✓');
