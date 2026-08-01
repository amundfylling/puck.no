/**
 * ITHF world ranking lookup — same source and parsing as
 * functions/api/registrations.ts (keep in sync!). Cached briefly
 * in-process; each lookup hits the network at most every 5 minutes.
 */
const RANKING_URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';
const TTL_MS = 5 * 60 * 1000;
const MAX_RANKING_BYTES = 5 * 1024 * 1024;

let cache = null; // { at: number, byId: Map<number, player>, all: player[] }

async function readTextLimited(response, maxBytes) {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Verdensrankingen er uventet stor.');
  if (!response.body) throw new Error('Verdensrankingen er tom.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('Verdensrankingen er uventet stor.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function canonicalNameKey(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('nb-NO');
}

export function parseRanking(tsv) {
  const byId = new Map();
  const all = [];
  for (const line of tsv.split(/\r?\n/).slice(2)) {
    if (!line.trim()) continue;
    const [rank, id, name, club, nation, points, value] = line.split('\t');
    const r = Number(rank);
    const i = Number(id);
    const rankingPoints = Number(points);
    const playerValue = Number(value);
    if (
      Number.isInteger(r) && r > 0 &&
      Number.isInteger(i) && i > 0 &&
      points?.trim() !== '' && Number.isFinite(rankingPoints) && rankingPoints >= 0 &&
      value?.trim() !== '' && Number.isFinite(playerValue) && playerValue >= 0 &&
      name
    ) {
      const p = {
        rank: r,
        id: i,
        name,
        club: club ?? '',
        nation: nation ?? '',
        points: rankingPoints,
        value: playerValue,
      };
      byId.set(i, p);
      all.push(p);
    }
  }
  return { byId, all };
}

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const res = await fetch(RANKING_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Kunne ikke hente verdensrankingen (HTTP ${res.status}).`);
  const tsv = await readTextLimited(res, MAX_RANKING_BYTES);
  const { byId, all } = parseRanking(tsv);
  if (all.length < 1000) {
    throw new Error(`Verdensrankingen ser ufullstendig ut (${all.length} gyldige spillere; forventet minst 1000).`);
  }
  cache = { at: Date.now(), byId, all };
  return cache;
}

/** Case-insensitive substring search on player names. */
export async function searchRanking(query, limit = 10) {
  const { all } = await load();
  const q = query.toLowerCase();
  return all.filter((p) => p.name.toLowerCase().includes(q)).slice(0, limit);
}

/** Exact lookup by ITHF player id (used by add_registration). */
export async function getRankedPlayer(id) {
  const { byId } = await load();
  return byId.get(id) ?? null;
}
