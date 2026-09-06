import type { CollectionEntry } from 'astro:content';

export type IllustrationEntry = CollectionEntry<'illustrations'>;
export type IllustrationScene = IllustrationEntry['data'];
export type IllustrationPath = IllustrationScene['paths'][number];
export type IllustrationPoint = IllustrationPath['points'][number];
export type IllustrationPlayer = IllustrationScene['players'][number];
export type IllustrationPlayerKind = IllustrationPlayer['kind'];
export type IllustrationPlayerRole = NonNullable<IllustrationPlayer['role']>;

export { RINK_WIDTH, RINK_HEIGHT, RINK_ASSET, playerSpriteDefinitions, playerRoleGuides, defaultIllustrationPlayers, snapPointToPlayerGuide, playerSpritePlacement, viewportPresets, illustrationPathData } from './illustration-geometry.ts';

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
