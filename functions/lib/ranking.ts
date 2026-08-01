/// <reference types="@cloudflare/workers-types" />

export const RANKING_URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';

export interface RankedPlayer {
  rank: number;
  id: number;
  name: string;
  club: string;
  nation: string;
  points: number;
  /** Exact tournament-calculation input published as Player_Value in the feed. */
  value: number;
}

export interface RosterPlayer {
  playerId: number | null;
  name: string;
  club: string | null;
  country: string | null;
  worldRanking: number | null;
  rankingPoints: number;
  rankingValue: number;
}

export interface TeamSeed {
  roster: RosterPlayer[];
  rankingPoints: number;
  topWorldRanking: number | null;
}

export function parseRanking(tsv: string): Map<number, RankedPlayer> {
  const map = new Map<number, RankedPlayer>();
  for (const line of tsv.split(/\r?\n/).slice(2)) {
    if (!line.trim()) continue;
    const [rank, id, name, club, nation, points, playerValue] = line.split('\t');
    const parsedRank = Number(rank);
    const parsedId = Number(id);
    const parsedPoints = Number(points);
    const parsedValue = Number(playerValue);
    if (
      Number.isInteger(parsedRank) &&
      parsedRank > 0 &&
      Number.isInteger(parsedId) &&
      parsedId > 0 &&
      points?.trim() !== '' &&
      Number.isFinite(parsedPoints) &&
      parsedPoints >= 0 &&
      playerValue?.trim() !== '' &&
      Number.isFinite(parsedValue) &&
      parsedValue >= 0 &&
      name
    ) {
      map.set(parsedId, {
        rank: parsedRank,
        id: parsedId,
        name,
        club: club ?? '',
        nation: nation ?? '',
        points: parsedPoints,
        value: parsedValue,
      });
    }
  }
  return map;
}

/** Fetch the live ITHF ranking; Cloudflare caches the shared feed for six hours. */
export async function fetchRanking(): Promise<Map<number, RankedPlayer>> {
  const res = await fetch(RANKING_URL, {
    cf: { cacheTtl: 21600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`ranking HTTP ${res.status}`);
  const ranking = parseRanking(await res.text());
  if (ranking.size < 1000) throw new Error(`ranking parse returned only ${ranking.size} players`);
  return ranking;
}

export function rankedRosterPlayer(player: RankedPlayer): RosterPlayer {
  return {
    playerId: player.id,
    name: player.name,
    club: player.club || null,
    country: player.nation || null,
    worldRanking: player.rank,
    rankingPoints: player.points,
    rankingValue: player.value,
  };
}

export function unrankedRosterPlayer(name: string): RosterPlayer {
  return {
    playerId: null,
    name,
    club: null,
    country: null,
    worldRanking: null,
    rankingPoints: 0,
    rankingValue: 0,
  };
}

export function seedTeam(roster: RosterPlayer[], playersPerTeam: number): TeamSeed {
  const sorted = [...roster].sort((a, b) => {
    if (a.rankingPoints !== b.rankingPoints) return b.rankingPoints - a.rankingPoints;
    if (a.worldRanking == null && b.worldRanking != null) return 1;
    if (a.worldRanking != null && b.worldRanking == null) return -1;
    if (a.worldRanking != null && b.worldRanking != null && a.worldRanking !== b.worldRanking) {
      return a.worldRanking - b.worldRanking;
    }
    return a.name.localeCompare(b.name, 'no');
  });
  return {
    roster: sorted,
    rankingPoints: sorted.slice(0, playersPerTeam).reduce((sum, player) => sum + player.rankingPoints, 0),
    topWorldRanking: sorted.find((player) => player.worldRanking != null)?.worldRanking ?? null,
  };
}
