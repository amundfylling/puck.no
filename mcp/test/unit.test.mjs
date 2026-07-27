/** Unit tests for the pure lib helpers (no network, no git, no D1). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseNoDate, tournamentStatus } from '../src/lib/dates.js';
import { sqlValue } from '../src/lib/d1.js';
import { readMd, patchMd, createMd } from '../src/lib/frontmatter.js';
import {
  assertSlug, assertDateText, assertEmail, assertPhone, assertTeamRule,
  maskEmail, maskPhone, ValidationError,
} from '../src/lib/validate.js';

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
teamMin: null
teamMax: null
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
  assert.equal(data.teamMin, null);
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
  createMd(p, { name: 'Ny', slug: 'ny-slug', lang: 'no', teamMin: 2, teamMax: 3, registrationOpen: false }, '# Hei\n');
  const { data, body } = readMd(p);
  assert.equal(data.slug, 'ny-slug');
  assert.equal(data.teamMax, 3);
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

test('assertTeamRule enforces both-or-neither and min<=max', () => {
  assert.doesNotThrow(() => assertTeamRule(null, null));
  assert.doesNotThrow(() => assertTeamRule(2, 2));
  assert.throws(() => assertTeamRule(2, null), ValidationError);
  assert.throws(() => assertTeamRule(3, 2), ValidationError);
  assert.throws(() => assertTeamRule(0, 2), ValidationError);
});

test('masking keeps PII out of output', () => {
  assert.equal(maskEmail('amund.fylling@puck.no'), 'a***@puck.no');
  assert.equal(maskPhone('+47 999 88 777'), '+4***77');
});
