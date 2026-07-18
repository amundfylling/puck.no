import timersData from '../data/timers.json';

export interface Timer {
  title: string;
  file: string;
  duration_hint: string;
}

export const timers: Timer[] = timersData;

/**
 * The timere page body starts with intro paragraphs followed by the scraped
 * (junk) Wix audio widgets, one per timer title. The intro is content, so we
 * keep it: everything before the first timer title, minus markdown headings.
 * Throws at build time if the body shape changes unexpectedly.
 */
export function timerIntroParagraphs(body: string): string[] {
  const idx = body.indexOf(`\n${timers[0].title}`);
  if (idx === -1) throw new Error('timere page: intro boundary not found');
  return body
    .slice(0, idx)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('#'));
}
