import type { CollectionEntry } from 'astro:content';

export type IllustrationEntry = CollectionEntry<'illustrations'>;
export type IllustrationScene = IllustrationEntry['data'];
export type IllustrationPath = IllustrationScene['paths'][number];
export type IllustrationPoint = IllustrationPath['points'][number];
export type IllustrationPlayer = IllustrationScene['players'][number];
export type IllustrationPlayerKind = IllustrationPlayer['kind'];
export type IllustrationPlayerRole = NonNullable<IllustrationPlayer['role']>;

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

/**
 * Physical rod paths traced from the original th_animator scene. A player
 * with a role stays on its corresponding path; role-less players remain free.
 */
export const playerRoleGuides = {
  'left-wing': [
    [232.2, 58.5], [114.5, 58.5], [88.7, 69.7], [68.5, 85.4],
    [57.3, 114.5], [55.1, 149.3], [59.6, 217.6], [66.3, 259.1], [82, 296.1],
  ],
  center: [[210.9, 210.9], [237.8, 404.8]],
  'right-wing': [[334.1, 67.5], [348.7, 91], [352.1, 123.5], [361, 417.1]],
  'left-defense': [[132.4, 121.3], [136.9, 305], [132.5, 331], [133, 666]],
  'right-defense': [[285.9, 57.4], [288.2, 337.5], [284.8, 360], [269.1, 390.2], [281, 418], [286, 601]],
  goalie: [[184, 160.5], [244.5, 165]],
} as const satisfies Record<IllustrationPlayerRole, readonly (readonly [number, number])[]>;

const defaultPlayerLayout = [
  { id: 'attacking-left-wing', kind: 'attacker', role: 'left-wing', position: [57.3, 114.5], rotation: -180, scale: 0.86 },
  { id: 'attacking-center', kind: 'attacker', role: 'center', position: [210.9, 210.9], rotation: -180, scale: 0.86 },
  { id: 'attacking-right-wing', kind: 'attacker', role: 'right-wing', position: [356.5, 270], rotation: -88, scale: 0.86 },
  { id: 'defending-left-defense', kind: 'defender', role: 'left-defense', position: [134.1, 189.9], rotation: 98, scale: 0.86 },
  { id: 'defending-right-defense', kind: 'defender', role: 'right-defense', position: [286.8, 166], rotation: 94, scale: 0.86 },
  { id: 'defending-goalie', kind: 'goalie', role: 'goalie', position: [192.8, 161.1], rotation: 180, scale: 0.9 },
] as const satisfies readonly IllustrationPlayer[];

export function defaultIllustrationPlayers(): IllustrationPlayer[] {
  return defaultPlayerLayout.map((player) => ({
    ...player,
    position: [...player.position],
  }));
}

export function snapPointToPlayerGuide(
  point: IllustrationPoint,
  role: IllustrationPlayer['role'],
): IllustrationPoint {
  if (!role) return [...point];
  const guide = playerRoleGuides[role];
  let closest: IllustrationPoint = [...guide[0]];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < guide.length - 1; index += 1) {
    const start = guide[index];
    const end = guide[index + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    const candidate: IllustrationPoint = [
      start[0] + dx * progress,
      start[1] + dy * progress,
    ];
    const distance = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2;
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest.map((value) => Number(value.toFixed(1))) as IllustrationPoint;
}

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

/** Keep a legacy diagram public until an editor explicitly approves its SVG replacement. */
export function publicIllustration(
  entry: IllustrationEntry | undefined,
  legacyDiagram: string | null | undefined,
): IllustrationEntry | undefined {
  if (!entry) return undefined;
  return !legacyDiagram || entry.data.published ? entry : undefined;
}

export function findIllustration(
  slug: string | null | undefined,
  entries: IllustrationEntry[],
): IllustrationEntry | undefined {
  if (!slug) return undefined;
  return entries.find((entry) => entry.data.slug === slug);
}
