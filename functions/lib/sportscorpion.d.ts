export interface SportScorpionStage {
  id: number;
  name: string;
  type: 'bracket' | 'table';
}

export function parseSportScorpionStages(html: string): SportScorpionStage[];
export function isSportScorpionStageArray(value: unknown): value is SportScorpionStage[];
export function validateSportScorpionSnapshot(
  value: unknown,
): value is Record<string, SportScorpionStage[]>;
