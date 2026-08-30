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
    author: z.string().min(1),
    pubDate: z.coerce.date(),
    categories: z.array(z.string()),
    cover: z.string().nullable().optional(),
    description: z.string().nullable(),
  }),
});

const registrationQuestion = z.object({
  /** Stable machine key; changing labels must not invalidate stored answers. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  labelNo: z.string().min(1),
  labelEn: z.string().min(1),
  required: z.boolean().default(false),
  options: z.array(
    z.object({
      value: z.string().min(1),
      labelNo: z.string().min(1),
      labelEn: z.string().min(1),
    }),
  ).min(2),
});

const rankingLevel = z.enum([
  '1-world',
  '1-continental',
  '2',
  '3',
  '4',
  '5',
  '6',
  '10',
]);

const tournamentResults = z.object({
  provider: z.literal('sportscorpion'),
  tournamentId: z.number().int().positive(),
  stages: z.array(
    z.object({
      id: z.number().int().positive(),
      type: z.enum(['bracket', 'table']),
      labelNo: z.string().min(1),
      labelEn: z.string().min(1),
    }),
  ).default([]),
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
    parent: z.string().optional(),
    prices: z.string().nullable(),
    playingSystem: z.string().nullable(),
    /** Frontmatter hint — computed status (date vs build date) wins, see lib/tournaments.ts. */
    status: z.enum(['upcoming', 'past']),
    /** Internal fixtures/previews are retained in content but never published or exposed to the API. */
    draft: z.boolean().default(false),
    /** false = registration closed (form hidden, API rejects). Default: open. */
    registrationOpen: z.boolean().default(true),
    /** Exact number of highest-rated roster members whose points count. Null = individual. */
    playersPerTeam: z.number().int().min(1).nullable().default(null),
    /** Optional roster places beyond playersPerTeam; those players do not count for seeding. */
    maxSubstitutes: z.number().int().min(0).default(0),
    /** Registration-level, single-choice questions. Labels/options are bilingual. */
    registrationQuestions: z.array(registrationQuestion).default([]),
    /** ITHF WR tournament level; level 1 distinguishes World/Continental winner guarantees. */
    rankingLevel: rankingLevel.nullable().default(null),
    /** Optional official results hub. The Norwegian mirror is the shared source for both languages. */
    results: tournamentResults.nullable().default(null),
  }).superRefine((data, ctx) => {
    if (data.playersPerTeam != null && data.rankingLevel != null && data.rankingLevel !== '10') {
      ctx.addIssue({ code: 'custom', path: ['rankingLevel'], message: 'Team tournaments can only use ranking level 10.' });
    }
    if (data.playersPerTeam == null && data.rankingLevel === '10') {
      ctx.addIssue({ code: 'custom', path: ['rankingLevel'], message: 'Ranking level 10 is only for team tournaments.' });
    }
  }),
});

export const collections = { pages, posts, tournaments };
