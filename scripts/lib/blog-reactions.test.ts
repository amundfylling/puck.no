import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { BLOG_POST_KEYS } from '../../functions/lib/blog-post-keys.ts';
import { onRequestGet, onRequestPost } from '../../functions/api/reactions/[lang]/[slug].ts';

const keys = BLOG_POST_KEYS;
const [lang, slug] = keys[0].split('/');
const endpoint = `https://puck.no/api/reactions/${lang}/${encodeURIComponent(slug)}`;

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0009_blog_reactions.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            all: () => ({ results: statement.all(...values) }),
            first: () => statement.get(...values) ?? null,
            run: () => statement.run(...values),
          };
        },
      };
    },
    close: () => sqlite.close(),
  };
}

function context(db: ReturnType<typeof makeDb>, method: string, url = endpoint, cookie?: string, origin = 'https://puck.no') {
  return {
    params: { lang, slug },
    env: { DB: db },
    request: new Request(url, {
      method,
      headers: { ...(method === 'POST' ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    }),
  } as Parameters<typeof onRequestGet>[0];
}

test('anonymous visitors can add, change, and remove one reaction per post', async () => {
  const db = makeDb();
  try {
    const initial = await onRequestGet(context(db, 'GET'));
    assert.deepEqual(await initial.json(), {
      counts: { heart: 0, fire: 0, laugh: 0, wow: 0, clap: 0 }, selected: null,
    });
    assert.equal(initial.headers.get('Cache-Control'), 'no-store');

    const first = await onRequestPost(context(db, 'POST', `${endpoint}?emoji=heart`));
    assert.equal(first.status, 200);
    const cookie = first.headers.get('Set-Cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^puck_reaction_id=[0-9a-f-]{36}$/);
    assert.deepEqual(await first.json(), {
      counts: { heart: 1, fire: 0, laugh: 0, wow: 0, clap: 0 }, selected: 'heart',
    });

    const changed = await onRequestPost(context(db, 'POST', `${endpoint}?emoji=fire`, cookie));
    assert.equal(changed.headers.get('Set-Cookie'), null);
    assert.deepEqual(await changed.json(), {
      counts: { heart: 0, fire: 1, laugh: 0, wow: 0, clap: 0 }, selected: 'fire',
    });
    const seen = await onRequestGet(context(db, 'GET', endpoint, cookie));
    assert.equal((await seen.json()).selected, 'fire');

    const another = await onRequestPost(context(db, 'POST', `${endpoint}?emoji=heart`));
    assert.equal((await another.json()).counts.heart, 1);
    const removed = await onRequestPost(context(db, 'POST', `${endpoint}?emoji=remove`, cookie));
    assert.deepEqual(await removed.json(), {
      counts: { heart: 1, fire: 0, laugh: 0, wow: 0, clap: 0 }, selected: null,
    });
  } finally {
    db.close();
  }
});

test('reaction writes reject unknown posts, invalid choices, and cross-origin requests', async () => {
  const db = makeDb();
  try {
    const invalid = await onRequestPost(context(db, 'POST', `${endpoint}?emoji=other`));
    assert.equal(invalid.status, 400);
    const crossOrigin = await onRequestPost(context(db, 'POST', `${endpoint}?emoji=heart`, undefined, 'https://example.com'));
    assert.equal(crossOrigin.status, 403);
    const unknown = context(db, 'POST', `${endpoint}?emoji=heart`);
    unknown.params.slug = 'not-a-post';
    assert.equal((await onRequestPost(unknown)).status, 404);
  } finally {
    db.close();
  }
});

test('Nordic blog slugs work when Pages passes a percent-encoded route parameter', async () => {
  const db = makeDb();
  try {
    const [nordicLang, nordicSlug] = keys.find((key) => key.includes('æ'))!.split('/');
    const encoded = context(db, 'GET');
    encoded.params.lang = nordicLang;
    encoded.params.slug = encodeURIComponent(nordicSlug);
    assert.equal((await onRequestGet(encoded)).status, 200);
    encoded.params.slug = '%C3';
    assert.equal((await onRequestGet(encoded)).status, 404);
  } finally {
    db.close();
  }
});
