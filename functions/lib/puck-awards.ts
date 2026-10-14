/**
 * Puck Awards nominations: pure validation shared by the public endpoint.
 * The award config (year, deadline, categories) lives in
 * src/data/puck-awards.json and is passed in so this stays testable.
 */
import { osloDate } from './tournament-date.ts';

export interface AwardCategory {
  id: string;
  name: string;
}

export interface AwardsConfig {
  year: number;
  open: boolean;
  /** Last Norwegian calendar date nominations are accepted (inclusive). */
  nominationsClose: string;
  categories: AwardCategory[];
}

export interface Nomination {
  category: string;
  nominee: string;
  reason: string | null;
}

export interface ParsedNominations {
  nominations: Nomination[];
  nominator: string | null;
}

export const MAX_NOMINEE_LENGTH = 120;
export const MAX_REASON_LENGTH = 2000;
export const MAX_NOMINATOR_LENGTH = 120;

export class NominationError extends Error {
  readonly status = 400;
}

export function nominationsOpen(config: AwardsConfig, now = new Date()): boolean {
  return config.open && osloDate(now) <= config.nominationsClose;
}

/** Collapse whitespace and strip control characters from a one-line field. */
function cleanLine(value: unknown, max: number, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new NominationError(`Ugyldig verdi for ${field}.`);
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length > max) throw new NominationError(`${field} kan være maks ${max} tegn.`);
  return cleaned;
}

/** Like cleanLine, but keeps line breaks in free-text reasons. */
function cleanText(value: unknown, max: number, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new NominationError(`Ugyldig verdi for ${field}.`);
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > max) throw new NominationError(`${field} kan være maks ${max} tegn.`);
  return cleaned;
}

/**
 * Validate a submission: an object of { [categoryId]: { nominee, reason } }
 * plus an optional nominator name. Empty categories are skipped; at least
 * one nominee is required, unknown categories are rejected.
 */
export function parseNominations(body: Record<string, unknown>, config: AwardsConfig): ParsedNominations {
  const raw = body.nominations;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NominationError('Ugyldig forespørsel.');
  }
  const known = new Map(config.categories.map((category) => [category.id, category]));
  const nominations: Nomination[] = [];
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const category = known.get(id);
    if (!category) throw new NominationError('Ukjent kategori.');
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new NominationError('Ugyldig forespørsel.');
    }
    const { nominee, reason } = entry as Record<string, unknown>;
    const name = cleanLine(nominee, MAX_NOMINEE_LENGTH, `Nominert (${category.name})`);
    const why = cleanText(reason, MAX_REASON_LENGTH, `Begrunnelse (${category.name})`);
    if (!name) {
      if (why) throw new NominationError(`Skriv hvem du nominerer til ${category.name}.`);
      continue;
    }
    nominations.push({ category: id, nominee: name, reason: why });
  }
  if (nominations.length === 0) {
    throw new NominationError('Nominer noen i minst én kategori.');
  }
  return {
    nominations,
    nominator: cleanLine(body.nominator, MAX_NOMINATOR_LENGTH, 'Navnet ditt'),
  };
}
