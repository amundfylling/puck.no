/**
 * Shared constants: repo layout, D1 database name, runtime environment.
 * The server resolves everything relative to its own location
 * (mcp/src/lib/config.js → repo root is three levels up), so it works
 * regardless of the cwd the MCP client launches it with.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const PATHS = {
  tournamentsDir: `${REPO_ROOT}src/content/tournaments`,
  tournamentsEnDir: `${REPO_ROOT}src/content/tournaments/en`,
  postsDir: `${REPO_ROOT}src/content/posts`,
  postsEnDir: `${REPO_ROOT}src/content/posts/en`,
  tournamentConfig: `${REPO_ROOT}functions/lib/tournament-config.json`,
  genTournamentConfig: `${REPO_ROOT}scripts/gen-tournament-config.mjs`,
  snapshot: `${REPO_ROOT}src/data/registrations-snapshot.json`,
  timersJson: `${REPO_ROOT}src/data/timers.json`,
  documentsJson: `${REPO_ROOT}src/data/documents.json`,
  i18n: `${REPO_ROOT}src/lib/i18n.ts`,
  audioDir: `${REPO_ROOT}public/media/audio`,
  pdfDir: `${REPO_ROOT}public/media/pdf`,
  /** Committed source images added by CMS/MCP; optimized at build time. */
  mediaUploadsImages: `${REPO_ROOT}media-uploads/images`,
  /** Git-ignored scratch dir (see .gitignore) — safe for PII exports. */
  exportDir: `${REPO_ROOT}migration/raw`,
};

/** D1 database name, read from wrangler.toml (falls back to "puck-no"). */
export function dbName() {
  try {
    const toml = readFileSync(`${REPO_ROOT}wrangler.toml`, 'utf8');
    const m = toml.match(/^database_name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  return 'puck-no';
}

/** GitHub owner/repo, parsed from the origin remote (for `gh api` calls). */
export function githubRepo() {
  return 'amundfylling/puck.no';
}

/**
 * Subprocess environment: the repo requires Node ≥ 22.12 (Astro 7) but the
 * machine default may be older — prepend the nvm Node 24 dir documented in
 * AGENTS.md when it exists so npm/wrangler subprocesses get a new enough node.
 */
export function subprocessEnv() {
  const nvmNode = `${process.env.HOME}/.nvm/versions/node/v24.18.0/bin`;
  const env = { ...process.env };
  if (existsSync(nvmNode)) env.PATH = `${nvmNode}:${env.PATH ?? ''}`;
  return env;
}
