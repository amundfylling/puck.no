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

/** Format a date for display: "2. mars 2025" (no) / "2 March 2025" (en). */
export function formatDate(d: Date, lang: 'no' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}
