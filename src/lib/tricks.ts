import type { CollectionEntry } from 'astro:content';
import type { Lang } from './i18n';

export type TrickEntry = CollectionEntry<'tricks'>;
export type TrickPlayer = TrickEntry['data']['players'][number];
export type DifficultyGroup = 'starter' | 'intermediate' | 'advanced';

export const playerLabels: Record<TrickPlayer, Record<Lang, string>> = {
  center: { no: 'Senter', en: 'Centre' },
  'right-wing': { no: 'Høyreving', en: 'Right wing' },
  'left-wing': { no: 'Venstreving', en: 'Left wing' },
  'right-defense': { no: 'Høyreback', en: 'Right defence' },
  'left-defense': { no: 'Venstreback', en: 'Left defence' },
  goalie: { no: 'Keeper', en: 'Goalie' },
};

export const difficultyLabels: Record<DifficultyGroup, Record<Lang, string>> = {
  starter: { no: 'Nybegynner · 0–3', en: 'Starter · 0–3' },
  intermediate: { no: 'Viderekommen · 4–6', en: 'Intermediate · 4–6' },
  advanced: { no: 'Avansert · 7–10', en: 'Advanced · 7–10' },
};

export function difficultyGroup(difficulty: number): DifficultyGroup {
  if (difficulty <= 3) return 'starter';
  if (difficulty <= 6) return 'intermediate';
  return 'advanced';
}

export function trickPath(slug: string, lang: Lang): string {
  return lang === 'en' ? `/en/combinations/${slug}/` : `/kombinasjoner/${slug}/`;
}

export function cataloguePath(lang: Lang): string {
  return lang === 'en'
    ? '/en/lær-bordhockey-kombinasjoner/'
    : '/lær-bordhockey-kombinasjoner/';
}

export function sortTricks(entries: TrickEntry[]): TrickEntry[] {
  return [...entries].sort((a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name, 'no'));
}

export function relatedTricks(current: TrickEntry, entries: TrickEntry[], limit = 3): TrickEntry[] {
  return entries
    .filter((entry) => entry.data.slug !== current.data.slug)
    .map((entry) => ({
      entry,
      playerMatch: entry.data.players.some((player) => current.data.players.includes(player)) ? 1 : 0,
      distance: Math.abs(entry.data.difficulty - current.data.difficulty),
    }))
    .sort((a, b) => b.playerMatch - a.playerMatch || a.distance - b.distance || a.entry.data.order - b.entry.data.order)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
