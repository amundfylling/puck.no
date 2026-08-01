/**
 * ITHF world ranking lookup — copy of mcp/src/lib/ranking.js (same source
 * and parsing as functions/api/registrations.ts — keep in sync!).
 */
const RANKING_URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';
const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RANKING_BYTES = 5 * 1024 * 1024;

let cache = null;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let tsv;
  try {
    const res = await fetch(RANKING_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Kunne ikke hente verdensrankingen (HTTP ${res.status}).`);
    const declared = Number(res.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > MAX_RANKING_BYTES) {
      throw new Error('Verdensrankingen er uventet stor.');
    }
    tsv = await res.text();
    if (new TextEncoder().encode(tsv).byteLength > MAX_RANKING_BYTES) {
      throw new Error('Verdensrankingen er uventet stor.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Tidsavbrudd ved henting av verdensrankingen.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const { byId, all } = parseRanking(tsv);
  if (all.length < 1000) {
    throw new Error(`Verdensrankingen ser ufullstendig ut (${all.length} gyldige spillere; forventet minst 1000).`);
  }
  cache = { at: Date.now(), byId, all };
  return cache;
}

/** Full current ranking for the scheduled registration refresh. */
export async function getRanking() {
  return load();
}

export async function searchRanking(query, limit = 10) {
  const { all } = await load();
  const q = query.toLowerCase();
  return all.filter((p) => p.name.toLowerCase().includes(q)).slice(0, limit);
}

export async function getRankedPlayer(id) {
  const { byId } = await load();
  return byId.get(id) ?? null;
}
