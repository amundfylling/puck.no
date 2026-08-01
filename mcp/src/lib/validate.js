/**
 * Shared validators, mirroring functions/api/registrations.ts (keep in
 * sync!). Slug rules come from AGENTS.md (lowercase, digits, dashes,
 * Nordic characters allowed).
 */
import { existsSync, readFileSync } from 'node:fs';
import { PATHS } from './config.js';
import { parseNoDate } from './dates.js';

export const SLUG_RE = /^[a-z0-9æøå][a-z0-9æøå-]*[a-z0-9æøå]$|^[a-z0-9æøå]$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[0-9][0-9\s-]{0,29}$/;
export const MAX = { name: 500, email: 254, phone: 30 };
export const RANKING_LEVELS = Object.freeze([
  '1-world',
  '1-continental',
  '2',
  '3',
  '4',
  '5',
  '6',
  '10',
]);

export class ValidationError extends Error {}

export function assertSlug(slug, what = 'slug') {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new ValidationError(
      `Ugyldig ${what} «${slug}» — kun små bokstaver, tall, bindestreker og norske tegn (a–z, 0–9, æøå, -).`,
    );
  }
}

export function assertDateText(date) {
  if (!parseNoDate(date)) {
    throw new ValidationError(
      `Kan ikke tolke datoen «${date}» — bruk norsk format, f.eks. «5. september 2026» eller «1.–3. mai 2026».`,
    );
  }
}

export function assertEmail(email) {
  if (typeof email !== 'string' || email.length > MAX.email || !EMAIL_RE.test(email.trim())) {
    throw new ValidationError(`Ugyldig e-postadresse «${email}».`);
  }
}

export function assertPhone(phone) {
  if (phone == null || phone === '') return;
  if (typeof phone !== 'string' || phone.length > MAX.phone || !PHONE_RE.test(phone.trim())) {
    throw new ValidationError(`Ugyldig telefonnummer «${phone}».`);
  }
}

export function assertTeamRule(playersPerTeam, maxSubstitutes = 0) {
  if (playersPerTeam != null && (!Number.isInteger(playersPerTeam) || playersPerTeam < 1)) {
    throw new ValidationError(`Ugyldig playersPerTeam (${playersPerTeam}).`);
  }
  if (!Number.isInteger(maxSubstitutes) || maxSubstitutes < 0) {
    throw new ValidationError(`Ugyldig maxSubstitutes (${maxSubstitutes}).`);
  }
  if (playersPerTeam == null && maxSubstitutes !== 0) {
    throw new ValidationError('maxSubstitutes må være 0 for individuelle turneringer.');
  }
}

export function assertRankingLevel(rankingLevel) {
  if (rankingLevel == null) return;
  if (typeof rankingLevel !== 'string' || !RANKING_LEVELS.includes(rankingLevel)) {
    throw new ValidationError(
      `Ugyldig rankingLevel (${rankingLevel}). Tillatte nivåer: ${RANKING_LEVELS.join(', ')}.`,
    );
  }
}

export function assertTournamentRankingLevel(playersPerTeam, rankingLevel) {
  assertRankingLevel(rankingLevel);
  const isTeam = playersPerTeam != null;
  if (isTeam && rankingLevel != null && rankingLevel !== '10') {
    throw new ValidationError('Lagturneringer kan bare bruke rankingLevel «10» (eller null).');
  }
  if (!isTeam && rankingLevel === '10') {
    throw new ValidationError('rankingLevel «10» er bare tillatt for lagturneringer.');
  }
}

/** Read the committed API tournament config (team rules/questions/registrationOpen). */
export function readTournamentConfig() {
  return JSON.parse(readFileSync(PATHS.tournamentConfig, 'utf8'));
}

/** Norwegian tournament file paths, plus the EN mirror when it exists. */
export function tournamentFiles(slug) {
  const no = `${PATHS.tournamentsDir}/${slug}.md`;
  const en = `${PATHS.tournamentsEnDir}/${slug}.md`;
  return {
    no,
    en: existsSync(en) ? en : null,
  };
}

/** Mask an email/phone for chat output (PII stays out of the transcript). */
export function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone) {
  if (!phone) return phone;
  const s = String(phone);
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}
