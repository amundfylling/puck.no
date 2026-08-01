/**
 * Content tools (git/content plane): news posts, timers, årsmøte PDFs.
 * Writes always go through the branch+PR flow.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { PATHS, REPO_ROOT } from '../lib/config.js';
import { createMd } from '../lib/frontmatter.js';
import { assertSlug, ValidationError } from '../lib/validate.js';
import { ensureClean, commitFiles } from '../lib/git.js';
import { ok, tool } from '../lib/respond.js';

const rel = (abs) => abs.replace(REPO_ROOT, '');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

/** Detect the indent of a JSON file (first nested line's leading spaces). */
function detectIndent(raw) {
  const m = raw.match(/\n(\s+)"/);
  return m ? m[1].length : 2;
}

async function createNewsPost(args) {
  const { title, slug } = args;
  assertSlug(slug);
  const noPath = `${PATHS.postsDir}/${slug}.md`;
  if (existsSync(noPath)) throw new ValidationError(`Innlegget «${slug}» finnes allerede.`);
  const en = args.englishMirror;
  if (en) {
    assertSlug(en.slug, 'engelsk slug');
    if (existsSync(`${PATHS.postsEnDir}/${en.slug}.md`)) {
      throw new ValidationError(`Det engelske innlegget «${en.slug}» finnes allerede.`);
    }
  }

  await ensureClean();
  const touched = [];

  let cover;
  if (args.coverFile) {
    if (!existsSync(args.coverFile)) throw new ValidationError(`Finner ikke bildefilen «${args.coverFile}».`);
    const ext = extname(args.coverFile).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) throw new ValidationError(`Ugyldig bildeformat «${ext}» (tillatt: ${[...IMAGE_EXTS].join(', ')}).`);
    mkdirSync(PATHS.mediaUploadsImages, { recursive: true });
    const dest = `${PATHS.mediaUploadsImages}/${basename(args.coverFile)}`;
    if (existsSync(dest)) throw new ValidationError(`Et bilde med filnavnet «${basename(dest)}» finnes allerede.`);
    copyFileSync(args.coverFile, dest);
    cover = `/media/images/${basename(args.coverFile)}`;
    touched.push(rel(dest));
  }

  const pubDate = args.pubDate ?? new Date().toISOString();
  createMd(noPath, {
    title,
    slug,
    lang: 'no',
    pubDate,
    categories: args.categories ?? [],
    ...(cover ? { cover } : {}),
    description: args.description ?? null,
  }, args.body);
  touched.push(rel(noPath));

  if (en) {
    createMd(`${PATHS.postsEnDir}/${en.slug}.md`, {
      title: en.title,
      slug: en.slug,
      lang: 'en',
      pubDate,
      categories: args.categories ?? [],
      ...(cover ? { cover } : {}),
      description: en.description ?? null,
    }, en.body);
    touched.push(rel(`${PATHS.postsEnDir}/${en.slug}.md`));

    // Register the slug pair for hreflang + the language switcher.
    const i18n = readFileSync(PATHS.i18n, 'utf8');
    const marker = 'export const postMirrorsNoToEn: Record<string, string> = {';
    if (!i18n.includes(marker)) throw new Error('Fant ikke postMirrorsNoToEn i src/lib/i18n.ts');
    if (i18n.includes(`'${slug}':`)) throw new ValidationError(`postMirrorsNoToEn har allerede en oppføring for «${slug}».`);
    writeFileSync(PATHS.i18n, i18n.replace(marker, `${marker}\n  '${slug}': '${en.slug}',`));
    touched.push(rel(PATHS.i18n));
  }

  const result = await commitFiles({
    files: touched,
    message: `content(posts): add ${slug}`,
  });
  return ok(
    `Nyhetsinnlegg opprettet: «${title}» (${slug})${en ? ' + engelsk versjon' : ''}. ` +
      `PR: ${result.prUrl}` +
      (cover ? ' Forsidebildet optimaliseres automatisk ved bygg.' : ''),
    { files: touched, git: result },
  );
}

