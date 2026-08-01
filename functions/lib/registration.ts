/// <reference types="@cloudflare/workers-types" />

import type { RegistrationQuestion, TournamentConfig } from './tournaments';
import {
  canonicalNameKey,
  fetchRanking,
  rankedRosterPlayer,
  seedTeam,
  unrankedRosterPlayer,
  type RosterPlayer,
} from './ranking';
import { isPastTournamentDate } from './tournament-date';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{0,29}$/;
const MAX = { name: 500, email: 254, phone: 30 } as const;

export interface SubmittedPlayer {
  playerId?: unknown;
  name?: unknown;
}

export interface RegistrationPayload {
  type?: unknown;
  player?: unknown;
  players?: unknown;
  name?: unknown;
  names?: unknown;
  playerId?: unknown;
  playerIds?: unknown;
  email?: unknown;
  phone?: unknown;
  answers?: unknown;
}

export interface AnswerSnapshot {
  questionId: string;
  questionLabelNo: string;
  questionLabelEn: string;
  value: string;
  labelNo: string;
  labelEn: string;
}

interface ResolvedRegistration {
  type: 'player' | 'team';
  name: string;
  country: string | null;
  club: string | null;
  worldRanking: number | null;
  rankingPoints: number;
  rankingValue: number;
  playerId: number | null;
  playerIds: number[];
  roster: RosterPlayer[] | null;
}

interface RegistrationRow extends Record<string, unknown> {
  id: number;
  tournament_slug: string;
  type: 'player' | 'team';
  name: string;
  country: string | null;
  club: string | null;
  email: string;
  phone: string | null;
  world_ranking: number | null;
  ranking_points: number | null;
  ranking_value: number | null;
  player_id: number | null;
  player_ids: string | null;
  roster: string | null;
  answers: string | null;
}

export class RegistrationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function asId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function normalizeContact(emailValue: unknown, phoneValue: unknown): { email: string; phone: string | null } {
  if (
    typeof emailValue !== 'string' ||
    emailValue.length > MAX.email ||
    !EMAIL_RE.test(emailValue.trim())
  ) {
    throw new RegistrationError('Ugyldig e-postadresse.');
  }
  if (phoneValue != null && phoneValue !== '') {
    if (
      typeof phoneValue !== 'string' ||
      phoneValue.length > MAX.phone ||
      !PHONE_RE.test(phoneValue.trim())
    ) {
      throw new RegistrationError('Ugyldig telefonnummer.');
    }
  }
  return {
    email: emailValue.trim().toLowerCase(),
    phone: typeof phoneValue === 'string' && phoneValue.trim() ? phoneValue.trim() : null,
  };
}

function submittedPlayers(body: RegistrationPayload, isTeam: boolean): SubmittedPlayer[] {
  if (isTeam) {
    if (Array.isArray(body.players)) return body.players as SubmittedPlayer[];
    if (Array.isArray(body.playerIds)) return body.playerIds.map((playerId) => ({ playerId }));
    if (Array.isArray(body.names)) return body.names.map((name) => ({ name }));
    throw new RegistrationError('Ugyldig lagregistrering.');
  }
  if (body.player && typeof body.player === 'object') return [body.player as SubmittedPlayer];
  return [{ playerId: body.playerId, name: body.name }];
}

