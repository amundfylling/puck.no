/** Tournament reminder emails — planning logic + a mocked end-to-end run. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectRecipients, dueTournaments, isNorwegian, isOsloReminderTime, osloDateKey,
  planReminders, renderReminder, runTournamentReminders,
} from '../src/reminders.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const config = {
  'norway-open-2027': { date: '4. september 2027' },
  'jæren-open-2027': { date: '27. februar 2027' },
  'trondheim-open-2027': { date: '31. mars 2027' },
  'closed-cup-2027': { date: '27. februar 2027', registrationOpen: false },
};

const rows = [
  // Norwegian ranked player, already registered for Jæren Open.
  { tournament_slug: 'jæren-open-2027', type: 'player', email: 'Ola@Example.no', country: 'NOR', player_id: 1 },
  // Same ranked player registered elsewhere with another address.
  { tournament_slug: 'norway-open-2025', type: 'player', email: 'ola.alt@example.no', country: 'NOR', player_id: 1 },
  // Swedish ranked player.
  { tournament_slug: 'norway-open-2025', type: 'player', email: 'sven@example.se', country: 'SWE', player_id: 2 },
  // Unranked player who only ever played Norway Open → treated as foreign.
  { tournament_slug: 'norway-open-2025', type: 'player', email: 'guest@example.com', country: null, player_id: null },
  // Unranked newcomer at a Norwegian tournament → treated as Norwegian.
  { tournament_slug: 'bergen-open-2025', type: 'player', email: 'ny@example.no', country: null, player_id: null },
  // Team contact with a Norwegian roster.
  { tournament_slug: 'duo-nm-2026', type: 'team', email: 'lag@example.no', roster: JSON.stringify([
    { playerId: 3, country: 'NOR' }, { playerId: null, name: 'X' },
  ]) },
];

test('reminder cron selects 09:00 Europe/Oslo across DST', () => {
  assert.equal(isOsloReminderTime(new Date('2027-01-27T08:00:00Z')), true);
  assert.equal(isOsloReminderTime(new Date('2027-01-27T07:00:00Z')), false);
  assert.equal(isOsloReminderTime(new Date('2027-08-04T07:00:00Z')), true);
  assert.equal(isOsloReminderTime(new Date('2027-08-04T08:00:00Z')), false);
  assert.equal(osloDateKey(new Date('2027-01-26T23:30:00Z')), '2027-01-27');
});

test('tournaments are due one calendar month before, for a week, unless closed', () => {
  assert.deepEqual(dueTournaments(config, '2027-01-26'), []);
  assert.deepEqual(dueTournaments(config, '2027-01-27'), ['jæren-open-2027']);
  assert.deepEqual(dueTournaments(config, '2027-02-02'), ['jæren-open-2027']);
  assert.deepEqual(dueTournaments(config, '2027-02-03'), []);
  // 31 March → last day of February.
  assert.deepEqual(dueTournaments(config, '2027-02-28'), ['trondheim-open-2027']);
  assert.deepEqual(dueTournaments(config, '2027-08-04'), ['norway-open-2027']);
});

test('nationality comes from linked ranking countries', () => {
  const recipients = collectRecipients(rows);
  assert.equal(isNorwegian(recipients.get('ola@example.no')), true);
  assert.equal(isNorwegian(recipients.get('sven@example.se')), false);
  assert.equal(isNorwegian(recipients.get('guest@example.com')), false);
  assert.equal(isNorwegian(recipients.get('ny@example.no')), true);
  assert.equal(isNorwegian(recipients.get('lag@example.no')), true);
});

test('plan skips registered players, unsubscribed and already sent; foreigners only get Norway Open', () => {
  const plan = planReminders({
    rows,
    dueSlugs: ['jæren-open-2027', 'norway-open-2027'],
    sent: new Set(['norway-open-2027\nny@example.no']),
    unsubscribed: new Set(['lag@example.no']),
  });
  const got = plan.map(({ slug, key, lang }) => `${slug} ${key} ${lang}`).sort();
  assert.deepEqual(got, [
    // ola + ola.alt are player 1, already registered for Jæren Open.
    'jæren-open-2027 ny@example.no no',
    'norway-open-2027 guest@example.com en',
    'norway-open-2027 ola.alt@example.no no',
    'norway-open-2027 ola@example.no no',
    'norway-open-2027 sven@example.se en',
  ]);
});

test('email text links the tournament and the unsubscribe page, HTML-escaped', () => {
  const mail = renderReminder({
    lang: 'en',
    tournament: { name: 'Norway <Open>', date: '4 September 2027', location: 'Sandnes' },
    url: 'https://www.puck.no/en/turneringer/norway-open-2027/',
    unsubscribeUrl: 'https://www.puck.no/api/unsubscribe?token=abc',
  });
  assert.match(mail.text, /https:\/\/www\.puck\.no\/en\/turneringer\/norway-open-2027\//);
  assert.match(mail.text, /api\/unsubscribe\?token=abc/);
  assert.match(mail.html, /Norway &lt;Open&gt;/);
  assert.doesNotMatch(mail.html, /<Open>/);
});

function mockDb(statements) {
  const select = (sql) => {
    if (sql.includes('FROM tournament_settings')) return [];
    if (sql.includes('FROM registrations')) return rows;
    if (sql.includes('FROM reminder_sends')) return [];
    if (sql.includes('unsubscribed_at IS NOT NULL')) return [];
    if (sql.includes('SELECT email_key, token')) return [];
    throw new Error(`unexpected sql: ${sql}`);
  };
  const statement = (sql, params = []) => ({
    sql,
    params,
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: select(sql) }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (batch) => { statements.push(...batch); return batch; },
  };
}

function mockFetch(sentBodies) {
  globalThis.fetch = async (url, init) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('tournament-config.json')) {
      return new Response(JSON.stringify(config));
    }
    if (u.includes('/src/content/tournaments/')) {
      return new Response('---\nname: "Norway Open 2027"\nlocation: "Sandnes"\n---\nBody\n');
    }
    if (u === 'https://api.resend.com/emails/batch') {
      sentBodies.push(JSON.parse(init.body));
      return Response.json({ data: [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

test('without the enable flag the job only counts (dry run)', async () => {
  const sentBodies = [];
  mockFetch(sentBodies);
  const result = await runTournamentReminders(
    { GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't', RESEND_API_KEY: 'k', DB: mockDb([]) },
    new Date('2027-08-04T07:00:00Z'),
  );
  assert.deepEqual(result, { mode: 'dry-run', tournaments: 1, planned: 6, sent: 0 });
  assert.equal(sentBodies.length, 0);
});

test('test recipient gets one sample per language and nothing is recorded', async () => {
  const sentBodies = [];
  const statements = [];
  mockFetch(sentBodies);
  const result = await runTournamentReminders({
    GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't', RESEND_API_KEY: 'k', REMINDER_FROM: 'NBHF <a@puck.no>',
    REMINDER_TEST_RECIPIENT: 'admin@example.no', DB: mockDb(statements),
  }, new Date('2027-08-04T07:00:00Z'));
  assert.equal(result.sent, 2);
  const messages = sentBodies.flat();
  assert.deepEqual(messages.map((m) => m.to[0]), ['admin@example.no', 'admin@example.no']);
  assert.ok(messages.every((m) => m.subject.startsWith('[TEST] ')));
  assert.equal(statements.length, 0);
});

test('live mode sends to each recipient and records the sends', async () => {
  const sentBodies = [];
  const statements = [];
  mockFetch(sentBodies);
  const result = await runTournamentReminders({
    GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't', RESEND_API_KEY: 'k', REMINDER_FROM: 'NBHF <a@puck.no>',
    REMINDER_EMAILS_ENABLED: 'true', DB: mockDb(statements),
  }, new Date('2027-08-04T07:00:00Z'));
  assert.equal(result.sent, 6);
  const messages = sentBodies.flat();
  const sven = messages.find((m) => m.to[0] === 'sven@example.se');
  assert.match(sven.text, /https:\/\/www\.puck\.no\/en\/turneringer\/norway-open-2027\//);
  assert.equal(sven.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const ola = messages.find((m) => m.to[0] === 'Ola@Example.no');
  assert.match(ola.text, /https:\/\/www\.puck\.no\/turneringer\/norway-open-2027\//);
  const recorded = statements.filter((s) => s.sql.includes('INSERT OR IGNORE INTO reminder_sends'));
  assert.equal(recorded.length, 6);
});
