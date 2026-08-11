#!/usr/bin/env node
/**
 * Weekly VM 2027 qualification refresh.
 *
 * Wednesday builds (Europe/Oslo) rebuild the standings from public ITHF
 * calendar and player-profile data. Other builds copy the snapshot from the
 * current production deployment so the daily static rebuild does not revert
 * Wednesday's result. A committed local snapshot is the final offline fallback.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readResponseTextLimited } from './lib/bounded-response.mjs';
import {
  buildQualificationData,
  isInternationalChampionship,
  parseCalendarHtml,
  parsePlayerHtml,
  parseSharedThird,
  validateQualificationData,
} from './lib/qualification.mjs';

const BASE = 'https://stiga.trefik.cz/ithf/ranking';
const CALENDAR_URL = `${BASE}/calendar.aspx`;
const DEPLOYED_SNAPSHOT_URL = 'https://puck-no.pages.dev/kvalifisering-vm27.json';
const DATA_FILE = 'src/data/kvalifisering-vm27.json';
const PUBLIC_FILE = 'public/kvalifisering-vm27.json';
const RANKING_FILE = 'src/data/ranking.json';
const START = '2025-07-01';
const END = '2027-06-10';
const LEVELS = [2, 3, 4, 5];
const PROFILE_CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

const headers = {
  accept: 'text/html,application/xhtml+xml',
  'user-agent': 'puck.no qualification updater (+https://www.puck.no/)',
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

function hiddenValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function osloDateParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
}

function effectiveEndDate(now = new Date()) {
  const today = osloDateParts(now).iso;
  return today < END ? today : END;
}

async function fetchCalendarLevel(level, endDate) {
  const initial = await fetchText(CALENDAR_URL);
  const viewState = hiddenValue(initial, '__VIEWSTATE');
  const viewStateGenerator = hiddenValue(initial, '__VIEWSTATEGENERATOR');
  const eventValidation = hiddenValue(initial, '__EVENTVALIDATION');
  if (!viewState || !viewStateGenerator || !eventValidation) throw new Error('ITHF calendar form fields are missing.');

  const [endYear, endMonth] = endDate.split('-');
  const body = new URLSearchParams({
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    __EVENTVALIDATION: eventValidation,
    DLSinceM: '7',
    DLSinceY: '2025',
    DLTillM: String(Number(endMonth)),
    DLTillY: endYear,
    DLCountry: '0',
    DLSerial: `${level},5`,
    ButSerial: 'Filter by series',
  });
  const html = await fetchText(CALENDAR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const parsed = parseCalendarHtml(html).filter((tournament) => tournament.date >= START && tournament.date <= END);
  console.log(`qualification: ITHF level ${level}: ${parsed.length} tournaments`);
  return parsed;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function generateSnapshot(now = new Date()) {
  const endDate = effectiveEndDate(now);
  if (endDate < START) throw new Error('The qualification period has not started.');
  const calendarGroups = await Promise.all(LEVELS.map((level) => fetchCalendarLevel(level, endDate)));
  const tournamentMap = new Map();
  for (const tournament of calendarGroups.flat()) tournamentMap.set(tournament.id, tournament);
  const tournaments = [...tournamentMap.values()];
  if (tournaments.length < 10) throw new Error(`Suspiciously few eligible tournaments (${tournaments.length}).`);
  console.log(`qualification: ${tournaments.length} unique eligible tournaments`);

  const ranking = JSON.parse(readFileSync(RANKING_FILE, 'utf8'));
  const candidates = ranking
    .filter((row) => row[4] === 'NOR' && Number(row[5]) > 0)
    .map((row) => ({ id: Number(row[1]), name: String(row[2]) }));
  if (candidates.length < 50) throw new Error(`Suspiciously few Norwegian players (${candidates.length}).`);
  console.log(`qualification: checking ${candidates.length} Norwegian player profiles`);

  let completed = 0;
  const players = await mapLimit(candidates, PROFILE_CONCURRENCY, async (player) => {
    const html = await fetchText(`${BASE}/player.aspx?id=${player.id}`);
    completed += 1;
    if (completed % 50 === 0 || completed === candidates.length) {
      console.log(`qualification: profiles ${completed}/${candidates.length}`);
    }
    return parsePlayerHtml(html, player);
  });

  const relevantTournamentIds = new Set(
    players.flatMap((player) => player.results.map((result) => result.tournamentId))
      .filter((id) => tournamentMap.has(id)),
  );
  const norwegianOpen = tournaments.filter((tournament) =>
    tournament.country === 'NOR' &&
    !isInternationalChampionship(tournament.name) &&
    !/\b(?:women|ladies|juniors?|veterans?|kids?|u\s*-?\s*13|55\s*\+)\b/i.test(tournament.name) &&
    relevantTournamentIds.has(tournament.id));
  const sharedThirdPairs = await mapLimit(norwegianOpen, 8, async (tournament) => {
    const html = await fetchText(`${BASE}/tournament.aspx?id=${tournament.id}`);
    return [tournament.id, parseSharedThird(html)];
  });
  const sharedThirdIds = new Set(sharedThirdPairs.filter(([, shared]) => shared).map(([id]) => id));
  console.log(`qualification: checked ${norwegianOpen.length} Norwegian tournaments for shared bronze`);

  const data = buildQualificationData({
    players,
    tournaments,
    sharedThirdIds,
    generatedAt: now.toISOString(),
  });
  if (!validateQualificationData(data)) throw new Error('Generated qualification snapshot failed validation.');
  return data;
}

function readLocalFallback() {
  if (!existsSync(DATA_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return validateQualificationData(data) ? data : null;
  } catch {
    return null;
  }
}

async function readDeployedSnapshot() {
  try {
    const raw = await fetchText(DEPLOYED_SNAPSHOT_URL, { headers: { accept: 'application/json' } }, MAX_JSON_BYTES);
    const data = JSON.parse(raw);
    return validateQualificationData(data) ? data : null;
  } catch (error) {
    console.warn(`qualification: deployed snapshot unavailable (${error.message})`);
    return null;
  }
}

function writeSnapshot(data) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(DATA_FILE, json);
  writeFileSync(PUBLIC_FILE, json);
}

const now = new Date();
const force = process.env.QUALIFICATION_FORCE_REFRESH === '1';
const isWednesday = osloDateParts(now).weekday === 'Wed';
const localFallback = readLocalFallback();
let snapshot;

if (force || isWednesday) {
  try {
    snapshot = await generateSnapshot(now);
    console.log('qualification: live Wednesday refresh complete');
  } catch (error) {
    console.warn(`qualification: live refresh failed (${error.message})`);
    snapshot = await readDeployedSnapshot() ?? localFallback;
  }
} else {
  snapshot = await readDeployedSnapshot() ?? localFallback;
  console.log('qualification: non-Wednesday build, carrying the latest deployed snapshot forward');
}

if (!snapshot) throw new Error('qualification: no valid live, deployed, or committed snapshot is available');
writeSnapshot(snapshot);
console.log(`qualification: ${snapshot.generatedAt} -> ${DATA_FILE}, ${PUBLIC_FILE}`);
