/** Unit tests for the pure lib helpers (no network, no git, no D1). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseNoDate, tournamentStatus } from '../src/lib/dates.js';
import { sqlValue } from '../src/lib/d1.js';
import { readMd, patchMd, createMd } from '../src/lib/frontmatter.js';
import { parseRanking } from '../src/lib/ranking.js';
import { canonicalNameKey } from '../src/lib/ranking.js';
import {
  assertSlug, assertDateText, assertEmail, assertPhone, assertTeamRule,
  assertRankingLevel, assertTournamentRankingLevel, RANKING_LEVELS,
  maskEmail, maskPhone, ValidationError,
} from '../src/lib/validate.js';
import {
  registerTournamentTools, TOURNAMENT_PATCHABLE, TOURNAMENT_SYNC_TO_EN,
} from '../src/tools/tournaments.js';
import { CommandError } from '../src/lib/run.js';
import { csvField } from '../src/tools/registrations.js';

// --- dates ---
test('parseNoDate parses single dates', () => {
  const d = parseNoDate('5. september 2026');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 5);
});

test('parseNoDate parses ranges (end day wins)', () => {
  const d = parseNoDate('1.–3. mai 2026');
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 3);
});

test('parseNoDate returns null on garbage', () => {
  assert.equal(parseNoDate('September 5, 2026'), null);
  assert.equal(parseNoDate(''), null);
  assert.equal(parseNoDate(null), null);
});

test('tournamentStatus strict today-or-later rule', () => {
  const now = new Date(2026, 6, 26, 12, 0); // 26. juli 2026
  assert.equal(tournamentStatus('26. juli 2026', now), 'upcoming');
  assert.equal(tournamentStatus('25. juli 2026', now), 'past');
  assert.equal(tournamentStatus('1.–26. juli 2026', now), 'upcoming'); // range end = today
  assert.equal(tournamentStatus('tull'), 'unknown');
});

// --- sqlValue ---
test('sqlValue escapes strings', () => {
  assert.equal(sqlValue("o'brien"), "'o''brien'");
  assert.equal(sqlValue('normal'), "'normal'");
  assert.equal(sqlValue(''), "''");
  assert.equal(sqlValue("'; DROP TABLE registrations;--"), "'''; DROP TABLE registrations;--'");
});

test('sqlValue handles numbers/null/bool', () => {
  assert.equal(sqlValue(42), '42');
  assert.equal(sqlValue(null), 'NULL');
  assert.equal(sqlValue(undefined), 'NULL');
  assert.equal(sqlValue(true), '1');
  assert.throws(() => sqlValue(NaN));
  assert.throws(() => sqlValue(Infinity));
});

// --- frontmatter ---
const SAMPLE = `---
name: "Test"
slug: "test-slug"
date: "5. september 2026"
playersPerTeam: null
maxSubstitutes: 0
rankingLevel: "3"
---

Body tekst med **markdown**.

# Tidsskjema

**10:00** Start
`;

test('readMd parses frontmatter and keeps body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-fm-'));
  const p = join(dir, 'test.md');
  writeFileSync(p, SAMPLE);
  const { data, body, hasFrontmatter } = readMd(p);
  assert.equal(hasFrontmatter, true);
  assert.equal(data.slug, 'test-slug');
  assert.equal(data.playersPerTeam, null);
  assert.equal(data.rankingLevel, '3');
  assert.ok(body.startsWith('\nBody tekst') || body.startsWith('Body tekst'));
});

test('patchMd updates keys, preserves body byte-identically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-fm-'));
  const p = join(dir, 'test.md');
  writeFileSync(p, SAMPLE);
  const bodyBefore = readMd(p).body;
  const before = patchMd(p, { registrationOpen: false, date: '6. september 2026' });
  assert.equal(before.registrationOpen, null); // absent before
  assert.equal(before.date, '5. september 2026');
  const after = readMd(p);
  assert.equal(after.data.registrationOpen, false);
  assert.equal(after.data.date, '6. september 2026');
  assert.equal(after.data.name, 'Test'); // untouched
  assert.equal(after.body, bodyBefore);
});

test('createMd writes a valid file that parses back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-fm-'));
  const p = join(dir, 'new.md');
  createMd(p, { name: 'Ny', slug: 'ny-slug', lang: 'no', playersPerTeam: 2, maxSubstitutes: 1, rankingLevel: '10', registrationOpen: false }, '# Hei\n');
  const { data, body } = readMd(p);
  assert.equal(data.slug, 'ny-slug');
  assert.equal(data.maxSubstitutes, 1);
  assert.equal(data.rankingLevel, '10');
  assert.equal(data.registrationOpen, false);
  assert.ok(body.includes('# Hei'));
});

// --- validators ---
test('assertSlug accepts Nordic slugs, rejects bad ones', () => {
  assert.doesNotThrow(() => assertSlug('jæren-open-2025'));
  assert.doesNotThrow(() => assertSlug('nm-2026'));
  assert.throws(() => assertSlug('Jæren-Open'), ValidationError);
  assert.throws(() => assertSlug('slug_med_underscore'), ValidationError);
  assert.throws(() => assertSlug('-leading-dash'), ValidationError);
  assert.throws(() => assertSlug(''), ValidationError);
});

test('assertDateText delegates to parseNoDate', () => {
  assert.doesNotThrow(() => assertDateText('2. mai 2026'));
  assert.throws(() => assertDateText('May 2 2026'), ValidationError);
});

test('assertEmail/assertPhone mirror the API regexes', () => {
  assert.doesNotThrow(() => assertEmail('a@b.no'));
  assert.throws(() => assertEmail('a@b'), ValidationError);
  assert.doesNotThrow(() => assertPhone('+47 123 45 678'));
  assert.doesNotThrow(() => assertPhone(null));
  assert.throws(() => assertPhone('ring meg'), ValidationError);
});

test('assertTeamRule validates counted players and optional substitutes', () => {
  assert.doesNotThrow(() => assertTeamRule(null, 0));
  assert.doesNotThrow(() => assertTeamRule(3, 2));
  assert.throws(() => assertTeamRule(null, 1), ValidationError);
  assert.throws(() => assertTeamRule(0, 0), ValidationError);
  assert.throws(() => assertTeamRule(3, -1), ValidationError);
});

test('assertRankingLevel accepts only the supported ITHF tournament levels', () => {
  assert.doesNotThrow(() => assertRankingLevel(null));
  for (const level of RANKING_LEVELS) assert.doesNotThrow(() => assertRankingLevel(level));
  assert.throws(() => assertRankingLevel('1'), ValidationError);
  assert.throws(() => assertRankingLevel(3), ValidationError);
  assert.doesNotThrow(() => assertTournamentRankingLevel(null, '3'));
  assert.doesNotThrow(() => assertTournamentRankingLevel(2, '10'));
  assert.throws(() => assertTournamentRankingLevel(2, '3'), ValidationError);
  assert.throws(() => assertTournamentRankingLevel(null, '10'), ValidationError);
});

test('tournament MCP schemas and handlers enforce rankingLevel and English sync', async () => {
  const tools = new Map();
  registerTournamentTools({
    registerTool: (name, definition, handler) => tools.set(name, { definition, handler }),
  });
  const createSchema = tools.get('create_tournament').definition.inputSchema.rankingLevel;
  const updateSchema = tools.get('update_tournament').definition.inputSchema.rankingLevel;
  assert.equal(createSchema.safeParse('1-continental').success, true);
  assert.equal(updateSchema.safeParse(null).success, true);
  assert.equal(updateSchema.safeParse('invalid').success, false);
  const invalidTeam = await tools.get('create_tournament').handler({
    name: 'Cup', slug: 'cup-2027', date: '5. september 2027', playersPerTeam: 2,
    rankingLevel: '3',
  });
  const invalidIndividual = await tools.get('create_tournament').handler({
    name: 'Solo', slug: 'solo-2027', date: '5. september 2027', rankingLevel: '10',
  });
  assert.equal(invalidTeam.isError, true);
  assert.match(invalidTeam.content[0].text, /Lagturneringer/);
  assert.equal(invalidIndividual.isError, true);
  assert.match(invalidIndividual.content[0].text, /bare tillatt for lagturneringer/);
  assert.ok(TOURNAMENT_PATCHABLE.includes('rankingLevel'));
  assert.ok(TOURNAMENT_SYNC_TO_EN.includes('rankingLevel'));
});

test('ITHF ranking parser keeps total points separate and rejects missing Player_Value', () => {
  const tsv = [
    'header 1',
    'header 2',
    '1\t42\tValue Player\tOslo BHK\tNOR\t123.45\t98.765',
    '2\t43\tNo Value\t\tSWE\t12\t',
  ].join('\n');
  const { all, byId } = parseRanking(tsv);
  assert.equal(all.length, 1);
  assert.equal(byId.get(42).points, 123.45);
  assert.equal(byId.get(42).value, 98.765);
  assert.equal(byId.has(43), false);
});

test('masking keeps PII out of output', () => {
  assert.equal(maskEmail('amund.fylling@puck.no'), 'a***@puck.no');
  assert.equal(maskPhone('+47 999 88 777'), '+4***77');
});

test('unranked duplicate keys normalize Unicode, case and whitespace', () => {
  assert.equal(canonicalNameKey(' Åge\u00a0 Hansen '), canonicalNameKey('åGE Hansen'));
  assert.equal(canonicalNameKey('Cafe\u0301'), canonicalNameKey('Café'));
});

test('command errors redact SQL and its output from the MCP-visible message', () => {
  const pii = 'person@example.no';
  const err = new CommandError(
    ['npx', 'wrangler', 'd1', 'execute', 'puck-no', '--command', `INSERT INTO registrations (email) VALUES ('${pii}')`],
    1,
    `failed SQL ${pii}`,
    `error near ${pii}`,
    { sensitive: true },
  );
  assert.match(err.message, /\[redacted SQL\]/);
  assert.doesNotMatch(err.message, /person@example\.no/);
});

test('CSV fields neutralize spreadsheet formulas after whitespace/control characters', () => {
  for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '\t=HYPERLINK("https://evil.example")']) {
    assert.ok(csvField(value).startsWith('"\''), value);
  }
  assert.equal(csvField('ordinary'), '"ordinary"');
  assert.equal(csvField('quoted "value"'), '"quoted ""value"""');
});
