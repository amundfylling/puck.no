/**
 * D1 access via the wrangler CLI (reuses the interactive `wrangler login`
 * session — no API tokens to manage). Every value goes through sqlValue();
 * NEVER interpolate raw input into SQL.
 */
import { dbName, REPO_ROOT } from './config.js';
import { run } from './run.js';

/** Escape a JS value as a SQL literal. */
export function sqlValue(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Refusing non-finite number in SQL: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replaceAll("'", "''")}'`;
}

/**
 * Run a SQL command against the REMOTE production database.
 * Returns the rows for SELECTs, or { changes, lastRowId } for writes.
 * Set MCP_D1_LOCAL=1 to target the local dev database instead.
 */
export async function d1(sql) {
  const local = process.env.MCP_D1_LOCAL === '1';
  const { stdout } = await run(
    'npx',
    ['wrangler', 'd1', 'execute', dbName(), local ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: REPO_ROOT, timeoutMs: 120_000 },
  );
  // wrangler --json prints an array of per-command results; be tolerant of
  // any non-JSON log lines around it.
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error(`Unexpected wrangler output:\n${stdout.slice(0, 2000)}`);
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  const first = parsed[0] ?? {};
  if (first.success === false) {
    throw new Error(`D1 error: ${first.error ?? JSON.stringify(first).slice(0, 1000)}`);
  }
  const meta = first.meta ?? {};
  return {
    results: first.results ?? [],
    changes: meta.changes ?? 0,
    lastRowId: meta.last_row_id ?? null,
  };
}

/** Convenience SELECT → rows. */
export async function d1Select(sql) {
  return (await d1(sql)).results;
}
