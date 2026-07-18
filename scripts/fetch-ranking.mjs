#!/usr/bin/env node
/**
 * Prebuild step 1 (runs before optimize-media): download the ITHF world
 * ranking (https://stiga.trefik.cz/ithf/ranking/ranking.txt, TSV) and
 * convert it to compact JSON used by the registration form's player search.
 *
 * Output: [rank, id, name, club, nation] per player —
 *   src/data/ranking.json   committed snapshot (offline fallback)
 *   public/ranking.json     served to the client (generated, git-ignored)
 *
 * If the download fails but a committed snapshot exists, the snapshot is
 * kept (warning printed) and still copied to public/.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';
const DATA_FILE = 'src/data/ranking.json';
const PUBLIC_FILE = 'public/ranking.json';

export function parseRanking(tsv) {
  const lines = tsv.split(/\r?\n/);
  // line 0: title ("Table hockey ranking up to ..."), line 1: header
  const players = [];
  for (const line of lines.slice(2)) {
    if (!line.trim()) continue;
    const [rank, id, name, club, nation] = line.split('\t');
    const r = Number(rank);
    const i = Number(id);
    if (!Number.isInteger(r) || !Number.isInteger(i) || !name) continue;
    players.push([r, i, name, club ?? '', nation ?? '']);
  }
  return players;
}

let tsv = null;
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  tsv = await res.text();
} catch (err) {
  console.warn(`fetch-ranking: download failed (${err.message})`);
}

let players;
if (tsv) {
  players = parseRanking(tsv);
  if (players.length < 1000) throw new Error(`fetch-ranking: suspiciously few players parsed (${players.length})`);
  writeFileSync(DATA_FILE, JSON.stringify(players));
  console.log(`fetch-ranking: ${players.length} players -> ${DATA_FILE}`);
} else if (existsSync(DATA_FILE)) {
  console.warn('fetch-ranking: keeping committed snapshot (offline fallback)');
  players = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
} else {
  throw new Error('fetch-ranking: no download and no committed snapshot — cannot build');
}

mkdirSync('public', { recursive: true });
copyFileSync(DATA_FILE, PUBLIC_FILE);
console.log(`fetch-ranking: ${PUBLIC_FILE} written (${players.length} players)`);
