/**
 * Tournament tools (git/content plane). Writes go through the branch+PR
 * flow: every developer-side mutation opens a branch and pull request.
 */
import { existsSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { PATHS, REPO_ROOT } from '../lib/config.js';
import { readMd, patchMd, createMd } from '../lib/frontmatter.js';
import { tournamentStatus, parseNoDate } from '../lib/dates.js';
import {
  assertSlug, assertDateText, assertTeamRule, assertTournamentRankingLevel,
  RANKING_LEVELS, readTournamentConfig, tournamentFiles, ValidationError,
} from '../lib/validate.js';
import { d1, d1Select, sqlValue } from '../lib/d1.js';
import { ensureClean, commitFiles } from '../lib/git.js';
import { run } from '../lib/run.js';
import { ok, tool } from '../lib/respond.js';

const rel = (abs) => abs.replace(REPO_ROOT, '');

async function regenerateConfig() {
  await run('node', [PATHS.genTournamentConfig], { cwd: REPO_ROOT });
}

/** All Norwegian tournament entries with computed status (+ live counts). */
async function listTournaments() {
  const entries = [];
  for (const file of readdirSync(PATHS.tournamentsDir).filter((f) => f.endsWith('.md'))) {
    const { data } = readMd(`${PATHS.tournamentsDir}/${file}`);
    if (!data.slug || data.lang === 'en' || data.draft === true) continue;
    entries.push({
      slug: data.slug,
      name: data.name,
      date: data.date,
      location: data.location ?? null,
      status: tournamentStatus(data.date),
      registrationOpen: data.registrationOpen !== false,
      rankingLevel: data.rankingLevel ?? null,
      team: data.playersPerTeam != null
        ? `${data.playersPerTeam} teller + opptil ${data.maxSubstitutes ?? 0} innbyttere`
        : 'individuell',
    });
  }
  entries.sort((a, b) => {
    const au = a.status === 'upcoming' ? 0 : 1;
    const bu = b.status === 'upcoming' ? 0 : 1;
    if (au !== bu) return au - bu;
    const da = parseNoDate(a.date)?.getTime() ?? 0;
    const db = parseNoDate(b.date)?.getTime() ?? 0;
    return a.status === 'upcoming' ? da - db : db - da;
  });

  let counts = {};
  let countsNote;
  try {
    const rows = await d1Select(
      'SELECT tournament_slug, COUNT(*) AS n FROM registrations GROUP BY tournament_slug',
    );
    for (const r of rows) counts[r.tournament_slug] = r.n;
  } catch (err) {
    countsNote = `Live-telling utilgjengelig: ${err.message}`;
  }
  for (const e of entries) e.registrations = counts[e.slug] ?? 0;
  return ok(
    countsNote ? `${entries.length} turneringer. ${countsNote}` : `${entries.length} turneringer (med live påmeldingstall).`,
    entries,
  );
}

async function createTournament(args) {
  const { name, slug, date } = args;
  assertSlug(slug);
  assertDateText(date);
  assertTeamRule(args.playersPerTeam ?? null, args.maxSubstitutes ?? 0);
  assertTournamentRankingLevel(args.playersPerTeam ?? null, args.rankingLevel ?? null);
  const files = tournamentFiles(slug);
  if (existsSync(files.no)) throw new ValidationError(`Turneringen «${slug}» finnes allerede (${rel(files.no)}).`);
  if (readTournamentConfig()[slug]) throw new ValidationError(`Slug «${slug}» finnes allerede i API-konfigen.`);

  await ensureClean();

  const fields = {
    name,
    slug,
    date,
    location: args.location ?? null,
    prices: args.prices ?? null,
    playingSystem: args.playingSystem ?? null,
    status: 'upcoming',
    ...(args.registrationOpen === false ? { registrationOpen: false } : {}),
    playersPerTeam: args.playersPerTeam ?? null,
    maxSubstitutes: args.maxSubstitutes ?? 0,
    registrationQuestions: args.registrationQuestions ?? [],
    rankingLevel: args.rankingLevel ?? null,
  };
  const body =
    args.body ??
    `Beskrivelse kommer.\n\n# Tidsskjema\n\n**10:00** Dørene åpner\n`;
  createMd(files.no, fields, body);

  const touched = [rel(files.no)];
  if (args.englishName) {
    const enFields = {
      name: args.englishName,
      slug,
      lang: 'en',
      date,
      location: args.location ?? null,
      prices: args.prices ?? null,
      playingSystem: args.playingSystem ?? null,
      status: 'upcoming',
      ...(args.registrationOpen === false ? { registrationOpen: false } : {}),
      playersPerTeam: args.playersPerTeam ?? null,
      maxSubstitutes: args.maxSubstitutes ?? 0,
      registrationQuestions: args.registrationQuestions ?? [],
      rankingLevel: args.rankingLevel ?? null,
    };
    createMd(`${PATHS.tournamentsEnDir}/${slug}.md`, enFields, args.englishBody ?? 'Description coming.\n\n# Schedule\n\n**10:00** Doors open\n');
    touched.push(rel(`${PATHS.tournamentsEnDir}/${slug}.md`));
  }

  await regenerateConfig();
  touched.push('functions/lib/tournament-config.json');

  const result = await commitFiles({
    files: touched,
    message: `feat(tournaments): add ${slug}`,
  });
  return ok(
    `Turnering opprettet: ${name} (${slug}). ` +
      `PR: ${result.prUrl}` +
      ' Siden bygges på nytt ved merge; turneringen dukker da opp under /turneringer med påmeldingsskjema.',
    { files: touched, git: result },
  );
}

export const TOURNAMENT_PATCHABLE = ['name', 'date', 'location', 'prices', 'playingSystem', 'status', 'registrationOpen', 'playersPerTeam', 'maxSubstitutes', 'registrationQuestions', 'rankingLevel'];
/** Fields that must stay in sync in the EN mirror (non-translatable). */
export const TOURNAMENT_SYNC_TO_EN = ['date', 'location', 'status', 'registrationOpen', 'playersPerTeam', 'maxSubstitutes', 'registrationQuestions', 'rankingLevel'];

async function updateTournament(args) {
  const { slug, ...patch } = args;
  assertSlug(slug);
  const files = tournamentFiles(slug);
  if (!existsSync(files.no)) throw new ValidationError(`Fant ikke turneringen «${slug}».`);

  const clean = {};
  for (const key of TOURNAMENT_PATCHABLE) if (patch[key] !== undefined) clean[key] = patch[key];
  if (Object.keys(clean).length === 0) throw new ValidationError('Ingen felt å oppdatere.');
  if (clean.date !== undefined) assertDateText(clean.date);
  const current = readMd(files.no).data;
  if (clean.playersPerTeam !== undefined || clean.maxSubstitutes !== undefined) {
    assertTeamRule(
      clean.playersPerTeam !== undefined ? clean.playersPerTeam : current.playersPerTeam,
      clean.maxSubstitutes !== undefined ? clean.maxSubstitutes : current.maxSubstitutes,
    );
  }
  if (clean.rankingLevel !== undefined || clean.playersPerTeam !== undefined) {
    assertTournamentRankingLevel(
      clean.playersPerTeam !== undefined ? clean.playersPerTeam : current.playersPerTeam,
      clean.rankingLevel !== undefined ? clean.rankingLevel : current.rankingLevel,
    );
  }

  await ensureClean();
  const before = patchMd(files.no, clean);
  const touched = [rel(files.no)];

  let enBefore = null;
  if (files.en) {
    const enPatch = {};
    for (const key of TOURNAMENT_SYNC_TO_EN) if (clean[key] !== undefined) enPatch[key] = clean[key];
    if (Object.keys(enPatch).length) {
      enBefore = patchMd(files.en, enPatch);
      touched.push(rel(files.en));
    }
  }

  await regenerateConfig();
  touched.push('functions/lib/tournament-config.json');

  const result = await commitFiles({
    files: touched,
    message: `feat(tournaments): update ${slug} (${Object.keys(clean).join(', ')})`,
  });
  return ok(
    `Oppdaterte ${slug}: ${Object.keys(clean).join(', ')}. ` +
      `PR: ${result.prUrl}`,
    { before, after: clean, enMirrorSynced: enBefore != null, git: result },
  );
}

async function duplicateTournament(args) {
  const { sourceSlug, newSlug, newDate } = args;
  assertSlug(newSlug, 'ny slug');
  assertDateText(newDate);
  const src = tournamentFiles(sourceSlug);
  if (!existsSync(src.no)) throw new ValidationError(`Fant ikke kildeturneringen «${sourceSlug}».`);
  const dst = tournamentFiles(newSlug);
  if (existsSync(dst.no)) throw new ValidationError(`«${newSlug}» finnes allerede.`);

  await ensureClean();
  const { data, body } = readMd(src.no);
  assertTeamRule(data.playersPerTeam ?? null, data.maxSubstitutes ?? 0);
  assertTournamentRankingLevel(data.playersPerTeam ?? null, data.rankingLevel ?? null);
  createMd(dst.no, {
    ...data,
    name: args.newName ?? data.name,
    slug: newSlug,
    date: newDate,
    status: 'upcoming',
  }, body);
  const touched = [rel(dst.no)];

  if (src.en) {
    const en = readMd(src.en);
    createMd(`${PATHS.tournamentsEnDir}/${newSlug}.md`, {
      ...en.data,
      name: args.newEnglishName ?? en.data.name,
      slug: newSlug,
      lang: 'en',
      date: newDate,
      status: 'upcoming',
      rankingLevel: data.rankingLevel ?? null,
    }, en.body);
    touched.push(rel(`${PATHS.tournamentsEnDir}/${newSlug}.md`));
  }

  await regenerateConfig();
  touched.push('functions/lib/tournament-config.json');

  const result = await commitFiles({
    files: touched,
    message: `feat(tournaments): add ${newSlug} (copy of ${sourceSlug})`,
  });
  return ok(
    `Kopierte ${sourceSlug} → ${newSlug}. ` +
      `PR: ${result.prUrl}` +
      ' Husk å gjennomgå innholdet (tidsskjema, priser) før publisering.',
    { files: touched, git: result },
  );
}

async function setRegistrationOpen(slug, open) {
  assertSlug(slug);
  const files = tournamentFiles(slug);
  if (!existsSync(files.no)) throw new ValidationError(`Fant ikke turneringen «${slug}».`);

  await ensureClean();
  // Apply the fail-closed runtime veto before the slower branch/PR flow.
  // Opening only removes the veto; closed frontmatter still wins until the
  // pull request is merged and Pages has rebuilt the generated config.
  if (open) {
    await d1(`DELETE FROM tournament_settings WHERE tournament_slug = ${sqlValue(slug)}`);
  } else {
    await d1(
      `INSERT INTO tournament_settings (tournament_slug, registration_open, updated_at)
       VALUES (${sqlValue(slug)}, 0, datetime('now'))
       ON CONFLICT(tournament_slug) DO UPDATE SET
         registration_open = 0,
         updated_at = excluded.updated_at`,
    );
  }
  patchMd(files.no, { registrationOpen: open });
  const touched = [rel(files.no)];
  if (files.en) {
    patchMd(files.en, { registrationOpen: open });
    touched.push(rel(files.en));
  }
  await regenerateConfig();
  touched.push('functions/lib/tournament-config.json');

  const result = await commitFiles({
    files: touched,
    message: `feat(tournaments): ${open ? 'open' : 'close'} registration for ${slug}`,
  });
  return ok(
    (open
      ? `Åpningsendringen for ${slug} er klar. Påmelding åpner etter merge og neste bygg. `
      : `Påmelding for ${slug} er STENGT i API-et med én gang. `) +
      `PR: ${result.prUrl}` +
      ' Det statiske skjemaet synkroniseres etter merge og neste bygg.',
    { slug, registrationOpen: open, git: result },
  );
}

async function archiveTournament(args) {
  const { slug } = args;
  assertSlug(slug);
  const files = tournamentFiles(slug);
  if (!existsSync(files.no)) throw new ValidationError(`Fant ikke turneringen «${slug}».`);
  const { data } = readMd(files.no);
  const status = tournamentStatus(data.date);
  if (status === 'past') {
    return ok(
      `«${slug}» har dato ${data.date} og vises allerede som TIDLIGERE — ingen handling nødvendig. ` +
        'Status regnes alltid ut fra datoen ved bygg, så ingenting må arkiveres manuelt.',
      { slug, status },
    );
  }
  return ok(
    `«${slug}» har dato ${data.date} og er fortsatt KOMMENDE. ` +
      'Vil du flytte den til tidligere nå, endre datoen med update_tournament. ' +
      'Er datoen riktig men i fremtiden, skjer arkiveringen automatisk etter første bygg på eller etter den datoen.',
    { slug, status },
  );
}

export function registerTournamentTools(server) {
  server.registerTool(
    'list_tournaments',
    {
      title: 'List tournaments',
      description:
        'READ-ONLY. All tournaments with date, computed status (upcoming/past), registration-open flag, team rules, ITHF ranking level and live registration counts from D1.',
      inputSchema: {},
    },
    tool(listTournaments),
  );

  server.registerTool(
    'create_tournament',
    {
      title: 'Create tournament',
      description:
        'WRITES GIT (branch + PR). Creates a tournament page (Norwegian file + optional English mirror), regenerates the API tournament config, and opens a PR. The registration form appears automatically once merged and rebuilt.',
      inputSchema: {
        name: z.string().min(1).describe('Display name, e.g. "Norway Open 2027"'),
        slug: z.string().describe('URL slug, lowercase/digits/dashes/Nordic chars, e.g. "norway-open-2027"'),
        date: z.string().describe('Norwegian display date, e.g. "5. september 2027" or "1.–3. mai 2027"'),
        location: z.string().nullish().describe('Venue (leave null until announced)'),
        prices: z.string().nullish().describe('Semicolon-separated price lines'),
        playingSystem: z.string().nullish().describe('Playing system text'),
        playersPerTeam: z.number().int().min(1).nullish().describe('Exact number of highest-rated roster members whose points count'),
        maxSubstitutes: z.number().int().min(0).optional().describe('Maximum optional substitutes; default 0'),
        rankingLevel: z.enum(RANKING_LEVELS).nullish().describe('ITHF tournament level used to calculate placement points'),
        registrationQuestions: z.array(z.object({
          id: z.string(), labelNo: z.string(), labelEn: z.string(), required: z.boolean().optional(),
          options: z.array(z.object({ value: z.string(), labelNo: z.string(), labelEn: z.string() })).min(2),
        })).optional(),
        registrationOpen: z.boolean().optional().describe('Default true; false = registration closed from day one'),
        body: z.string().optional().describe('Markdown body (description + "# Tidsskjema" schedule)'),
        englishName: z.string().optional().describe('Set to also create the English mirror page'),
        englishBody: z.string().optional().describe('English markdown body ("# Schedule" heading)'),
      },
    },
    tool(createTournament),
  );

  server.registerTool(
    'update_tournament',
    {
      title: 'Update tournament details',
      description:
        'WRITES GIT (branch + PR). Patches tournament frontmatter (name/date/location/prices/playingSystem/status/registrationOpen/team rules/ranking level) without touching the body. Non-translatable fields are synced to the English mirror when it exists.',
      inputSchema: {
        slug: z.string(),
        name: z.string().optional(),
        date: z.string().optional().describe('Norwegian display date'),
        location: z.string().nullish(),
        prices: z.string().nullish(),
        playingSystem: z.string().nullish(),
        status: z.enum(['upcoming', 'past']).optional().describe('Hint only — display status is computed from date'),
        registrationOpen: z.boolean().optional(),
        playersPerTeam: z.number().int().min(1).nullish(),
        maxSubstitutes: z.number().int().min(0).optional(),
        rankingLevel: z.enum(RANKING_LEVELS).nullish(),
        registrationQuestions: z.array(z.object({
          id: z.string(), labelNo: z.string(), labelEn: z.string(), required: z.boolean().optional(),
          options: z.array(z.object({ value: z.string(), labelNo: z.string(), labelEn: z.string() })).min(2),
        })).optional(),
      },
    },
    tool(updateTournament),
  );

  server.registerTool(
    'duplicate_tournament',
    {
      title: 'Duplicate tournament',
      description:
        "WRITES GIT (branch + PR). Copies an existing tournament (e.g. last year's Norway Open) to a new slug/date — body included. Review the copied schedule/prices afterwards.",
      inputSchema: {
        sourceSlug: z.string(),
        newSlug: z.string(),
        newDate: z.string().describe('Norwegian display date for the copy'),
        newName: z.string().optional().describe('Defaults to the source name'),
        newEnglishName: z.string().optional(),
      },
    },
    tool(duplicateTournament),
  );

  server.registerTool(
    'close_registration',
    {
      title: 'Close registration',
      description:
        'WRITES LIVE D1 + GIT (branch + PR). Sets registrationOpen: false on a tournament (NO + EN mirror): the API closes immediately through D1 and the form is hidden after the pull request is merged and rebuilt.',
      inputSchema: {
        slug: z.string(),
      },
    },
    tool((args) => setRegistrationOpen(args.slug, false)),
  );

  server.registerTool(
    'open_registration',
    {
      title: 'Open registration',
      description:
        'WRITES LIVE D1 + GIT (branch + PR). Removes the runtime veto and sets registrationOpen: true: the form and API reopen after the pull request is merged and rebuilt, unless frontmatter remains closed.',
      inputSchema: {
        slug: z.string(),
      },
    },
    tool((args) => setRegistrationOpen(args.slug, true)),
  );

  server.registerTool(
    'archive_tournament',
    {
      title: 'Archive tournament (info)',
      description:
        'READ-ONLY. Tournaments archive themselves automatically once their date passes — this just reports the computed status and what (if anything) to do.',
      inputSchema: { slug: z.string() },
    },
    tool(archiveTournament),
  );
}
