#!/usr/bin/env node
/**
 * Prebuild step: generate functions/lib/tournament-config.json from the
 * tournaments content collection frontmatter (slug, teamMin, teamMax).
 *
 * The Pages Functions bundler cannot import from src/, so this JSON is the
 * single shared source of truth for the API (slug validity + team rules).
 * COMMIT the generated file (like src/data/ranking.json) so local
 * `wrangler pages dev` works without a build.
 *
 * Frontmatter rules (see src/content.config.ts):
 *   teamMin/teamMax both set  -> team tournament (min/max players per team)
 *   both null (default)       -> individual tournament
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../src/content/tournaments', import.meta.url));
const OUT = fileURLToPath(new URL('../functions/lib/tournament-config.json', import.meta.url));

/** Minimal scalar reader for our simple frontmatter (string | number | null). */
function field(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return null;
  const v = m[1].trim();
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, '');
}

const config = {};
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(`${DIR}/${file}`, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) continue;
  const slug = field(fm[1], 'slug');
  if (!slug) continue;
  const teamMin = field(fm[1], 'teamMin');
  const teamMax = field(fm[1], 'teamMax');
  if ((teamMin == null) !== (teamMax == null)) {
    console.error(`gen-tournament-config: ${file}: teamMin/teamMax må begge være satt eller begge null`);
    process.exit(1);
  }
  if (teamMin != null && (!(teamMin >= 1) || !(teamMax >= teamMin))) {
    console.error(`gen-tournament-config: ${file}: ugyldig teamMin/teamMax (${teamMin}/${teamMax})`);
    process.exit(1);
  }
  config[slug] = { teamMin: teamMin ?? null, teamMax: teamMax ?? null };
}

writeFileSync(OUT, JSON.stringify(config, null, 1) + '\n');
console.log(`gen-tournament-config: ${Object.keys(config).length} turneringer -> functions/lib/tournament-config.json`);