async function resolveDetails(cfg: TournamentConfig, body: RegistrationPayload): Promise<ResolvedRegistration> {
  const isTeam = cfg.playersPerTeam != null;
  const expectedType = isTeam ? 'team' : 'player';
  if (body.type != null && body.type !== expectedType) {
    throw new RegistrationError(isTeam ? 'Denne turneringen er en lagturnering.' : 'Denne turneringen er individuell.');
  }
  const submitted = submittedPlayers(body, isTeam);
  if (isTeam) {
    const min = cfg.playersPerTeam!;
    const max = min + cfg.maxSubstitutes;
    if (submitted.length < min || submitted.length > max) {
      throw new RegistrationError(
        max === min
          ? `Laget må ha nøyaktig ${min} spillere.`
          : `Laget må ha mellom ${min} og ${max} spillere.`,
      );
    }
  } else if (submitted.length !== 1) {
    throw new RegistrationError('Ugyldig registrering.');
  }

  const normalized = submitted.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new RegistrationError('Ugyldig spiller.');
    const id = asId(entry.playerId);
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
    if ((id == null) === !rawName) {
      throw new RegistrationError('Oppgi enten spiller fra verdensrankingen eller navn på en urangert spiller.');
    }
    if (rawName.length > MAX.name) throw new RegistrationError('Spillernavnet er for langt.');
    return { id, name: rawName };
  });

  const ids = normalized.flatMap((entry) => (entry.id == null ? [] : [entry.id]));
  if (new Set(ids).size !== ids.length) {
    throw new RegistrationError('En spiller kan ikke velges flere ganger i samme lag.');
  }
  const freeNames = normalized.filter((entry) => entry.id == null).map((entry) => canonicalNameKey(entry.name));
  if (new Set(freeNames).size !== freeNames.length) {
    throw new RegistrationError('En spiller kan ikke føres opp flere ganger i samme lag.');
  }

  let ranking: Awaited<ReturnType<typeof fetchRanking>> | null = null;
  if (ids.length > 0) {
    try {
      ranking = await fetchRanking();
    } catch (error) {
      console.error('ranking fetch failed', error);
      throw new RegistrationError('Kunne ikke hente verdensrankingen. Prøv igjen senere.', 502);
    }
  }
  const roster = normalized.map((entry) => {
    if (entry.id == null) return unrankedRosterPlayer(entry.name);
    const player = ranking!.get(entry.id);
    if (!player) throw new RegistrationError('Spilleren ble ikke funnet på verdensrankingen.');
    return rankedRosterPlayer(player);
  });
  const lowerResolvedNames = roster.map((player) => canonicalNameKey(player.name));
  if (new Set(lowerResolvedNames).size !== lowerResolvedNames.length) {
    throw new RegistrationError('En spiller kan ikke føres opp flere ganger i samme lag.');
  }

  if (isTeam) {
    const seeded = seedTeam(roster, cfg.playersPerTeam!);
    return {
      type: 'team',
      name: seeded.roster.map((player) => player.name).join(' / '),
      country: null,
      club: null,
      worldRanking: seeded.topWorldRanking,
      rankingPoints: seeded.rankingPoints,
      rankingValue: 0,
      playerId: null,
      playerIds: seeded.roster.flatMap((player) => (player.playerId == null ? [] : [player.playerId])),
      roster: seeded.roster,
    };
  }

  const player = roster[0];
  return {
    type: 'player',
    name: player.name,
    country: player.country,
    club: player.club,
    worldRanking: player.worldRanking,
    rankingPoints: player.rankingPoints,
    rankingValue: player.rankingValue,
    playerId: player.playerId,
    playerIds: [],
    roster: null,
  };
}

function answerFor(question: RegistrationQuestion, value: string): AnswerSnapshot {
  const option = question.options.find((candidate) => candidate.value === value);
  if (!option) throw new RegistrationError(`Ugyldig svar på «${question.labelNo}».`);
  return {
    questionId: question.id,
    questionLabelNo: question.labelNo,
    questionLabelEn: question.labelEn,
    value: option.value,
    labelNo: option.labelNo,
    labelEn: option.labelEn,
  };
}

export function resolveAnswers(
  cfg: TournamentConfig,
  raw: unknown,
  preserved: AnswerSnapshot[] = [],
): AnswerSnapshot[] {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new RegistrationError('Ugyldige tilleggssvar.');
  }
  const values = (raw ?? {}) as Record<string, unknown>;
  const known = new Set(cfg.registrationQuestions.map((question) => question.id));
  for (const id of Object.keys(values)) {
    if (!known.has(id)) throw new RegistrationError('Skjemaet er endret. Last inn siden på nytt og prøv igjen.');
  }
  const current: AnswerSnapshot[] = [];
  for (const question of cfg.registrationQuestions) {
    const value = values[question.id];
    if (value == null || value === '') {
      if (question.required) throw new RegistrationError(`Svar på «${question.labelNo}» er påkrevd.`);
      continue;
    }
    if (typeof value !== 'string') throw new RegistrationError(`Ugyldig svar på «${question.labelNo}».`);
    current.push(answerFor(question, value));
  }
  return [...preserved.filter((answer) => !known.has(answer.questionId)), ...current];
}

export function parseAnswers(value: unknown): AnswerSnapshot[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as AnswerSnapshot[]) : [];
  } catch {
    return [];
  }
}

export function parseRoster(value: unknown, fallbackName = ''): RosterPlayer[] {
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return (parsed as RosterPlayer[]).map((player) =>
          player.playerId == null
            ? { ...player, nameKey: canonicalNameKey(String(player.name ?? '')) }
            : player,
        );
      }
    } catch {
      // Fall through to the legacy slash-separated display name.
    }
  }
  return fallbackName
    .split(/\s+\/\s+|\s*,\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map(unrankedRosterPlayer);
}

