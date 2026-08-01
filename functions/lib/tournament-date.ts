const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

/** Calendar date in Norway, independent of the Worker's UTC clock. */
export function osloDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Registration remains possible throughout the tournament's Norwegian date. */
export function isPastTournamentDate(endDate: string, now = new Date()): boolean {
  if (!isIsoCalendarDate(endDate)) throw new Error('Ugyldig turneringsdato i API-konfigurasjonen.');
  return osloDate(now) > endDate;
}
