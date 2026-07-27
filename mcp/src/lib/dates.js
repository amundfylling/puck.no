/**
 * Norwegian display-date parsing — a straight port of src/lib/dates.ts
 * (keep in sync!). Used to validate tournament dates and compute status.
 */
const NO_MONTHS = {
  januar: 0,
  februar: 1,
  mars: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  desember: 11,
};

/** Parse "17. januar 2026" or ranges like "1.–3. mai 2026" (end day wins). */
export function parseNoDate(text) {
  const m = String(text ?? '').match(/(?:(\d{1,2})\s*[.–-]\s*)?(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})/i);
  if (!m) return null;
  const day = Number(m[2]);
  const month = NO_MONTHS[m[3].toLowerCase()];
  const year = Number(m[4]);
  if (month === undefined || !day || !year) return null;
  return new Date(year, month, day);
}

export function endOfDay(d) {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Same rule as src/lib/content.ts tournamentStatus: today-or-later = upcoming. */
export function tournamentStatus(dateText, now = new Date()) {
  const date = parseNoDate(dateText);
  if (!date) return 'unknown';
  return endOfDay(date) >= now ? 'upcoming' : 'past';
}
