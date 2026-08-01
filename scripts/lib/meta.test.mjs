import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  META_DESCRIPTION_MAX_LENGTH,
  normalizeMetaDescription,
  resolveEditableSeo,
} from '../../src/lib/meta.ts';
import {
  assertDedicatedBodyUnchanged,
  DEDICATED_BODY_SNAPSHOTS,
} from '../../src/lib/dedicated-body.ts';

test('editable metadata takes precedence over the Wix migration snapshot', () => {
  const resolved = resolveEditableSeo(
    {
      title: 'Current title',
      seoTitle: 'Current SEO title',
      description: 'Current description',
    },
    { title: 'Stale title', description: 'Stale description' },
  );

  assert.deepEqual(resolved, {
    title: 'Current SEO title',
    description: 'Current description',
  });
});

test('migration metadata remains a fallback for empty frontmatter', () => {
  const resolved = resolveEditableSeo(
    { title: '  ', seoTitle: null, description: '' },
    { title: 'Legacy title', description: 'Legacy description' },
  );

  assert.deepEqual(resolved, {
    title: 'Legacy title',
    description: 'Legacy description',
  });
});

test('meta descriptions are normalized and capped without splitting a word', () => {
  const long = `${'A useful sentence about table hockey. '.repeat(8)}Final words.`;
  const normalized = normalizeMetaDescription(long);

  assert.ok(normalized.length <= META_DESCRIPTION_MAX_LENGTH);
  assert.match(normalized, /…$/u);
  assert.doesNotMatch(normalized, /\s…$/u);
  assert.equal(normalizeMetaDescription('  One\n\nshort   sentence.  '), 'One short sentence.');
});

test('English migration metadata contains no known Norwegian copy leaks', async () => {
  const seo = JSON.parse(await readFile(new URL('../../src/data/seo.json', import.meta.url), 'utf8'));
  const norwegianLeak = /\b(?:om oss|bildegallerier|referat fra|vm kvalik|siste nytt)\b/i;

  for (const [path, entry] of Object.entries(seo)) {
    if (!path.startsWith('/en')) continue;
    assert.doesNotMatch(`${entry.title} ${entry.description}`, norwegianLeak, path);
  }
});

test('unpaired English blog pagination does not claim a Norwegian alternate', async () => {
  const source = await readFile(
    new URL('../../src/pages/en/blog/[...page].astro', import.meta.url),
    'utf8',
  );
  assert.match(source, /noUrl=\{page === 1 \? '\/blog' : null\}/);
});

test('dedicated page snapshots cannot be edited and silently discarded', async () => {
  for (const id of Object.keys(DEDICATED_BODY_SNAPSHOTS)) {
    const markdown = await readFile(
      new URL(`../../src/content/pages/${id}.md`, import.meta.url),
      'utf8',
    );
    const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    assert.doesNotThrow(() => assertDedicatedBodyUnchanged(id, body));
    assert.throws(() => assertDedicatedBodyUnchanged(id, `${body}\nUnrendered edit`), /would not render/);
  }
});
