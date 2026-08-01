#!/usr/bin/env node
/**
 * Generates seed SQL for the registrations table from the REAL Wix export
 * "participants export wix.csv" (repo root, GIT-IGNORED — contains real
 * emails/phones and must never be committed).
 *
 * Destructive replacement also regenerates src/data/registrations-snapshot.json
 * (name, country, world_ranking ONLY — no emails/phones). Append and backfill
 * leave that live-data fallback untouched.
 *
 * Mapping: the export's `tournament` names are mapped to our slugs via
 * TOURNAMENT_MAP below. Unmapped rows are skipped and reported.
 * type: 'team' for duo-nm-2026 (names are already "A, B" pairs), else
 * 'player'. rank → world_ranking (empty/invalid → NULL).
 * Emails: required (rows without are skipped + reported). The partial unique
 * guard for unranked individual players means shared contact addresses in that
 * group get a deterministic +dupN local-part suffix. Reports never print the
 * address itself.
 *
 * Usage:
 *   node scripts/seed-d1.mjs --append > "$puck_seed_sql"               # non-destructive, repeatable
 *   node scripts/seed-d1.mjs --backfill > "$puck_seed_sql"             # update legacy ranked players
 *   node scripts/seed-d1.mjs --replace --allow-delete > "$puck_seed_sql" # EMPTY/throwaway DB only
 *   npx wrangler d1 execute puck-no --local  --file="$puck_seed_sql"
 *   npx wrangler d1 execute puck-no --remote --file="$puck_seed_sql"
 *
 * The SQL contains contact details. Create puck_seed_sql with mktemp, chmod it
 * to 0600 before redirecting output, and remove it immediately after use.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const knownFlags = new Set(['--append', '--backfill', '--replace', '--allow-delete']);
const unknownFlags = argv.filter((arg) => arg.startsWith('--') && !knownFlags.has(arg));
const modes = ['--append', '--backfill', '--replace'].filter((flag) => argv.includes(flag));

function usageError(message) {
  console.error(`seed-d1: ${message}`);
  console.error('Choose exactly one mode: --append, --backfill, or --replace --allow-delete.');
  process.exit(1);
}

if (unknownFlags.length) usageError(`unknown option(s): ${unknownFlags.join(', ')}`);
if (modes.length !== 1) usageError('an explicit mode is required');
const MODE = modes[0].slice(2);
const allowDelete = argv.includes('--allow-delete');
if (MODE === 'replace' && !allowDelete) {
  usageError('--replace is destructive and also requires --allow-delete');
}
if (MODE !== 'replace' && allowDelete) {
  usageError('--allow-delete is valid only together with --replace');
}

const CSV_FILE = fileURLToPath(new URL('../participants export wix.csv', import.meta.url));
const RANKING_FILE = fileURLToPath(new URL('../src/data/ranking.json', import.meta.url));
if (!existsSync(CSV_FILE)) {
  console.error(`seed-d1: "${CSV_FILE}" not found — the Wix export is git-ignored;`);
  console.error('place it in the repo root before seeding.');
  process.exit(1);
}

/** Wix export tournament name -> our tournament slug. */
const TOURNAMENT_MAP = {
  'Norway Open 2026': 'norway-open-2026',
  'Duo-NM 2026': 'duo-nm-2026',
  'NM 2026 - Dame': 'norgesmesterskapet-2026-dame',
  'NM 2026 - Veteran': 'norgesmesterskapet-2026-veteran',
  'NM 2026 - Junior': 'norgesmesterskapet-2026-junior',
  'NM 2026 - U13': 'norgesmesterskapet-2026-u13',
  'NM 2026 - Åpen klasse': 'norgesmesterskapet-2026',
  'Trondheim Open 2026': 'trondheim-open-2025',
  'Jæren Open 2026': 'jæren-open-2025',
  'Bergen Open 2025': 'bergen-open-2025',
  'Sudden Death Cup at Preikestolen': 'sudden-death-cup',
  'Sudden Death Cup at Pulpit Rock': 'sudden-death-cup', // English alias, same 2025 event
  'Norway Open 2025': 'norway-open-2025',
};

const TEAM_SLUGS = new Set(['duo-nm-2026']);

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\n' && text[i - 1] === '\r') continue;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const esc = (s) => `'${String(s).replaceAll("'", "''")}'`;