function teamConflict(details: ResolvedRegistration, excludeId?: number): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (details.playerIds.length > 0) {
    const placeholders = details.playerIds.map(() => '?').join(', ');
    clauses.push(`r.player_id IN (${placeholders})`);
    binds.push(...details.playerIds);
    clauses.push(`(json_valid(r.player_ids) AND EXISTS (
      SELECT 1 FROM json_each(r.player_ids) legacy_ids WHERE legacy_ids.value IN (${placeholders})
    ))`);
    binds.push(...details.playerIds);
    clauses.push(`(json_valid(r.roster) AND EXISTS (
      SELECT 1 FROM json_each(r.roster) roster_ids
      WHERE json_extract(roster_ids.value, '$.playerId') IN (${placeholders})
    ))`);
    binds.push(...details.playerIds);
  }
  const unrankedNames = (details.roster ?? [])
    .filter((player) => player.playerId == null)
    .map((player) => canonicalNameKey(player.name));
  if (unrankedNames.length > 0) {
    const placeholders = unrankedNames.map(() => '?').join(', ');
    clauses.push(`(json_valid(r.roster) AND EXISTS (
      SELECT 1 FROM json_each(r.roster) roster_keys
      WHERE json_extract(roster_keys.value, '$.playerId') IS NULL
        AND json_extract(roster_keys.value, '$.nameKey') IN (${placeholders})
    ))`);
    binds.push(...unrankedNames);
    // Compatibility with rows created before nameKey was introduced. New
    // rows use the exact Unicode-stable key above, keeping concurrent INSERT
    // statements protected by the same atomic NOT EXISTS guard.
    clauses.push(`(json_valid(r.roster) AND EXISTS (
      SELECT 1 FROM json_each(r.roster) roster_names
      WHERE json_extract(roster_names.value, '$.playerId') IS NULL
        AND lower(json_extract(roster_names.value, '$.name')) IN (${placeholders})
    ))`);
    binds.push(...unrankedNames);
  }
  clauses.push(`(r.type = 'team' AND lower(r.name) = ?)`);
  binds.push(details.name.toLocaleLowerCase('no'));
  return {
    sql: `r.tournament_slug = ?${excludeId == null ? '' : ' AND r.id <> ?'} AND (${clauses.join(' OR ')})`,
    binds: [...(excludeId == null ? [] : [excludeId]), ...binds],
  };
}

