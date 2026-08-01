import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'seed-d1.mjs');

const CSV = [
  'tournament,playerName,email,nation,phone,rank,playerId',
  'Norway Open 2026,Ranked One,shared@example.com,NOR,,1,42',
  'Norway Open 2026,Ranked Two,shared@example.com,NOR,,2,43',
  'Norway Open 2026,Unranked One,unranked@example.com,NOR,,,',
  'Norway Open 2026,Unranked One,unranked@example.com,NOR,,,',
  'Norway Open 2026,Unranked Two,unranked@example.com,NOR,,,',
  'Duo-NM 2026,Alpha / Beta,team@example.com,NOR,,,',
  'Duo-NM 2026,Alpha / Beta,other@example.com,NOR,,,',
].join('\n');

const RANKING = [
  [1, 42, 'Ranked One', 'Oslo BHK', 'NOR', 123, 98.5],
  [2, 43, 'Ranked Two', 'Trondheim BHK', 'NOR', 99, 87.5],
];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'puck-seed-d1-test-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src', 'data'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'seed-d1.mjs'));
  writeFileSync(join(dir, 'participants export wix.csv'), CSV);
  writeFileSync(join(dir, 'src', 'data', 'ranking.json'), JSON.stringify(RANKING));
  return dir;
}

function run(dir, ...args) {
  return spawnSync(process.execPath, [join(dir, 'scripts', 'seed-d1.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

function withFixture(fn) {
  const dir = fixture();
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('requires one explicit mode and a second confirmation for replacement', () => {
  withFixture((dir) => {
    const implicit = run(dir);
    assert.equal(implicit.status, 1);
    assert.match(implicit.stderr, /explicit mode is required/);

    const unconfirmed = run(dir, '--replace');
    assert.equal(unconfirmed.status, 1);
    assert.match(unconfirmed.stderr, /requires --allow-delete/);

    const misplacedConfirmation = run(dir, '--append', '--allow-delete');
    assert.equal(misplacedConfirmation.status, 1);
    assert.match(misplacedConfirmation.stderr, /valid only together with --replace/);
  });
});

test('--append emits non-destructive SQL that is idempotent by registration identity', () => {
  withFixture((dir) => {
    const result = run(dir, '--append');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /DELETE FROM registrations/i);
    assert.match(result.stdout, /WHERE NOT EXISTS/);
    assert.match(result.stdout, /player_id = 42/);
    assert.match(result.stdout, /lower\(name\) = lower\('Alpha \/ Beta'\)/);
    assert.equal(existsSync(join(dir, 'src', 'data', 'registrations-snapshot.json')), false);

    // Reports may explain an adjustment but must never echo contact addresses.
    assert.match(result.stderr, /address masked/);
    assert.doesNotMatch(result.stderr, /shared@example\.com|unranked@example\.com|team@example\.com/);

    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE registrations (
      id INTEGER PRIMARY KEY,
      tournament_slug TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      country TEXT,
      club TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      world_ranking INTEGER,
      ranking_points REAL,
      ranking_value REAL,
      player_id INTEGER
    );`);
    db.exec(result.stdout);
    db.exec(result.stdout);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registrations').get().n, 5);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE type = 'team'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE email = 'shared@example.com'").get().n, 2);
    db.close();
  });
});

test('--backfill emits updates only and leaves the snapshot untouched', () => {
  withFixture((dir) => {
    const result = run(dir, '--backfill');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /UPDATE registrations SET player_id = 42/);
    assert.doesNotMatch(result.stdout, /DELETE FROM|INSERT INTO/i);
    assert.equal(existsSync(join(dir, 'src', 'data', 'registrations-snapshot.json')), false);
  });
});

test('--replace --allow-delete is explicitly destructive and regenerates a deduplicated snapshot', () => {
  withFixture((dir) => {
    const result = run(dir, '--replace', '--allow-delete');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DELETE FROM registrations/);
    const snapshotPath = join(dir, 'src', 'data', 'registrations-snapshot.json');
    assert.equal(existsSync(snapshotPath), true);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    assert.equal(snapshot.tournaments['norway-open-2026'].length, 4);
    assert.equal(snapshot.tournaments['duo-nm-2026'].length, 1);
  });
});
