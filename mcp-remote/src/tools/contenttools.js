/**
 * Content tools — tournaments, news posts, timers, årsmøte documents.
 * All reads/writes go through the GitHub API; commits go straight to main
 * (same model as the Sveltia CMS). Multi-file changes land in ONE commit.
 */
import { getTextFile, listFiles, commitFiles, toBase64, checkRuns, withGitSnapshot } from '../github.js';
import { parseMdText, patchMdText, createMdText } from '../lib/frontmatter.js';
import { tournamentStatus, parseNoDate } from '../lib/dates.js';
import {
  assertSlug, assertDateText, assertTeamRule, assertTournamentRankingLevel,
  RANKING_LEVELS, ValidationError,
} from '../lib/validate.js';

const TOURNAMENTS_DIR = 'src/content/tournaments';
const POSTS_DIR = 'src/content/posts';
const CONFIG_PATH = 'functions/lib/tournament-config.json';
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function endDateFor(dateText) {
  const date = parseNoDate(dateText);
  if (!date) throw new ValidationError(`Kan ikke tolke turneringsdatoen «${dateText}».`);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
    if (!slug || data.draft === true) continue;
    assertTeamRule(data.playersPerTeam ?? null, data.maxSubstitutes ?? 0);
    assertTournamentRankingLevel(data.playersPerTeam ?? null, data.rankingLevel ?? null);
    config[slug] = {
      date: data.date,
      endDate: endDateFor(data.date),
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
  env = await withGitSnapshot(env);
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
  if (fields.draft === true) {
    delete config[slug];
    return { path: CONFIG_PATH, text: JSON.stringify(config, null, 1) + '\n' };
  }
  const previous = config[slug] ?? {};
  const next = {
    ...previous,
    ...(fields.date !== undefined ? { date: fields.date } : {}),
    ...(fields.date !== undefined ? { endDate: endDateFor(fields.date) } : {}),
    ...(fields.playersPerTeam !== undefined ? { playersPerTeam: fields.playersPerTeam ?? null } : {}),
    ...(fields.maxSubstitutes !== undefined ? { maxSubstitutes: fields.maxSubstitutes ?? 0 } : {}),
    ...(fields.registrationQuestions !== undefined ? { registrationQuestions: fields.registrationQuestions ?? [] } : {}),
    ...(fields.rankingLevel !== undefined ? { rankingLevel: fields.rankingLevel ?? null } : {}),
  };
  if (!('playersPerTeam' in next)) next.playersPerTeam = null;
  if (!('maxSubstitutes' in next)) next.maxSubstitutes = 0;
  if (!('registrationQuestions' in next)) next.registrationQuestions = [];
  if (!('rankingLevel' in next)) next.rankingLevel = null;
  if (!('endDate' in next)) next.endDate = endDateFor(next.date);
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
  env = await withGitSnapshot(env);
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
  env = await withGitSnapshot(env);
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
  env = await withGitSnapshot(env);
  const { no, en } = await readTournament(env, slug);
  const files = [{ path: `${TOURNAMENTS_DIR}/${slug}.md`, text: patchMdText(no, { registrationOpen: open }).text }];
  if (en) {
    files.push({ path: `${TOURNAMENTS_DIR}/en/${slug}.md`, text: patchMdText(en, { registrationOpen: open }).text });
  }
  files.push(await regenerateConfigPreview(env, slug, { registrationOpen: open }));
  // The fail-closed runtime control is applied before the slower GitHub flow.
  // If a concurrent content edit makes the commit conflict, the requested
  // safety state still takes effect and the user can retry the content sync.
  if (open) {
    await env.DB.prepare('DELETE FROM tournament_settings WHERE tournament_slug = ?').bind(slug).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tournament_settings (tournament_slug, registration_open, updated_at)
       VALUES (?, 0, datetime('now'))
       ON CONFLICT(tournament_slug) DO UPDATE SET
         registration_open = 0,
         updated_at = excluded.updated_at`,
    ).bind(slug).run();
  }
  const { commitSha, url } = await commitFiles(env, {
    message: `feat(tournaments): ${open ? 'open' : 'close'} registration for ${slug} (via remote MCP)`,
    files,
  });
  return [
    `Påmelding for ${slug} er ${open ? 'satt til ÅPEN ved neste bygg' : 'STENGT i API-et med én gang'} (${commitSha}: ${url}). ` +
      'Skjemaet synkroniseres ved neste bygg.',
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

function isForbiddenIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Validate every initial/redirect URL before the Worker is allowed to fetch it. */
export function validateDownloadUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new ValidationError('Filadressen er ugyldig.');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Filadressen må bruke HTTPS.');
  if (url.username || url.password) throw new ValidationError('Filadressen kan ikke inneholde brukernavn eller passord.');
  if (url.hash) throw new ValidationError('Filadressen kan ikke inneholde et fragment (#).');
  if (url.port && url.port !== '443') throw new ValidationError('Filadressen kan ikke bruke en egendefinert port.');
  if (url.href.length > 2_048) throw new ValidationError('Filadressen er for lang.');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !host.includes('.') || host.includes(':') || isForbiddenIpv4(host) ||
    ['localhost', 'localhost.localdomain'].includes(host) ||
    ['.localhost', '.local', '.internal', '.home.arpa'].some((suffix) => host.endsWith(suffix))
  ) {
    throw new ValidationError('Filadressen peker til et lokalt eller privat nettverk.');
  }
  return url;
}

/** Decode one URL path segment into a safe, portable repository filename. */
export function fileNameFromUrl(input, allowedExtensions) {
  const url = validateDownloadUrl(input);
  const encoded = url.pathname.split('/').pop();
  let name;
  try {
    name = decodeURIComponent(encoded ?? '').normalize('NFC');
  } catch {
    throw new ValidationError('Filnavnet i adressen er ugyldig kodet.');
  }
  if (
    !name || name.length > 180 || name === '.' || name === '..' ||
    name.startsWith('.') || /[\\/\u0000-\u001f\u007f]/u.test(name) ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._()'-]*$/u.test(name)
  ) {
    throw new ValidationError('Filnavnet i adressen inneholder tegn som ikke er tillatt.');
  }
  const extension = name.match(/\.([^.]+)$/u)?.[1].toLowerCase();
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new ValidationError(`Filen må være ${allowedExtensions.join('/')}.`);
  }
  return { url, name, extension };
}

const startsWithBytes = (bytes, signature) =>
  bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

/** Extension and file content must agree; HTTP Content-Type alone is not trusted. */
export function hasExpectedFileSignature(bytes, extension) {
  if (extension === 'jpg' || extension === 'jpeg') return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (extension === 'png') return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === 'webp') return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  if (extension === 'avif') {
    return bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp' && /avif|avis/u.test(ascii(bytes, 8, Math.min(bytes.length, 64)));
  }
  if (extension === 'mp3') {
    return startsWithBytes(bytes, [0x49, 0x44, 0x33]) ||
      (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0);
  }
  if (extension === 'pdf') return ascii(bytes, 0, Math.min(bytes.length, 5)) === '%PDF-';
  return false;
}

async function readLimitedBody(res, what) {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    await res.body?.cancel();
    throw new ValidationError(`${what} er for stor (maks 10 MB).`);
  }
  if (!res.body) throw new ValidationError(`${what} er tom.`);
  const reader = res.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new ValidationError(`${what} er for stor (maks 10 MB).`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchBinary(input, what, expectedExtension) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let url = validateDownloadUrl(input);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('Location');
        await res.body?.cancel();
        if (!location) throw new ValidationError(`Nedlasting av ${what} fikk en ugyldig omdirigering.`);
        if (redirects === MAX_REDIRECTS) throw new ValidationError(`Nedlasting av ${what} har for mange omdirigeringer.`);
        url = validateDownloadUrl(new URL(location, url));
        continue;
      }
      if (!res.ok) throw new ValidationError(`Nedlasting av ${what} feilet (HTTP ${res.status}).`);
      const bytes = await readLimitedBody(res, what);
      if (!hasExpectedFileSignature(bytes, expectedExtension)) {
        throw new ValidationError(`${what} har ikke gyldig ${expectedExtension.toUpperCase()}-innhold.`);
      }
      return bytes;
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error?.name === 'AbortError') throw new ValidationError(`Nedlasting av ${what} tok for lang tid.`);
    throw new ValidationError(`Kunne ikke laste ned ${what}.`);
  } finally {
    clearTimeout(timer);
  }
  throw new ValidationError(`Kunne ikke laste ned ${what}.`);
}

export async function assertMediaPathsAvailable(env, candidatePaths) {
  const existing = await listFiles(env);
  const byKey = new Map(existing.map((path) => [path.normalize('NFC').toLocaleLowerCase('en-US'), path]));
  for (const path of candidatePaths) {
    const collision = byKey.get(path.normalize('NFC').toLocaleLowerCase('en-US'));
    if (collision) throw new ValidationError(`Mediefilen finnes allerede som «${collision}». Velg et annet filnavn.`);
  }
}

async function createNewsPost(env, args) {
  const { title, slug, author } = args;
  assertSlug(slug);
  env = await withGitSnapshot(env);
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
    const media = fileNameFromUrl(args.coverFileUrl, ['jpg', 'jpeg', 'png', 'webp', 'avif']);
    await assertMediaPathsAvailable(env, [
      `media-uploads/images/${media.name}`,
      `media-originals/images/${media.name}`,
      `public/media/images/${media.name}`,
    ]);
    const bytes = await fetchBinary(media.url, 'forsidebildet', media.extension);
    files.push({ path: `media-uploads/images/${media.name}`, base64: toBase64(bytes) });
    cover = `/media/images/${media.name}`;
  }

  const pubDate = args.pubDate ?? new Date().toISOString();
  files.push({
    path: noPath,
    text: createMdText({
      title, slug, lang: 'no', author, pubDate,
      categories: args.categories ?? [],
      ...(cover ? { cover } : {}),
      description: args.description ?? null,
    }, args.body),
  });

  if (en) {
    files.push({
      path: `${POSTS_DIR}/en/${en.slug}.md`,
      text: createMdText({
        title: en.title, slug: en.slug, lang: 'en', author, pubDate,
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
  const media = fileNameFromUrl(args.fileUrl, [isTimer ? 'mp3' : 'pdf']);
  env = await withGitSnapshot(env);
  const destination = isTimer ? `public/media/audio/${media.name}` : `public/media/pdf/${media.name}`;
  await assertMediaPathsAvailable(env, [destination]);
  const bytes = await fetchBinary(media.url, 'filen', media.extension);

  const jsonPath = isTimer ? 'src/data/timers.json' : 'src/data/documents.json';
  const raw = await getTextFile(env, jsonPath);
  const items = JSON.parse(raw);
  const entry = isTimer
    ? { title: args.title, file: `/media/audio/${media.name}`, ...(args.durationHint ? { duration_hint: args.durationHint } : {}) }
    : { title: args.title, year: args.year, file: `/media/pdf/${media.name}`, page: '/årsmøter' };
  if (isTimer) items.push(entry);
  else items.unshift(entry); // newest first
  const indent = raw.match(/\n(\s+)"/)?.[1].length ?? 2;

  const files = [
    { path: destination, base64: toBase64(bytes) },
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
        author: { type: 'string', minLength: 1, description: 'Author display name' },
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
      required: ['title', 'slug', 'author', 'body'],
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
