const MONTHS = new Map([
  ['januar', 1],
  ['februar', 2],
  ['mars', 3],
  ['april', 4],
  ['mai', 5],
  ['juni', 6],
  ['juli', 7],
  ['august', 8],
  ['september', 9],
  ['oktober', 10],
  ['november', 11],
  ['desember', 12],
]);

/** Parse the last day of a Norwegian display date (single day or same-month range). */
export function norwegianEndDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().toLocaleLowerCase('no').match(
    /^(?:(\d{1,2})\.?\s*[–—-]\s*)?(\d{1,2})\.?\s+([a-zæøå]+)\s+(\d{4})$/u,
  );
  if (!match) return null;

  const startDay = match[1] == null ? null : Number(match[1]);
  const day = Number(match[2]);
  const month = MONTHS.get(match[3]);
  const year = Number(match[4]);
  if (!month || day < 1 || (startDay != null && (startDay < 1 || startDay > day))) return null;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