const rows = parseCsv(readFileSync(CSV_FILE, 'utf8').replace(/^﻿/, ''));
const rankingById = new Map(
  JSON.parse(readFileSync(RANKING_FILE, 'utf8'))
    .map(([rank, id, name, club, nation, points, playerValue]) => [
      id,
      { rank, name, club: club || null, nation: nation || null, points, playerValue },
    ]),
);
const header = rows[0];
const col = (name) => header.indexOf(name);
const data = rows.slice(1).filter((r) => r.length > 5);

const seeded = []; // {slug, type, name, country, club, email, phone, wr, rankingPoints, rankingValue, playerId}
const skipped = []; // {reason, tournament, name}
const adjusted = []; // {tournament, name, note}; email is deliberately omitted

const seenSourceRows = new Set(); // collapse exact identities before email adjustment
const seenEmails = new Map(); // key slug|email -> count (unranked individuals only)

for (const r of data) {
  const tournament = r[col('tournament')];
  const name = r[col('playerName')].trim();
  const slug = TOURNAMENT_MAP[tournament];
  if (!slug) {
    skipped.push({ reason: 'unmapped tournament', tournament, name });
    continue;
  }
  const emailRaw = r[col('email')].trim().toLowerCase();
  if (!emailRaw) {
    skipped.push({ reason: 'missing email', tournament, name });
    continue;
  }
  const type = TEAM_SLUGS.has(slug) ? 'team' : 'player';
  const pidRaw = r[col('playerId')].trim();
  const playerId = pidRaw && Number.isInteger(Number(pidRaw)) ? Number(pidRaw) : null;

  // Do this before applying a +dupN suffix. Otherwise an accidental duplicate
  // CSV row would be assigned a new address and imported as a second person.
  const sourceIdentity = type === 'team'
    ? `${slug}|team|${name.toLocaleLowerCase('en')}`
    : playerId != null
      ? `${slug}|player-id|${playerId}`
      : `${slug}|unranked|${name.toLocaleLowerCase('en')}|${emailRaw}`;
  if (seenSourceRows.has(sourceIdentity)) {
    skipped.push({ reason: 'duplicate source identity', tournament, name });
    continue;
  }
  seenSourceRows.add(sourceIdentity);

  // Only unranked individual players are unique on contact email. Ranked
  // players use player_id, while teams may intentionally share a contact.
  const key = `${slug}|${emailRaw}`;
  let email = emailRaw;
  if (type === 'player' && playerId == null) {
    const seen = seenEmails.get(key) ?? 0;
    seenEmails.set(key, seen + 1);
    if (seen > 0) {
      const [local, domain] = emailRaw.split('@');
      email = `${local}+dup${seen + 1}@${domain}`;
      adjusted.push({
        tournament,
        name,
        note: `shared unranked-player email -> applied +dup${seen + 1} suffix (address masked)`,
      });
    }
  }
  const country = r[col('nation')].trim() || null;
  const phone = r[col('phone')].trim() || null;
  const rankRaw = r[col('rank')].trim();
  const wr = rankRaw && Number.isInteger(Number(rankRaw)) ? Number(rankRaw) : null;
  const ranked = playerId == null ? null : rankingById.get(playerId) ?? null;
  seeded.push({
    slug, type, name, country, email, phone, wr, playerId,
    club: ranked?.club ?? null,
    rankingPoints: ranked?.points ?? null,
    rankingValue: ranked?.playerValue ?? null,
  });
}

// Collapse duplicate source identities before generating SQL and the optional
// replacement snapshot. This mirrors the API's identity rules and keeps a full
// replacement consistent with repeatable append mode.
const importRows = [];
const seenIdentities = new Set();
for (const s of seeded) {
  const identity = s.type === 'team'
    ? `${s.slug}|team|${s.name.toLocaleLowerCase('en')}`
    : s.playerId != null
      ? `${s.slug}|player-id|${s.playerId}`
      : `${s.slug}|player-email|${s.email.toLocaleLowerCase('en')}`;
  if (seenIdentities.has(identity)) {
    skipped.push({ reason: 'duplicate source identity', tournament: s.slug, name: s.name });
    continue;
  }
  seenIdentities.add(identity);
  importRows.push(s);
}

