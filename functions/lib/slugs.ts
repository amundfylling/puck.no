/**
 * Known tournament slugs accepted by the registration API.
 * Keep in sync with the keys of src/data/registrations-snapshot.json
 * (update both when adding a tournament — see AGENTS.md).
 */
export const KNOWN_SLUGS: ReadonlySet<string> = new Set([
  'norway-open-2026',
  'duo-nm-2026',
  'norgesmesterskapet-2026-dame',
  'norgesmesterskapet-2026-veteran',
  'norgesmesterskapet-2026-junior',
  'norgesmesterskapet-2026-u13',
  'norgesmesterskapet-2026',
  'trondheim-open-2025',
  'jæren-open-2025',
  'bergen-open-2025',
  'sudden-death-cup',
]);
