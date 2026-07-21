import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

// Path-based ids ("index", "en/index", ...) — the default id generation
// collides on the shared `slug` frontmatter across NO/EN files.
const byPath = ({ entry }: { entry: string }) => entry.replace(/\.md$/, '');

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages', generateId: byPath }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    lang: z.enum(['no', 'en']),
    description: z.string().nullable(),
    seoTitle: z.string().nullable(),
    menuOrder: z.number().nullable(),
  }),
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts', generateId: byPath }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    lang: z.enum(['no', 'en']),
    pubDate: z.coerce.date(),
    categories: z.array(z.string()),
    cover: z.string().nullable().optional(),
    description: z.string().nullable(),
  }),
});

const tournaments = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/tournaments', generateId: byPath }),
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    lang: z.enum(['no', 'en']).default('no'),
    /** Display date, Norwegian text (e.g. "5. september 2026"). */
    date: z.string(),
    location: z.string().nullable(),
    prices: z.string().nullable(),
    playingSystem: z.string().nullable(),
    /** Frontmatter hint — computed status (date vs build date) wins, see lib/tournaments.ts. */
    status: z.enum(['upcoming', 'past']),
    /**
     * Team tournament: both set => teams of teamMin..teamMax players may register.
     * Both null (default) => individual tournament. Mirrored to the API via
     * scripts/gen-tournament-config.mjs (runs in prebuild).
     */
    teamMin: z.number().int().min(1).nullable().default(null),
    teamMax: z.number().int().min(1).nullable().default(null),
  }),
});

export const collections = { pages, posts, tournaments };