async function addTimer(args) {
  const { title } = args;
  if (!existsSync(args.file)) throw new ValidationError(`Finner ikke filen «${args.file}».`);
  if (extname(args.file).toLowerCase() !== '.mp3') throw new ValidationError('Kun MP3-filer støttes.');

  await ensureClean();
  const dest = `${PATHS.audioDir}/${basename(args.file)}`;
  if (existsSync(dest)) throw new ValidationError(`En lydfil med filnavnet «${basename(dest)}» finnes allerede.`);
  copyFileSync(args.file, dest);

  const raw = readFileSync(PATHS.timersJson, 'utf8');
  const timers = JSON.parse(raw);
  const entry = {
    title,
    file: `/media/audio/${basename(args.file)}`,
    ...(args.durationHint ? { duration_hint: args.durationHint } : {}),
  };
  timers.push(entry);
  writeFileSync(PATHS.timersJson, JSON.stringify(timers, null, detectIndent(raw)) + '\n');

  const result = await commitFiles({
    files: [rel(dest), rel(PATHS.timersJson)],
    message: `content(data): add timer "${title}"`,
  });
  return ok(
    `Timer «${title}» lagt til. ` +
      `PR: ${result.prUrl}`,
    { entry, git: result },
  );
}

async function addArsmoteDocument(args) {
  const { title, year } = args;
  if (!existsSync(args.file)) throw new ValidationError(`Finner ikke filen «${args.file}».`);
  if (extname(args.file).toLowerCase() !== '.pdf') throw new ValidationError('Kun PDF-filer støttes.');

  await ensureClean();
  const dest = `${PATHS.pdfDir}/${basename(args.file)}`;
  if (existsSync(dest)) throw new ValidationError(`En PDF med filnavnet «${basename(dest)}» finnes allerede.`);
  copyFileSync(args.file, dest);

  const raw = readFileSync(PATHS.documentsJson, 'utf8');
  const documents = JSON.parse(raw);
  const entry = { title, year, file: `/media/pdf/${basename(args.file)}`, page: '/årsmøter' };
  documents.unshift(entry); // newest first, matching the existing order
  writeFileSync(PATHS.documentsJson, JSON.stringify(documents, null, detectIndent(raw)) + '\n');

  const result = await commitFiles({
    files: [rel(dest), rel(PATHS.documentsJson)],
    message: `content(data): add årsmøte document "${title}"`,
  });
  return ok(
    `Dokument «${title}» (${year}) lagt til. ` +
      `PR: ${result.prUrl}`,
    { entry, git: result },
  );
}

export function registerContentTools(server) {
  server.registerTool(
    'create_news_post',
    {
      title: 'Create news post',
      description:
        'WRITES GIT (branch + PR). Creates a news post (Norwegian + optional English mirror with the hreflang slug pair registered). Cover image is copied into the media pipeline and optimized at build time.',
      inputSchema: {
        title: z.string(),
        slug: z.string(),
        pubDate: z.string().optional().describe('ISO datetime (default: now)'),
        categories: z.array(z.string()).optional().describe('e.g. ["Turneringsreferat"]'),
        body: z.string().describe('Markdown body'),
        description: z.string().nullish().describe('Excerpt/meta description'),
        coverFile: z.string().optional().describe('Absolute local path to a cover image'),
        englishMirror: z
          .object({
            slug: z.string(),
            title: z.string(),
            body: z.string(),
            description: z.string().nullish(),
          })
          .optional(),
      },
    },
    tool(createNewsPost),
  );

  server.registerTool(
    'add_timer',
    {
      title: 'Add timer (MP3)',
      description: 'WRITES GIT (branch + PR). Copies an MP3 into public/media/audio and adds a row to src/data/timers.json.',
      inputSchema: {
        title: z.string(),
        file: z.string().describe('Absolute local path to the MP3'),
        durationHint: z.string().optional().describe('e.g. "05:38"'),
      },
    },
    tool(addTimer),
  );

  server.registerTool(
    'add_arsmote_document',
    {
      title: 'Add årsmøte document (PDF)',
      description: 'WRITES GIT (branch + PR). Copies a PDF into public/media/pdf and adds a row to src/data/documents.json.',
      inputSchema: {
        title: z.string().describe('e.g. "Årsmøtereferat 2026"'),
        year: z.number().int().min(2000).max(2100),
        file: z.string().describe('Absolute local path to the PDF'),
      },
    },
    tool(addArsmoteDocument),
  );
}
