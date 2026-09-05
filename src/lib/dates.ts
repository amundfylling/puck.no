const NO_MONTHS: Record<string, number> = {
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

/**
 * Parse Norwegian display dates like "17. januar 2026" or ranges like
 * "1.–3. mai 2026" (end day wins, so status covers the whole event).
 * Returns null when unparseable.
 */
export function parseNoDate(text: string): Date | null {
  const m = text.match(/(?:(\d{1,2})\s*[.–-]\s*)?(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})/i);
  if (!m) return null;
  const day = Number(m[2]);
  const month = NO_MONTHS[m[3].toLowerCase()];
  const year = Number(m[4]);
  if (month === undefined || !day || !year) return null;
  return new Date(year, month, day);
}

/** First day of a tournament, rather than the range end used for status. */
export function parseNoStartDate(text: string): Date | null {
  const date = parseNoDate(text);
  const firstDay = text.match(/^(\d{1,2})\.?\s*[–-]\s*\d{1,2}/);
  if (date && firstDay) date.setDate(Number(firstDay[1]));
  return date;
}

/** Format a date for display: "2. mars 2025" (no) / "2 March 2025" (en). */
export function formatDate(d: Date, lang: 'no' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Localize a Norwegian display date like "5. september 2026" or a range like
 * "1.–3. mai 2026" ("5 September 2026" / "1–3 May 2026" in English).
 * Returns the input unchanged for lang=no or when unparseable.
 */
export function formatNoDate(text: string, lang: 'no' | 'en'): string {
  if (lang === 'no') return text;
  const m = text.match(/^(?:(\d{1,2})\s*[.–-]\s*)?(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})$/i);
  if (!m) return text;
  const month = NO_MONTHS[m[3].toLowerCase()];
  if (month === undefined) return text;
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(
    new Date(2000, month, 1),
  );
  return m[1]
    ? `${Number(m[1])}–${Number(m[2])} ${monthName} ${m[4]}`
    : `${Number(m[2])} ${monthName} ${m[4]}`;
}

export function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Format local calendar components as YYYY-MM-DD without a UTC day shift. */
export function formatIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
