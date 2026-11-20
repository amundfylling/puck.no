#!/usr/bin/env node
/**
 * Prebuild: Norwegian NBL statistics (adelskalender + tournament streaks).
 *
 * Every build (including the daily scheduled rebuild) reads the public ITHF
 * series page for the Norwegian NBL. Participant lists are cached in the
 * snapshot itself, so only tournaments that are new — or whose player count
 * changed on ITHF — are downloaded. The cache comes from the current
 * production snapshot, falling back to the committed copy in src/data/.
 * If ITHF is unreachable the latest deployed or committed snapshot is reused.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readResponseTextLimited } from './lib/bounded-response.mjs';
import {
  NBL_SERIAL_ID,
  buildNblStats,
  cachedTournaments,
  parseSerialMedals,
  parseSerialTournaments,
  parseTournamentPlayers,
  validateNblStats,
} from './lib/nbl-stats.mjs';

const BASE = 'https://stiga.trefik.cz/ithf/ranking';
const SERIAL_URL = `${BASE}/serial.aspx?ID=${NBL_SERIAL_ID}`;
const DEPLOYED_SNAPSHOT_URL = 'https://puck-no.pages.dev/nbl-statistikk.json';
const DATA_FILE = 'src/data/nbl-statistikk.json';
const PUBLIC_FILE = 'public/nbl-statistikk.json';
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
// Re-download at most this many changed tournaments per build to stay polite;
// anything left over is picked up by the next (daily) build.
const MAX_TOURNAMENT_FETCHES = 250;

const headers = {
  accept: 'text/html,application/xhtml+xml',
  'user-agent': 'puck.no statistics updater (+https://www.puck.no/)',
};

async function fetchText(url, options = {}, maxBytes = MAX_HTML_BYTES) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await readResponseTextLimited(response, maxBytes);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? 'download failed'}`);
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function readLocalSnapshot() {
  if (!existsSync(DATA_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return validateNblStats(data) ? data : null;
  } catch {
    return null;
  }
}

async function readDeployedSnapshot() {
  try {
    const raw = await fetchText(DEPLOYED_SNAPSHOT_URL, { headers: { accept: 'application/json' } }, MAX_JSON_BYTES);
    const data = JSON.parse(raw);
    return validateNblStats(data) ? data : null;
  } catch (error) {
    console.warn(`nbl-stats: deployed snapshot unavailable (${error.message})`);
    return null;
  }
}

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.generatedAt) >= Date.parse(b.generatedAt) ? a : b;
}

async function generate(cacheSource, now) {
  const html = await fetchText(SERIAL_URL);
  const medals = parseSerialMedals(html);
  const listed = parseSerialTournaments(html);
  if (medals.length < 20) throw new Error(`Suspiciously few medallists (${medals.length}).`);
  if (listed.length < 50) throw new Error(`Suspiciously few tournaments (${listed.length}).`);

  const cache = cachedTournaments(cacheSource);
  const stale = listed.filter((tournament) => {
    const cached = cache.get(tournament.id);
    return !cached || (tournament.playerCount !== null && cached.players.length !== tournament.playerCount);
  });
  const toFetch = stale.slice(-MAX_TOURNAMENT_FETCHES);
  console.log(`nbl-stats: ${listed.length} tournaments, ${cache.size} cached, fetching ${toFetch.length}`);

  const fetched = new Map(await mapLimit(toFetch, CONCURRENCY, async (tournament) => {
    const players = parseTournamentPlayers(await fetchText(`${BASE}/tournament.aspx?id=${tournament.id}`));
    if (players.length === 0) throw new Error(`Tournament ${tournament.id} has no parsable players.`);
    return [tournament.id, players];
  }));

  const tournaments = [];
  for (const tournament of listed) {
    const players = fetched.get(tournament.id) ?? cache.get(tournament.id)?.players;
    if (!players) continue; // Left for the next build (fetch cap reached).
    tournaments.push({ ...tournament, players });
  }

  const data = buildNblStats({ medals, tournaments, generatedAt: now.toISOString() });
  if (!validateNblStats(data)) throw new Error('Generated NBL statistics failed validation.');
  return data;
}

function writeSnapshot(data) {
  const json = `${JSON.stringify(data)}\n`;
  writeFileSync(DATA_FILE, json);
  writeFileSync(PUBLIC_FILE, json);
}

const now = new Date();
const local = readLocalSnapshot();
const deployed = process.env.NBL_STATS_OFFLINE === '1' ? null : await readDeployedSnapshot();
const fallback = newer(deployed, local);
let snapshot = null;

if (process.env.NBL_STATS_OFFLINE !== '1') {
  try {
    snapshot = await generate(fallback, now);
    console.log('nbl-stats: live refresh complete');
  } catch (error) {
    console.warn(`nbl-stats: live refresh failed (${error.message})`);
  }
}
snapshot ??= fallback;

if (!snapshot) throw new Error('nbl-stats: no valid live, deployed, or committed snapshot is available');
writeSnapshot(snapshot);
console.log(`nbl-stats: ${snapshot.generatedAt} (${snapshot.tournamentCount} tournaments) -> ${DATA_FILE}, ${PUBLIC_FILE}`);
