/**
 * ITHF world ranking lookup — copy of mcp/src/lib/ranking.js (same source
 * and parsing as functions/api/registrations.ts — keep in sync!).
 */
const RANKING_URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';
const TTL_MS = 5 * 60 * 1000;

let cache = null;

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const res = await fetch(RANKING_URL);
  if (!res.ok) throw new Error(`Kunne ikke hente verdensrankingen (HTTP ${res.status}).`);
  const tsv = await res.text();
  const byId = new Map();
  const all = [];
  for (const line of tsv.split(/\r?\n/).slice(2)) {
    if (!line.trim()) continue;
    const [rank, id, name, club, nation] = line.split('\t');
    const r = Number(rank);
    const i = Number(id);
    if (Number.isInteger(r) && Number.isInteger(i) && name) {
      const p = { rank: r, id: i, name, club: club ?? '', nation: nation ?? '' };
      byId.set(i, p);
      all.push(p);
    }
  }
  cache = { at: Date.now(), byId, all };
  return cache;
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
