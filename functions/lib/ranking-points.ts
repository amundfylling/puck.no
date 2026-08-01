/** ITHF World Ranking 2020 placement-points algorithm (rules chapter 3). */

export type RankingLevel =
  | '1-world'
  | '1-continental'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '10';

interface LevelRule {
  coefficient: number;
  winnerPoints: number;
}

export interface PlacementPoints {
  placement: number;
  points: number;
  methods: {
    playersBeaten: number;
    numberBeaten: number;
    scaling: number;
    linear: number;
  };
}

export const RANKING_LEVELS: Record<Exclude<RankingLevel, '10'>, LevelRule> = {
  '1-world': { coefficient: 0.96, winnerPoints: 1000 },
  '1-continental': { coefficient: 0.96, winnerPoints: 600 },
  '2': { coefficient: 0.92, winnerPoints: 500 },
  '3': { coefficient: 0.89, winnerPoints: 100 },
  '4': { coefficient: 0.83, winnerPoints: 70 },
  '5': { coefficient: 0.60, winnerPoints: 40 },
  '6': { coefficient: 0.40, winnerPoints: 20 },
};

const round = (value: number): number => Math.floor(value + 0.5);

/**
 * Calculate the points awarded to every possible placement.
 *
 * `playerValues` are the feed's Player_Value values, not total ranking points.
 * The rules' worked example rounds the players-beaten method upward. The other
 * methods use ordinary half-up rounding, and the last-place scaling value is 1.
 */
export function calculatePlacementPoints(
  level: RankingLevel,
  playerValues: number[],
): PlacementPoints[] {
  const values = playerValues
    .map((value) => Number.isFinite(value) && value > 0 ? value : 0)
    .sort((a, b) => b - a);
  const total = values.length;
  if (total === 0) return [];

  if (level === '10' || total < 4) {
    return values.map((_, index) => ({
      placement: index + 1,
      points: 0,
      methods: { playersBeaten: 0, numberBeaten: 0, scaling: 0, linear: 0 },
    }));
  }

  const rule = RANKING_LEVELS[level];
  return values.map((_, index) => {
    const placement = index + 1;
    const compared = values.slice(index, index + 4);
    const average = compared.reduce((sum, value) => sum + value, 0) / compared.length;
    const playersBeaten = Math.ceil(average * rule.coefficient);

    // One point for participation plus one per beaten entrant, linearly capped
    // at 70 when more than 70 players participate.
    const rawNumberBeaten = 1 + (69 * (total - placement)) / (total - 1);
    const numberBeaten = round(Math.min(total - placement + 1, rawNumberBeaten));

    const scaling = placement === total
      ? 1
      : round(rule.winnerPoints / 2 ** index);
    const linear = round(
      1 + ((rule.winnerPoints - 1) * (total - placement)) / (total - 1),
    );
    const best = Math.max(playersBeaten, numberBeaten, scaling, linear);

    return {
      placement,
      points: best + (placement === 1 ? 10 : 0),
      methods: { playersBeaten, numberBeaten, scaling, linear },
    };
  });
}
