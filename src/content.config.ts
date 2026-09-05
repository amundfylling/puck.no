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
    /** Official results; configure on the Norwegian source for both languages. */
    results: z.object({
      provider: z.literal('sportscorpion'),
      tournamentId: z.number().int().positive(),
    }).nullable().default(null),
  }).superRefine((data, ctx) => {
    if (data.playersPerTeam != null && data.rankingLevel != null && data.rankingLevel !== '10') {
      ctx.addIssue({ code: 'custom', path: ['rankingLevel'], message: 'Team tournaments can only use ranking level 10.' });
    }
    if (data.playersPerTeam == null && data.rankingLevel === '10') {
      ctx.addIssue({ code: 'custom', path: ['rankingLevel'], message: 'Ranking level 10 is only for team tournaments.' });
    }
  }),
});

const trickPlayer = z.enum([
  'center',
  'right-wing',
  'left-wing',
  'right-defense',
  'left-defense',
  'goalie',
]);

const tricks = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/tricks' }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    players: z.array(trickPlayer).min(1),
    difficulty: z.number().int().min(0).max(10),
    description: z.object({
      no: z.string().min(1),
      en: z.string().min(1),
    }),
    /** Slug of an editable SVG scene in src/content/illustrations. */
    illustration: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
    /** Legacy raster fallback while combinations are migrated to editable scenes. */
    diagram: z.string().startsWith('/media/').nullable().optional(),
    videoUrl: z.string().regex(/^https?:\/\//).nullable().optional(),
    legacyAnchor: z.string().min(1).optional(),
    order: z.number().int().positive(),
  }),
});

const illustrationPoint = z.tuple([
  z.number().min(0).max(415),
  z.number().min(0).max(720),
]);

const illustrationPlayerKind = z.enum(['attacker', 'defender', 'goalie']);

const illustrationPlayer = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: illustrationPlayerKind,
  role: trickPlayer.nullable().optional(),
  position: illustrationPoint,
  rotation: z.number().min(-360).max(360).default(0),
  scale: z.number().min(0.5).max(1.5).default(1),
});

const illustrations = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/illustrations' }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.literal(1),
    rink: z.literal('stiga-playoff-v1'),
    /** Opt in only after the editable scene has been approved against its legacy diagram. */
    published: z.boolean().default(false),
    viewport: z.object({
      x: z.number().min(0).max(415),
      y: z.number().min(0).max(720),
      width: z.number().positive().max(415),
      height: z.number().positive().max(720),
    }),
    paths: z.array(z.object({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      step: z.number().int().min(1).max(20),
      kind: z.enum(['pass', 'move', 'shot']).default('pass'),
      curve: z.boolean().default(false),
      followsWall: z.boolean().default(false),
      points: z.array(illustrationPoint).min(2),
      label: illustrationPoint,
    })).min(1),
    /** Independently positioned sprites; shared assets and pivots live in src/lib/illustrations.ts. */
    players: z.array(illustrationPlayer).default([]),
    /** Movement arrows carry the puck route; a separate puck marker would duplicate that information. */
    puck: z.null().default(null),
  }).superRefine((data, ctx) => {
    if (data.viewport.x + data.viewport.width > 415) {
      ctx.addIssue({ code: 'custom', path: ['viewport', 'width'], message: 'Viewport exceeds rink width (415).' });
    }
    if (data.viewport.y + data.viewport.height > 720) {
      ctx.addIssue({ code: 'custom', path: ['viewport', 'height'], message: 'Viewport exceeds rink height (720).' });
    }
    const ids = new Set<string>();
    const steps = new Set<number>();
    data.paths.forEach((path, index) => {
      if (path.kind !== 'move' && path.curve && !path.followsWall) {
        ctx.addIssue({ code: 'custom', path: ['paths', index, 'curve'], message: 'Curved puck paths must follow the wall behind a goal.' });
      }
      if (path.followsWall && path.kind === 'move') {
        ctx.addIssue({ code: 'custom', path: ['paths', index, 'followsWall'], message: 'Player movement cannot be marked as a wall-following puck path.' });
      }
      if (path.followsWall && (!path.curve || path.points.length < 3)) {
        ctx.addIssue({ code: 'custom', path: ['paths', index, 'followsWall'], message: 'A wall-following puck path must be curved and contain at least three points.' });
      }
      if (ids.has(path.id)) {
        ctx.addIssue({ code: 'custom', path: ['paths', index, 'id'], message: `Duplicate path id: ${path.id}` });
      }
      if (steps.has(path.step)) {
        ctx.addIssue({ code: 'custom', path: ['paths', index, 'step'], message: `Duplicate step: ${path.step}` });
      }
      ids.add(path.id);
      steps.add(path.step);
    });
    const ordered = [...steps].sort((a, b) => a - b);
    ordered.forEach((step, index) => {
      if (step !== index + 1) {
        ctx.addIssue({ code: 'custom', path: ['paths'], message: 'Steps must be consecutive and start at 1.' });
      }
    });
    const playerIds = new Set<string>();
    data.players.forEach((player, index) => {
      if (playerIds.has(player.id)) {
        ctx.addIssue({ code: 'custom', path: ['players', index, 'id'], message: `Duplicate player id: ${player.id}` });
      }
      playerIds.add(player.id);
    });
  }),
});

export const collections = { pages, posts, tournaments, tricks, illustrations };
