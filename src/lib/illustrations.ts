import type { CollectionEntry } from 'astro:content';

export type IllustrationEntry = CollectionEntry<'illustrations'>;
export type IllustrationScene = IllustrationEntry['data'];
export type IllustrationPath = IllustrationScene['paths'][number];
export type IllustrationPoint = IllustrationPath['points'][number];
export type IllustrationPlayer = IllustrationScene['players'][number];
export type IllustrationPlayerKind = IllustrationPlayer['kind'];
export type IllustrationPuck = NonNullable<IllustrationScene['puck']>;

export const RINK_WIDTH = 415;
export const RINK_HEIGHT = 720;
export const RINK_ASSET = '/illustrations/rinks/stiga-playoff-v1.png';

export const playerSpriteDefinitions = {
  attacker: {
    asset: '/illustrations/players/attacker-yellow.png',
    sourceWidth: 145,
    sourceHeight: 106,
    longestSide: 60,
    pivot: [0.456, 0.304] as const,
  },
  defender: {
    asset: '/illustrations/players/defender-white.png',
    sourceWidth: 127,
    sourceHeight: 84,
    longestSide: 60,
    pivot: [0.42, 0.292] as const,
  },
  goalie: {
    asset: '/illustrations/players/goalie.png',
    sourceWidth: 103,
    sourceHeight: 61,
    longestSide: 48,
    pivot: [0.734, 0.639] as const,
  },
} satisfies Record<IllustrationPlayerKind, {
  asset: string;
  sourceWidth: number;
  sourceHeight: number;
  longestSide: number;
  pivot: readonly [number, number];
}>;

export function playerSpritePlacement(player: IllustrationPlayer) {
  const definition = playerSpriteDefinitions[player.kind];
  const ratio = definition.longestSide / Math.max(definition.sourceWidth, definition.sourceHeight);
  const width = definition.sourceWidth * ratio * player.scale;
  const height = definition.sourceHeight * ratio * player.scale;
  return {
    asset: definition.asset,
    width,
    height,
    x: -definition.pivot[0] * width,
    y: -definition.pivot[1] * height,
  };
}

export const viewportPresets = {
  'offensive-zone': { x: 0, y: 0, width: 415, height: 303 },
  'half-rink': { x: 0, y: 0, width: 415, height: 415 },
  'full-rink': { x: 0, y: 0, width: 415, height: 720 },
} as const;

function rounded(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Convert editor points to a stable SVG path. Curves use Catmull-Rom control points. */
export function illustrationPathData(points: IllustrationPoint[], curve: boolean): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  if (!curve || points.length < 3) {
    return [`M ${rounded(first[0])} ${rounded(first[1])}`, ...rest.map(([x, y]) => `L ${rounded(x)} ${rounded(y)}`)].join(' ');
  }

  const segments = [`M ${rounded(first[0])} ${rounded(first[1])}`];
  for (let index = 0; index < points.length - 1; index++) {
    const before = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1: IllustrationPoint = [
      current[0] + (next[0] - before[0]) / 6,
      current[1] + (next[1] - before[1]) / 6,
    ];
    const control2: IllustrationPoint = [
      next[0] - (after[0] - current[0]) / 6,
      next[1] - (after[1] - current[1]) / 6,
    ];
    segments.push(
      `C ${rounded(control1[0])} ${rounded(control1[1])} ${rounded(control2[0])} ${rounded(control2[1])} ${rounded(next[0])} ${rounded(next[1])}`,
    );
  }
  return segments.join(' ');
}

export function illustrationBySlug(entries: IllustrationEntry[]): Map<string, IllustrationEntry> {
  return new Map(entries.map((entry) => [entry.data.slug, entry]));
}

export function findIllustration(
  slug: string | null | undefined,
  entries: IllustrationEntry[],
): IllustrationEntry | undefined {
  if (!slug) return undefined;
  return entries.find((entry) => entry.data.slug === slug);
}
