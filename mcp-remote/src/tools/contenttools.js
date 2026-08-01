/**
 * Content tools — tournaments, news posts, timers, årsmøte documents.
 * All reads/writes go through the GitHub API; commits go straight to main
 * (same model as the Sveltia CMS). Multi-file changes land in ONE commit.
 */
import { getTextFile, listFiles, commitFiles, toBase64, checkRuns } from '../github.js';
import { parseMdText, patchMdText, createMdText } from '../lib/frontmatter.js';
import { tournamentStatus, parseNoDate } from '../lib/dates.js';
import {
  assertSlug, assertDateText, assertTeamRule, assertTournamentRankingLevel,
  RANKING_LEVELS, ValidationError,
} from '../lib/validate.js';

const TOURNAMENTS_DIR = 'src/content/tournaments';
const POSTS_DIR = 'src/content/posts';
const CONFIG_PATH = 'functions/lib/tournament-config.json';

/**
 * Regenerate functions/lib/tournament-config.json from the tournament
 * frontmatter on GitHub (port of scripts/gen-tournament-config.mjs — the
 * API reads the committed file, so every tournament write must include it).
 */
async function regenerateConfig(env) {
  const files = (await listFiles(env)).filter(
    (p) => p.startsWith(`${TOURNAMENTS_DIR}/`) && p.endsWith('.md') && !p.includes('/en/'),
  );
  const config = {};
  for (const path of files) {
    const raw = await getTextFile(env, path);
    if (!raw) continue;
    const { data } = parseMdText(raw);
    const slug = data.slug;
    if (!slug) continue;
    assertTeamRule(data.playersPerTeam ?? null, data.maxSubstitutes ?? 0);
    assertTournamentRankingLevel(data.playersPerTeam ?? null, data.rankingLevel ?? null);
    config[slug] = {
      date: data.date,
      playersPerTeam: data.playersPerTeam ?? null,
      maxSubstitutes: data.maxSubstitutes ?? 0,
      registrationQuestions: data.registrationQuestions ?? [],
      rankingLevel: data.rankingLevel ?? null,
      ...(data.registrationOpen === false ? { registrationOpen: false } : {}),
    };
  }
  return { path: CONFIG_PATH, text: JSON.stringify(config, null, 1) + '\n' };
}

async function tournamentFileExists(env, slug) {
  return (await getTextFile(env, `${TOURNAMENTS_DIR}/${slug}.md`)) != null;
}

async function readTournament(env, slug) {
  const raw = await getTextFile(env, `${TOURNAMENTS_DIR}/${slug}.md`);
  if (!raw) throw new ValidationError(`Fant ikke turneringen «${slug}».`);
  const en = await getTextFile(env, `${TOURNAMENTS_DIR}/en/${slug}.md`);
  return { no: raw, en };
}