export async function createRegistration(
  db: D1Database,
  slug: string,
  cfg: TournamentConfig,
  body: RegistrationPayload,
  options: { allowClosed?: boolean; now?: Date } = {},
): Promise<{ id: number | string | undefined; details: ResolvedRegistration }> {
  if (!options.allowClosed) {
    let registrationOpen = cfg.registrationOpen !== false;
    try {
      const runtime = await db.prepare(
        'SELECT registration_open FROM tournament_settings WHERE tournament_slug = ?',
      ).bind(slug).first<{ registration_open: number }>();
      // Runtime settings are a fail-closed veto only. A stale database row
      // can never reopen an event that frontmatter has closed through CMS.
      if (runtime?.registration_open === 0) registrationOpen = false;
    } catch (error) {
      // Safe rolling deploy: if code reaches Pages just before the migration,
      // the committed configuration continues to enforce its prior state.
      if (!(error instanceof Error) || !/no such table.*tournament_settings/i.test(error.message)) throw error;
      console.warn('tournament_settings migration not applied; using build-time registration flag');
    }
    if (!registrationOpen) {
      throw new RegistrationError('Påmeldingen for denne turneringen er stengt.');
    }
    try {
      if (isPastTournamentDate(cfg.endDate, options.now)) {
        throw new RegistrationError('Påmeldingsfristen for denne turneringen er utløpt.');
      }
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      console.error('invalid tournament end date', error);
      throw new RegistrationError('Registreringen er ikke konfigurert riktig.', 500);
    }
  }
  const contact = normalizeContact(body.email, body.phone);
  const details = await resolveDetails(cfg, body);
  const answers = resolveAnswers(cfg, body.answers);
  try {
    if (details.type === 'team') {
      const conflict = teamConflict(details);
      const result = await db.prepare(
        `INSERT INTO registrations
          (tournament_slug, type, name, country, club, email, phone, world_ranking,
           ranking_points, ranking_value, player_id, player_ids, roster, answers)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE ${conflict.sql})`,
      ).bind(
        slug,
        'team',
        details.name,
        null,
        null,
        contact.email,
        contact.phone,
        details.worldRanking,
        details.rankingPoints,
        null,
        null,
        details.playerIds.length > 0 ? JSON.stringify(details.playerIds) : null,
        JSON.stringify(details.roster),
        answers.length > 0 ? JSON.stringify(answers) : null,
        slug,
        ...conflict.binds,
      ).run();
      if (result.meta.changes === 0) {
        throw new RegistrationError('En av spillerne er allerede registrert i denne turneringen!', 409);
      }
      return { id: result.meta.last_row_id, details };
    }

    const result = await db.prepare(
      `INSERT INTO registrations
        (tournament_slug, type, name, country, club, email, phone, world_ranking,
         ranking_points, ranking_value, player_id, player_ids, roster, answers)
       VALUES (?, 'player', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).bind(
      slug,
      details.name,
      details.country,
      details.club,
      contact.email,
      contact.phone,
      details.worldRanking,
      details.rankingPoints,
      details.rankingValue,
      details.playerId,
      answers.length > 0 ? JSON.stringify(answers) : null,
    ).run();
    return { id: result.meta.last_row_id, details };
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new RegistrationError('Spiller er allerede registrert!', 409);
    }
    throw error;
  }
}

function detailsFromRow(row: RegistrationRow, cfg: TournamentConfig): ResolvedRegistration {
  if (row.type === 'team') {
    if (cfg.playersPerTeam == null) throw new RegistrationError('Påmeldingen passer ikke turneringstypen.');
    const seeded = seedTeam(parseRoster(row.roster, row.name), cfg.playersPerTeam);
    return {
      type: 'team',
      name: seeded.roster.map((player) => player.name).join(' / '),
      country: null,
      club: null,
      worldRanking: seeded.topWorldRanking,
      rankingPoints: seeded.rankingPoints,
      rankingValue: 0,
      playerId: null,
      playerIds: seeded.roster.flatMap((player) => (player.playerId == null ? [] : [player.playerId])),
      roster: seeded.roster,
    };
  }
  if (cfg.playersPerTeam != null) throw new RegistrationError('Påmeldingen passer ikke turneringstypen.');
  return {
    type: 'player',
    name: row.name,
    country: row.country,
    club: row.club,
    worldRanking: row.world_ranking,
    rankingPoints: row.ranking_points ?? 0,
    rankingValue: row.ranking_value ?? 0,
    playerId: row.player_id,
    playerIds: [],
    roster: null,
  };
}

/** Replace an admin-managed registration while retaining removed-question answers. */
export async function updateRegistration(
  db: D1Database,
  slug: string,
  cfg: TournamentConfig,
  id: number,
  body: RegistrationPayload,
): Promise<ResolvedRegistration> {
  const row = await db.prepare('SELECT * FROM registrations WHERE id = ? AND tournament_slug = ?')
    .bind(id, slug)
    .first<RegistrationRow>();
  if (!row) throw new RegistrationError('Fant ikke påmeldingen.', 404);

  const changesPlayer =
    hasOwn(body, 'player') ||
    hasOwn(body, 'players') ||
    hasOwn(body, 'playerId') ||
    hasOwn(body, 'playerIds') ||
    hasOwn(body, 'name') ||
    hasOwn(body, 'names');
  const details = changesPlayer
    ? await resolveDetails(cfg, { ...body, type: row.type })
    : detailsFromRow(row, cfg);
  const contact = normalizeContact(
    hasOwn(body, 'email') ? body.email : row.email,
    hasOwn(body, 'phone') ? body.phone : row.phone,
  );
  const previousAnswers = parseAnswers(row.answers);
  const answers = hasOwn(body, 'answers')
    ? resolveAnswers(cfg, body.answers, previousAnswers)
    : previousAnswers;

  try {
    if (details.type === 'team') {
      const conflict = teamConflict(details, id);
      const result = await db.prepare(
        `UPDATE registrations
         SET name = ?, country = NULL, club = NULL, email = ?, phone = ?, world_ranking = ?,
             ranking_points = ?, ranking_value = NULL, player_id = NULL, player_ids = ?, roster = ?, answers = ?
         WHERE id = ? AND tournament_slug = ?
           AND NOT EXISTS (SELECT 1 FROM registrations r WHERE ${conflict.sql})`,
      ).bind(
        details.name,
        contact.email,
        contact.phone,
        details.worldRanking,
        details.rankingPoints,
        details.playerIds.length > 0 ? JSON.stringify(details.playerIds) : null,
        JSON.stringify(details.roster),
        answers.length > 0 ? JSON.stringify(answers) : null,
        id,
        slug,
        slug,
        ...conflict.binds,
      ).run();
      if (result.meta.changes === 0) {
        throw new RegistrationError('En av spillerne er allerede registrert i denne turneringen!', 409);
      }
      return details;
    }

    await db.prepare(
      `UPDATE registrations
       SET name = ?, country = ?, club = ?, email = ?, phone = ?, world_ranking = ?,
           ranking_points = ?, ranking_value = ?, player_id = ?, player_ids = NULL, roster = NULL, answers = ?
       WHERE id = ? AND tournament_slug = ?`,
    ).bind(
      details.name,
      details.country,
      details.club,
      contact.email,
      contact.phone,
      details.worldRanking,
      details.rankingPoints,
      details.rankingValue,
      details.playerId,
      answers.length > 0 ? JSON.stringify(answers) : null,
      id,
      slug,
    ).run();
    return details;
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new RegistrationError('Spiller er allerede registrert!', 409);
    }
    throw error;
  }
}
