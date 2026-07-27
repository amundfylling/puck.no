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

export function assertTeamRule(teamMin, teamMax) {
  if ((teamMin == null) !== (teamMax == null)) {
    throw new ValidationError('teamMin og teamMax må begge være satt (lagturnering) eller begge tomme (individuell).');
  }
  if (teamMin != null && (!(teamMin >= 1) || !(teamMax >= teamMin))) {
    throw new ValidationError(`Ugyldig teamMin/teamMax (${teamMin}/${teamMax}).`);
  }
}

/** Read the committed API tournament config (slug → { teamMin, teamMax, registrationOpen? }). */
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