async function listTournaments(env) {
  const paths = (await listFiles(env)).filter(
    (p) => p.startsWith(`${TOURNAMENTS_DIR}/`) && p.endsWith('.md') && !p.includes('/en/'),
  );
  const entries = [];
  for (const path of paths) {
    const { data } = parseMdText(await getTextFile(env, path));
    if (!data.slug || data.lang === 'en') continue;
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

  let countsNote;
  try {
    const { results } = await env.DB.prepare(
      'SELECT tournament_slug, COUNT(*) AS n FROM registrations GROUP BY tournament_slug',
    ).all();
    const counts = Object.fromEntries(results.map((r) => [r.tournament_slug, r.n]));
    for (const e of entries) e.registrations = counts[e.slug] ?? 0;
  } catch (err) {
    countsNote = ` (live-telling utilgjengelig: ${err.message})`;
  }
  return [`${entries.length} turneringer${countsNote ?? ' (med live påmeldingstall)'}.`, entries];
}

async function createTournament(env, args) {
  const { name, slug, date } = args;
  assertSlug(slug);
  assertDateText(date, parseNoDate);
  assertTeamRule(args.playersPerTeam ?? null, args.maxSubstitutes ?? 0);
  assertTournamentRankingLevel(args.playersPerTeam ?? null, args.rankingLevel ?? null);
  if (await tournamentFileExists(env, slug)) {
    throw new ValidationError(`Turneringen «${slug}» finnes allerede.`);
  }

  const fields = {
    name, slug, date,
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
  const files = [{
    path: `${TOURNAMENTS_DIR}/${slug}.md`,
    text: createMdText(fields, args.body ?? 'Beskrivelse kommer.\n\n# Tidsskjema\n\n**10:00** Dørene åpner\n'),
  }];
  if (args.englishName) {
    files.push({
      path: `${TOURNAMENTS_DIR}/en/${slug}.md`,
      text: createMdText({ ...fields, name: args.englishName, lang: 'en' },
        args.englishBody ?? 'Description coming.\n\n# Schedule\n\n**10:00** Doors open\n'),
    });
  }

  const cfgEntry = await regenerateConfigPreview(env, slug, fields);
  files.push(cfgEntry);

  const { commitSha, url } = await commitFiles(env, { message: `feat(tournaments): add ${slug} (via remote MCP)`, files });
  return [
    `Turnering opprettet: ${name} (${slug}), committet til main (${commitSha}: ${url}). ` +
      'Siden bygges på nytt automatisk; turneringen dukker da opp under /turneringer med påmeldingsskjema.',
    { files: files.map((f) => f.path), commit: url },
  ];
}

/** Config JSON updated with one new/changed entry (without re-reading everything). */
export async function regenerateConfigPreview(env, slug, fields) {
  const raw = await getTextFile(env, CONFIG_PATH);
  const config = raw ? JSON.parse(raw) : {};
  const previous = config[slug] ?? {};
  const next = {
    ...previous,
    ...(fields.date !== undefined ? { date: fields.date } : {}),
    ...(fields.playersPerTeam !== undefined ? { playersPerTeam: fields.playersPerTeam ?? null } : {}),
    ...(fields.maxSubstitutes !== undefined ? { maxSubstitutes: fields.maxSubstitutes ?? 0 } : {}),
    ...(fields.registrationQuestions !== undefined ? { registrationQuestions: fields.registrationQuestions ?? [] } : {}),
    ...(fields.rankingLevel !== undefined ? { rankingLevel: fields.rankingLevel ?? null } : {}),
  };
  if (!('playersPerTeam' in next)) next.playersPerTeam = null;
  if (!('maxSubstitutes' in next)) next.maxSubstitutes = 0;
  if (!('registrationQuestions' in next)) next.registrationQuestions = [];
  if (!('rankingLevel' in next)) next.rankingLevel = null;
  assertTeamRule(next.playersPerTeam, next.maxSubstitutes);
  assertTournamentRankingLevel(next.playersPerTeam, next.rankingLevel);
  if (fields.registrationOpen === false) next.registrationOpen = false;
  else if (fields.registrationOpen === true) delete next.registrationOpen;
  config[slug] = next;
  return { path: CONFIG_PATH, text: JSON.stringify(config, null, 1) + '\n' };
}

export const TOURNAMENT_PATCHABLE = ['name', 'date', 'location', 'prices', 'playingSystem', 'status', 'registrationOpen', 'playersPerTeam', 'maxSubstitutes', 'registrationQuestions', 'rankingLevel'];
export const TOURNAMENT_SYNC_TO_EN = ['date', 'location', 'status', 'registrationOpen', 'playersPerTeam', 'maxSubstitutes', 'registrationQuestions', 'rankingLevel'];

async function updateTournament(env, args) {
  const { slug, ...patch } = args;
  assertSlug(slug);
  const clean = {};
  for (const key of TOURNAMENT_PATCHABLE) if (patch[key] !== undefined) clean[key] = patch[key];
  if (Object.keys(clean).length === 0) throw new ValidationError('Ingen felt å oppdatere.');
  if (clean.date !== undefined) assertDateText(clean.date, parseNoDate);

  const { no, en } = await readTournament(env, slug);
  const current = parseMdText(no).data;
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

  const { text: newNo, before } = patchMdText(no, clean);
  const files = [{ path: `${TOURNAMENTS_DIR}/${slug}.md`, text: newNo }];
  let enSynced = false;
  if (en) {
    const enPatch = {};
    for (const key of TOURNAMENT_SYNC_TO_EN) if (clean[key] !== undefined) enPatch[key] = clean[key];
    if (Object.keys(enPatch).length) {
      files.push({ path: `${TOURNAMENTS_DIR}/en/${slug}.md`, text: patchMdText(en, enPatch).text });
      enSynced = true;
    }
  }
  files.push(await regenerateConfigPreview(env, slug, { ...parseMdText(newNo).data }));

  const { commitSha, url } = await commitFiles(env, {
    message: `feat(tournaments): update ${slug} (${Object.keys(clean).join(', ')}) (via remote MCP)`,
    files,
  });
  return [
    `Oppdaterte ${slug}: ${Object.keys(clean).join(', ')} — committet til main (${commitSha}: ${url}).`,
    { before, after: clean, enMirrorSynced: enSynced, commit: url },
  ];
}

async function duplicateTournament(env, args) {
  const { sourceSlug, newSlug, newDate } = args;
  assertSlug(newSlug, 'ny slug');
  assertDateText(newDate, parseNoDate);
  if (!(await tournamentFileExists(env, sourceSlug))) {
    throw new ValidationError(`Fant ikke kildeturneringen «${sourceSlug}».`);
  }
  if (await tournamentFileExists(env, newSlug)) {
    throw new ValidationError(`«${newSlug}» finnes allerede.`);
  }

  const { no, en } = await readTournament(env, sourceSlug);
  const src = parseMdText(no);
  assertTeamRule(src.data.playersPerTeam ?? null, src.data.maxSubstitutes ?? 0);
  assertTournamentRankingLevel(src.data.playersPerTeam ?? null, src.data.rankingLevel ?? null);
  const newFields = {
    ...src.data,
    name: args.newName ?? src.data.name,
    slug: newSlug,
    date: newDate,
    status: 'upcoming',
  };
  const files = [{
    path: `${TOURNAMENTS_DIR}/${newSlug}.md`,
    text: createMdText(newFields, src.body),
  }];
  if (en) {
    const enSrc = parseMdText(en);
    files.push({
      path: `${TOURNAMENTS_DIR}/en/${newSlug}.md`,
      text: createMdText({ ...enSrc.data, name: args.newEnglishName ?? enSrc.data.name, slug: newSlug, lang: 'en', date: newDate, status: 'upcoming', rankingLevel: newFields.rankingLevel ?? null }, enSrc.body),
    });
  }
  files.push(await regenerateConfigPreview(env, newSlug, newFields));

  const { commitSha, url } = await commitFiles(env, {
    message: `feat(tournaments): add ${newSlug} (copy of ${sourceSlug}) (via remote MCP)`,
    files,
  });
  return [
    `Kopierte ${sourceSlug} → ${newSlug} (${commitSha}: ${url}). Husk å gjennomgå innholdet (tidsskjema, priser) før publisering.`,
    { files: files.map((f) => f.path), commit: url },
  ];
}

async function setRegistrationOpen(env, slug, open) {
  assertSlug(slug);
  const { no, en } = await readTournament(env, slug);
  const files = [{ path: `${TOURNAMENTS_DIR}/${slug}.md`, text: patchMdText(no, { registrationOpen: open }).text }];
  if (en) {
    files.push({ path: `${TOURNAMENTS_DIR}/en/${slug}.md`, text: patchMdText(en, { registrationOpen: open }).text });
  }
  files.push(await regenerateConfigPreview(env, slug, { registrationOpen: open }));
  const { commitSha, url } = await commitFiles(env, {
    message: `feat(tournaments): ${open ? 'open' : 'close'} registration for ${slug} (via remote MCP)`,
    files,
  });
  return [
    `Påmelding for ${slug} er nå ${open ? 'ÅPEN' : 'STENGT'} (${commitSha}: ${url}). ` +
      'Skjemaet skjules/vises og API-et godtar/avviser nye påmeldinger etter neste bygg (2–4 min).',
    { slug, registrationOpen: open, commit: url },
  ];
}

async function archiveTournament(_env, args) {
  const { data } = parseMdText(await readTournament(_env, args.slug).then((r) => r.no));
  const status = tournamentStatus(data.date);
  if (status === 'past') {
    return [
      `«${args.slug}» har dato ${data.date} og vises allerede som TIDLIGERE — ingen handling nødvendig. Status regnes ut fra datoen ved bygg.`,
      { slug: args.slug, status },
    ];
  }
  return [
    `«${args.slug}» har dato ${data.date} og er fortsatt KOMMENDE. Vil du flytte den til tidligere nå, endre datoen med update_tournament. Er datoen riktig, skjer arkiveringen automatisk etter første bygg på eller etter den datoen.`,
    { slug: args.slug, status },
  ];
}

async function fetchBinary(url, what = 'filen') {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new ValidationError(`Kunne ikke laste ned ${what}: ${err.message}`);
  }
  if (!res.ok) throw new ValidationError(`Nedlasting av ${what} feilet (HTTP ${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new ValidationError(`${what} er for stor (maks 10 MB).`);
  return buf;
}

async function createNewsPost(env, args) {
  const { title, slug } = args;
  assertSlug(slug);
  const noPath = `${POSTS_DIR}/${slug}.md`;
  if (await getTextFile(env, noPath)) throw new ValidationError(`Innlegget «${slug}» finnes allerede.`);
  const en = args.englishMirror;
  if (en) {
    assertSlug(en.slug, 'engelsk slug');
    if (await getTextFile(env, `${POSTS_DIR}/en/${en.slug}.md`)) {
      throw new ValidationError(`Det engelske innlegget «${en.slug}» finnes allerede.`);
    }
  }

  const files = [];
  let cover;
  if (args.coverFileUrl) {
    const urlPath = new URL(args.coverFileUrl).pathname;
    const base = urlPath.split('/').pop();
    if (!/\.(jpe?g|png|webp|avif)$/i.test(base)) {
      throw new ValidationError('Forsidebildet må være jpg/png/webp/avif (sjekk URL-en).');
    }
    const bytes = await fetchBinary(args.coverFileUrl, 'forsidebildet');
    files.push({ path: `media-originals/images/${base}`, base64: toBase64(bytes) });
    cover = `/media/images/${base}`;
  }

  const pubDate = args.pubDate ?? new Date().toISOString();
  files.push({
    path: noPath,
    text: createMdText({
      title, slug, lang: 'no', pubDate,
      categories: args.categories ?? [],
      ...(cover ? { cover } : {}),
      description: args.description ?? null,
    }, args.body),
  });

  if (en) {
    files.push({
      path: `${POSTS_DIR}/en/${en.slug}.md`,
      text: createMdText({
        title: en.title, slug: en.slug, lang: 'en', pubDate,
        categories: args.categories ?? [],
        ...(cover ? { cover } : {}),
        description: en.description ?? null,
      }, en.body),
    });
    const i18n = await getTextFile(env, 'src/lib/i18n.ts');
    const marker = 'export const postMirrorsNoToEn: Record<string, string> = {';
    if (!i18n.includes(marker)) throw new Error('Fant ikke postMirrorsNoToEn i src/lib/i18n.ts');
    if (i18n.includes(`'${slug}':`)) throw new ValidationError(`postMirrorsNoToEn har allerede en oppføring for «${slug}».`);
    files.push({ path: 'src/lib/i18n.ts', text: i18n.replace(marker, `${marker}\n  '${slug}': '${en.slug}',`) });
  }

  const { commitSha, url } = await commitFiles(env, { message: `content(posts): add ${slug} (via remote MCP)`, files });
  return [
    `Nyhetsinnlegg opprettet: «${title}» (${slug})${en ? ' + engelsk versjon' : ''} — committet til main (${commitSha}: ${url}).` +
      (cover ? ' Forsidebildet optimaliseres automatisk ved bygg.' : ''),
    { files: files.map((f) => f.path), commit: url },
  ];
}

async function addMediaDocument(env, args, kind) {
  const isTimer = kind === 'timer';
  const urlPath = new URL(args.fileUrl).pathname;
  const base = decodeURIComponent(urlPath.split('/').pop());
  const extOk = isTimer ? /\.mp3$/i.test(base) : /\.pdf$/i.test(base);
  if (!extOk) throw new ValidationError(isTimer ? 'Kun MP3-filer støttes (sjekk URL-en).' : 'Kun PDF-filer støttes (sjekk URL-en).');
  const bytes = await fetchBinary(args.fileUrl, 'filen');

  const jsonPath = isTimer ? 'src/data/timers.json' : 'src/data/documents.json';
  const raw = await getTextFile(env, jsonPath);
  const items = JSON.parse(raw);
  const entry = isTimer
    ? { title: args.title, file: `/media/audio/${base}`, ...(args.durationHint ? { duration_hint: args.durationHint } : {}) }
    : { title: args.title, year: args.year, file: `/media/pdf/${base}`, page: '/årsmøter' };
  if (isTimer) items.push(entry);
  else items.unshift(entry); // newest first
  const indent = raw.match(/\n(\s+)"/)?.[1].length ?? 2;

  const files = [
    { path: isTimer ? `public/media/audio/${base}` : `public/media/pdf/${base}`, base64: toBase64(bytes) },
    { path: jsonPath, text: JSON.stringify(items, null, indent) + '\n' },
  ];
  const { commitSha, url } = await commitFiles(env, {
    message: `content(data): add ${isTimer ? 'timer' : 'årsmøte document'} "${args.title}" (via remote MCP)`,
    files,
  });
  return [
    `«${args.title}» lagt til (${commitSha}: ${url}).`,
    { entry, commit: url },
  ];
}

async function deployStatus(env, args) {
  const json = await checkRuns(env, args.ref ?? 'main');
  const runs = json.check_runs ?? [];
  const pagesRuns = runs.filter((r) => /pages|cloudflare/i.test(r.name));
  const pick = (pagesRuns.length ? pagesRuns : runs).slice(0, 5).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    startedAt: r.started_at,
    url: r.html_url,
  }));
  if (pick.length === 0) {
    return ['Fant ingen check runs — sjekk Cloudflare-dashbordet (Workers & Pages → puck-no → Deployments).', []];
  }
  const latest = pick[0];
  return [
    `Siste bygg (${latest.name}): ${latest.status}${latest.conclusion ? ` / ${latest.conclusion}` : ''} — ${latest.url}`,
    pick,
  ];
}

export const contentTools = [
  {
    name: 'list_tournaments',
    title: 'List tournaments',
    description: 'READ-ONLY. All tournaments with date, computed status, registration-open flag, team rules, ITHF ranking level and live registration counts.',
    inputSchema: { type: 'object', properties: {} },
    run: listTournaments,
  },
  {
    name: 'create_tournament',
    title: 'Create tournament',
    description:
      'WRITES GIT (commit to main). Creates a tournament page (Norwegian + optional English mirror) and updates the API tournament config. The registration form appears after the rebuild (~2-4 min).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        date: { type: 'string', description: 'Norwegian display date, e.g. "5. september 2027"' },
        location: { type: 'string' },
        prices: { type: 'string' },
        playingSystem: { type: 'string' },
        playersPerTeam: { type: 'integer', minimum: 1 },
        maxSubstitutes: { type: 'integer', minimum: 0 },
        rankingLevel: { enum: [null, ...RANKING_LEVELS], description: 'ITHF tournament level used to calculate placement points' },
        registrationQuestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, labelNo: { type: 'string' }, labelEn: { type: 'string' }, required: { type: 'boolean' },
              options: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, labelNo: { type: 'string' }, labelEn: { type: 'string' } }, required: ['value', 'labelNo', 'labelEn'] } },
            },
            required: ['id', 'labelNo', 'labelEn', 'options'],
          },
        },
        registrationOpen: { type: 'boolean' },
        body: { type: 'string' },
        englishName: { type: 'string', description: 'Set to also create the English mirror' },
        englishBody: { type: 'string' },
      },
      required: ['name', 'slug', 'date'],
    },
    run: createTournament,
  },
  {
    name: 'update_tournament',
    title: 'Update tournament details',
    description:
      'WRITES GIT (commit to main). Patches tournament frontmatter (name/date/location/prices/playingSystem/status/registrationOpen/team rules/ranking level) without touching the body. Non-translatable fields sync to the EN mirror.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        date: { type: 'string' },
        location: { type: 'string' },
        prices: { type: 'string' },
        playingSystem: { type: 'string' },
        status: { type: 'string', enum: ['upcoming', 'past'] },
        registrationOpen: { type: 'boolean' },
        playersPerTeam: { type: 'integer', minimum: 1 },
        maxSubstitutes: { type: 'integer', minimum: 0 },
        rankingLevel: { enum: [null, ...RANKING_LEVELS] },
        registrationQuestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, labelNo: { type: 'string' }, labelEn: { type: 'string' }, required: { type: 'boolean' },
              options: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, labelNo: { type: 'string' }, labelEn: { type: 'string' } }, required: ['value', 'labelNo', 'labelEn'] } },
            },
            required: ['id', 'labelNo', 'labelEn', 'options'],
          },
        },
      },
      required: ['slug'],
    },
    run: updateTournament,
  },
  {
    name: 'duplicate_tournament',
    title: 'Duplicate tournament',
    description: "WRITES GIT (commit to main). Copies an existing tournament (e.g. last year's Norway Open) to a new slug/date — body included.",
    inputSchema: {
      type: 'object',
      properties: {
        sourceSlug: { type: 'string' },
        newSlug: { type: 'string' },
        newDate: { type: 'string' },
        newName: { type: 'string' },
        newEnglishName: { type: 'string' },
      },
      required: ['sourceSlug', 'newSlug', 'newDate'],
    },
    run: duplicateTournament,
  },
  {
    name: 'close_registration',
    title: 'Close registration',
    description: 'WRITES GIT (commit to main). Sets registrationOpen: false (NO + EN): the form is hidden and the API rejects new registrations after the rebuild.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
    run: (env, args) => setRegistrationOpen(env, args.slug, false),
  },
  {
    name: 'open_registration',
    title: 'Open registration',
    description: 'WRITES GIT (commit to main). Sets registrationOpen: true (NO + EN): the form reappears and the API accepts registrations after the rebuild.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
    run: (env, args) => setRegistrationOpen(env, args.slug, true),
  },
  {
    name: 'archive_tournament',
    title: 'Archive tournament (info)',
    description: 'READ-ONLY. Tournaments archive themselves automatically once their date passes — reports the computed status and what (if anything) to do.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
    run: archiveTournament,
  },
  {
    name: 'create_news_post',
    title: 'Create news post',
    description:
      'WRITES GIT (commit to main). Creates a news post (Norwegian + optional English mirror with hreflang pair). Optional cover image fetched from a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        slug: { type: 'string' },
        pubDate: { type: 'string', description: 'ISO datetime (default: now)' },
        categories: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        description: { type: 'string' },
        coverFileUrl: { type: 'string', description: 'Direct URL to a cover image (jpg/png/webp/avif)' },
        englishMirror: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['slug', 'title', 'body'],
        },
      },
      required: ['title', 'slug', 'body'],
    },
    run: createNewsPost,
  },
  {
    name: 'add_timer',
    title: 'Add timer (MP3)',
    description: 'WRITES GIT (commit to main). Fetches an MP3 from a URL into public/media/audio and adds a row to src/data/timers.json.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        fileUrl: { type: 'string', description: 'Direct URL to the MP3' },
        durationHint: { type: 'string', description: 'e.g. "05:38"' },
      },
      required: ['title', 'fileUrl'],
    },
    run: (env, args) => addMediaDocument(env, args, 'timer'),
  },
  {
    name: 'add_arsmote_document',
    title: 'Add årsmøte document (PDF)',
    description: 'WRITES GIT (commit to main). Fetches a PDF from a URL into public/media/pdf and adds a row to src/data/documents.json.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        year: { type: 'integer' },
        fileUrl: { type: 'string', description: 'Direct URL to the PDF' },
      },
      required: ['title', 'year', 'fileUrl'],
    },
    run: (env, args) => addMediaDocument(env, args, 'arsmote'),
  },
  {
    name: 'deploy_status',
    title: 'Deployment status',
    description: 'READ-ONLY. Latest Cloudflare Pages build status for main (via GitHub check runs).',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Branch/SHA (default: main)' } },
    },
    run: deployStatus,
  },
];
