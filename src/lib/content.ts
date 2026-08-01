import { getCollection, type CollectionEntry } from 'astro:content';
import { endOfDay, parseNoDate } from './dates';
import type { Lang } from './i18n';

export type Post = CollectionEntry<'posts'>;
export type Tournament = CollectionEntry<'tournaments'>;
export type Page = CollectionEntry<'pages'>;

export const BLOG_PAGE_SIZE = 10;

/** Posts for a language, newest first. */
export async function getPosts(lang: Lang): Promise<Post[]> {
  const posts = await getCollection('posts', (p) => p.data.lang === lang);
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** Blog category slug, matching the old Wix paths (/blog/categories/<slug>). */
export function categorySlug(category: string): string {
  return category.toLowerCase().replace(/\s+/g, '-');
}

/** Distinct categories of a post list, in first-seen order. */
export function postCategories(posts: Post[]): string[] {
  return [...new Set(posts.flatMap((p) => p.data.categories))];
}

/**
 * Status is computed from the tournament date vs the build date — the
 * frontmatter `status` field is only a hint. Strict rule: only tournaments
 * whose date is today or later count as upcoming.
 */
export function tournamentStatus(t: Tournament, now: Date = new Date()): 'upcoming' | 'past' {
  const date = parseNoDate(t.data.date);
  if (!date) return t.data.status;
  return endOfDay(date) >= now ? 'upcoming' : 'past';
}

export interface TournamentView {
  entry: Tournament;
  status: 'upcoming' | 'past';
  date: Date | null;
  image: string | null;
  /** Display name — English mirror's name when lang=en and a mirror exists. */
  name: string;
}

/** First body image of a tournament page (the banner photo), if any. */
export function tournamentImage(t: Tournament): string | null {
  return t.body?.match(/!\[[^\]]*\]\((\/media\/[^)\s]+)\)/)?.[1] ?? null;
}

/** English mirror (src/content/tournaments/en/) for a Norwegian tournament. */
export async function getTournamentMirror(entry: Tournament): Promise<Tournament | undefined> {
  const en = await getCollection(
    'tournaments',
    (t) => !t.data.draft && t.data.lang === 'en' && t.data.slug === entry.data.slug,
  );
  return en[0];
}

/** All tournaments: upcoming first (soonest first), then past (newest first). */
export async function getTournamentsSorted(
  now: Date = new Date(),
  lang: Lang = 'no',
): Promise<TournamentView[]> {
  const all = await getCollection('tournaments', (t) => !t.data.draft && t.data.lang === 'no');
  let enNames = new Map<string, string>();
  if (lang === 'en') {
    const mirrors = await getCollection('tournaments', (t) => !t.data.draft && t.data.lang === 'en');
    enNames = new Map(mirrors.map((t) => [t.data.slug, t.data.name]));
  }
  const views = all.map((entry) => ({
    entry,
    status: tournamentStatus(entry, now),
    date: parseNoDate(entry.data.date),
    image: tournamentImage(entry),
    name: enNames.get(entry.data.slug) ?? entry.data.name,
  }));
  const upcoming = views
    .filter((v) => v.status === 'upcoming')
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const past = views
    .filter((v) => v.status === 'past')
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return [...upcoming, ...past];
}

/** Static pages for a language. */
export async function getPages(lang: Lang): Promise<Page[]> {
  return getCollection('pages', (p) => p.data.lang === lang);
}

export interface TournamentFamily<T extends { entry: Tournament; date: Date | null }> {
  main: T;
  children: T[];
}

/**
 * Group tournament items by family (main tournament + children sub-tournaments).
 * Input: sorted array of tournament items (e.g. TournamentView[]).
 * Output: Array<{ main: Item, children: Item[] }>.
 */
export function groupByParent<T extends { entry: Tournament; date: Date | null }>(
  list: T[],
  allSlugs?: Set<string> | string[],
): TournamentFamily<T>[] {
  const fullSlugSet = allSlugs ? new Set(allSlugs) : null;
  const listMap = new Map<string, T>();
  for (const item of list) {
    listMap.set(item.entry.data.slug, item);
  }

  const familyMap = new Map<string, TournamentFamily<T>>();
  const result: TournamentFamily<T>[] = [];

  // First pass: identify mains and initialize families
  for (const item of list) {
    const parentSlug = item.entry.data.parent;
    let isChild = false;

    if (parentSlug) {
      const parentInList = listMap.get(parentSlug);
      if (parentInList) {
        if (parentInList.entry.data.parent) {
          console.warn(
            `Tournament "${item.entry.data.slug}" has parent "${parentSlug}" which is also a child tournament (two-level nesting). Treating as main.`,
          );
        } else {
          isChild = true;
        }
      } else {
        if (fullSlugSet && !fullSlugSet.has(parentSlug)) {
          console.warn(
            `Tournament "${item.entry.data.slug}" references unknown parent "${parentSlug}". Treating as main.`,
          );
        }
      }
    }

    if (!isChild) {
      const family: TournamentFamily<T> = { main: item, children: [] };
      familyMap.set(item.entry.data.slug, family);
      result.push(family);
    }
  }

  // Second pass: attach children to their main's family
  for (const item of list) {
    const parentSlug = item.entry.data.parent;
    if (!parentSlug) continue;

    const parentInList = listMap.get(parentSlug);
    if (parentInList && !parentInList.entry.data.parent) {
      const family = familyMap.get(parentSlug);
      if (family) {
        family.children.push(item);
      }
    }
  }

  // Sort children by date ascending
  for (const family of result) {
    family.children.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  }

  return result;
}
