/**
 * Tournament config (slug validity + team rules + registrationOpen) read
 * from the committed functions/lib/tournament-config.json on GitHub.
 * Cached per-isolate for 5 minutes.
 */
import { getTextFile } from '../github.js';

let cache = null;
const TTL_MS = 5 * 60 * 1000;

export async function getTournamentConfig(env) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const text = await getTextFile(env, 'functions/lib/tournament-config.json');
  if (!text) throw new Error('Fant ikke tournament-config.json i repoet.');
  cache = { at: Date.now(), data: JSON.parse(text) };
  return cache.data;
}

export async function requireTournament(env, slug) {
  const cfg = (await getTournamentConfig(env))[slug];
  if (!cfg) {
    const { ValidationError } = await import('./validate.js');
    throw new ValidationError(`Ukjent turnering «${slug}».`);
  }
  return cfg;
}
