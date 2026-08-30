#!/usr/bin/env node
/**
 * Discover SportScorpion stages for configured tournaments before Astro builds.
 * The committed JSON snapshot is retained per tournament when the provider is
 * unavailable, so a third-party outage never removes links or breaks a build.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { readResponseTextLimited } from './lib/bounded-response.mjs';
import { parseSportScorpionStages, validateSportScorpionSnapshot } from '../functions/lib/sportscorpion.js';

const ORIGIN = 'https://th.sportscorpion.com';
const CONTENT_DIR = 'src/content/tournaments';
const DATA_FILE = 'src/data/sportscorpion-stages.json';
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function configuredTournamentIds() {
  const ids = new Set();
  for (const entry of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const source = readFileSync(`${CONTENT_DIR}/${entry.name}`, 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (!frontmatter) continue;
    const data = YAML.parse(frontmatter);
    if (data?.results?.provider !== 'sportscorpion') continue;
    const id = Number(data.results.tournamentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`fetch-sportscorpion-stages: invalid tournament ID in ${entry.name}`);
    }
    ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

function readFallback() {
  if (!existsSync(DATA_FILE)) return {};
  try {
    const value = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return validateSportScorpionSnapshot(value) ? value : {};
  } catch {
    return {};
  }
}

async function fetchStages(tournamentId) {
  const url = `${ORIGIN}/eng/tournament/id/${tournamentId}/`;
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'puck.no results updater (+https://www.puck.no/)',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (new URL(response.url).origin !== ORIGIN) throw new Error('unexpected redirect origin');
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new Error('unexpected response type');
  }
  const html = await readResponseTextLimited(response, MAX_HTML_BYTES);
  const stages = parseSportScorpionStages(html);
  if (stages.length === 0) throw new Error('no complete stages found');
  return stages;
}

const ids = configuredTournamentIds();
const fallback = readFallback();
const snapshot = {};

for (const id of ids) {
  try {
    snapshot[id] = await fetchStages(id);
    console.log(`fetch-sportscorpion-stages: ${id}: ${snapshot[id].length} stage(s)`);
  } catch (error) {
    console.warn(`fetch-sportscorpion-stages: ${id}: refresh failed (${error.message})`);
    if (fallback[id]) {
      snapshot[id] = fallback[id];
      console.warn(`fetch-sportscorpion-stages: ${id}: keeping committed fallback`);
    }
  }
}

if (!validateSportScorpionSnapshot(snapshot)) {
  throw new Error('fetch-sportscorpion-stages: generated snapshot failed validation');
}
const json = `${JSON.stringify(snapshot, null, 2)}\n`;
if (!existsSync(DATA_FILE) || readFileSync(DATA_FILE, 'utf8') !== json) {
  writeFileSync(DATA_FILE, json);
  console.log(`fetch-sportscorpion-stages: wrote ${DATA_FILE}`);
}