// --- SQL ---
const lines = [
  '-- Generated by scripts/seed-d1.mjs from "participants export wix.csv" (real Wix data).',
  `-- Mode: ${MODE}. This file contains personal data; keep it mode 0600 and delete it after use.`,
];
if (MODE === 'backfill') {
  // Idempotent player_id backfill for databases seeded before 0002_player_id.
  lines.push('-- Backfill mode: set player_id on already-seeded individual rows (matched by slug+name+email).');
  for (const s of importRows) {
    if (s.type === 'player' && s.playerId != null) {
      lines.push(
        `UPDATE registrations SET player_id = ${s.playerId}, club = ${s.club ? esc(s.club) : 'NULL'}, ` +
        `ranking_points = ${s.rankingPoints ?? 'NULL'}, ranking_value = ${s.rankingValue ?? 'NULL'} ` +
        `WHERE tournament_slug = ${esc(s.slug)} AND type = 'player' AND name = ${esc(s.name)} ` +
        `AND lower(email) = lower(${esc(s.email)});`,
      );
    }
  }
} else {
  if (MODE === 'replace') {
    lines.push(
      '-- DESTRUCTIVE replacement explicitly requested with --replace --allow-delete.',
      'DELETE FROM registrations;',
    );
  } else {
    lines.push('-- Append mode: every INSERT is guarded and safe to run repeatedly.');
  }
  for (const s of importRows) {
    const duplicateGuard = s.type === 'team'
      ? `tournament_slug = ${esc(s.slug)} AND type = 'team' AND lower(name) = lower(${esc(s.name)})`
      : s.playerId != null
        ? `tournament_slug = ${esc(s.slug)} AND type = 'player' AND player_id = ${s.playerId}`
        : `tournament_slug = ${esc(s.slug)} AND type = 'player' AND player_id IS NULL ` +
          `AND lower(email) = lower(${esc(s.email)})`;
    lines.push(
      `INSERT INTO registrations (tournament_slug, type, name, country, club, email, phone, world_ranking, ranking_points, ranking_value, player_id) SELECT ` +
        `${esc(s.slug)}, ${esc(s.type)}, ${esc(s.name)}, ${s.country ? esc(s.country) : 'NULL'}, ${s.club ? esc(s.club) : 'NULL'}, ` +
        `${esc(s.email)}, ${s.phone ? esc(s.phone) : 'NULL'}, ${s.wr ?? 'NULL'}, ${s.rankingPoints ?? 'NULL'}, ` +
        `${s.rankingValue ?? 'NULL'}, ${s.playerId ?? 'NULL'} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM registrations WHERE ${duplicateGuard});`,
    );
  }
}

// A full replacement starts from the complete legacy source, so it can safely
// regenerate the static fallback. Append/backfill must not overwrite a snapshot
// that may also contain newer live registrations; sync that from D1 separately.
if (MODE === 'replace') {
  const tournaments = {};
  for (const s of importRows) {
    (tournaments[s.slug] ??= []).push({
      name: s.name,
      country: s.country ?? '',
      ...(s.wr != null ? { world_ranking: String(s.wr) } : {}),
    });
  }
  for (const list of Object.values(tournaments)) {
    list.sort((a, b) => {
      const aw = a.world_ranking != null ? Number(a.world_ranking) : Infinity;
      const bw = b.world_ranking != null ? Number(b.world_ranking) : Infinity;
      return aw - bw || a.name.localeCompare(b.name);
    });
  }
  const snapshot = {
    snapshot_date: new Date().toISOString().slice(0, 10),
    tournaments,
  };
  writeFileSync(
    fileURLToPath(new URL('../src/data/registrations-snapshot.json', import.meta.url)),
    JSON.stringify(snapshot, null, 1) + '\n',
  );
} else {
  console.error('seed-d1: snapshot unchanged; append/backfill cannot safely replace live D1-derived data.');
}

// --- report ---
const counts = {};
for (const s of importRows) counts[s.slug] = (counts[s.slug] ?? 0) + 1;
console.error('seed-d1: rows per tournament:');
for (const [slug, n] of Object.entries(counts).sort()) console.error(`  ${slug}: ${n}`);
console.error(`seed-d1: ${MODE} rows prepared ${importRows.length}/${data.length}`);
if (adjusted.length) {
  console.error(`seed-d1: ${adjusted.length} shared-email adjustment(s):`);
  for (const a of adjusted) console.error(`  [${a.tournament}] ${a.name} — ${a.note}`);
}
if (skipped.length) {
  console.error(`seed-d1: ${skipped.length} SKIPPED row(s):`);
  const byReason = {};
  for (const s of skipped) (byReason[s.reason] ??= []).push(s);
  for (const [reason, list] of Object.entries(byReason)) {
    console.error(`  ${reason} (${list.length}):`);
    for (const s of list) console.error(`    ${s.tournament} — ${s.name}`);
  }
}

console.log(lines.join('\n'));
