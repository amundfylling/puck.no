#!/usr/bin/env node
/**
 * Prebuild step: generate functions/lib/tournament-config.json from the
 * tournaments content collection frontmatter (team rules, date and questions).
 *
 * The Pages Functions bundler cannot import from src/, so this JSON is the
 * single shared source of truth for the API (slug validity + team rules).
 * COMMIT the generated file (like src/data/ranking.json) so local
 * `wrangler pages dev` works without a build.
 *
 * Frontmatter rules (see src/content.config.ts):
 *   playersPerTeam set -> team tournament; maxSubstitutes is optional
 *   playersPerTeam null -> individual tournament
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const DIR = fileURLToPath(new URL('../src/content/tournaments', import.meta.url));
const OUT = fileURLToPath(new URL('../functions/lib/tournament-config.json', import.meta.url));

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const RANKING_LEVELS = new Set(['1-world', '1-continental', '2', '3', '4', '5', '6', '10']);

function fail(file, message) {
  console.error(`gen-tournament-config: ${file}: ${message}`);
  process.exit(1);
}

function questionsFor(file, value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(file, 'registrationQuestions må være en liste');
  const questionIds = new Set();
  return value.map((question) => {
    if (!question || typeof question !== 'object') fail(file, 'ugyldig registreringsspørsmål');
    const { id, labelNo, labelEn, required = false, options } = question;
    if (typeof id !== 'string' || !ID_RE.test(id) || questionIds.has(id)) {
      fail(file, `ugyldig eller duplisert spørsmåls-ID «${id}»`);
    }
    questionIds.add(id);
    if (typeof labelNo !== 'string' || !labelNo.trim() || typeof labelEn !== 'string' || !labelEn.trim()) {
      fail(file, `spørsmål «${id}» mangler norsk/engelsk tekst`);
    }
    if (!Array.isArray(options) || options.length < 2) fail(file, `spørsmål «${id}» må ha minst to valg`);
    const optionValues = new Set();
    const cleanOptions = options.map((option) => {
      if (!option || typeof option !== 'object') fail(file, `spørsmål «${id}» har et ugyldig valg`);
      const { value, labelNo: optionNo, labelEn: optionEn } = option;
      if (typeof value !== 'string' || !value.trim() || optionValues.has(value)) {
        fail(file, `spørsmål «${id}» har tom eller duplisert valgverdi`);
      }
      optionValues.add(value);
      if (typeof optionNo !== 'string' || !optionNo.trim() || typeof optionEn !== 'string' || !optionEn.trim()) {
        fail(file, `valg «${value}» i spørsmål «${id}» mangler norsk/engelsk tekst`);
      }
      return { value, labelNo: optionNo, labelEn: optionEn };
    });
    return { id, labelNo, labelEn, required: required === true, options: cleanOptions };
  });
}

const config = {};
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(`${DIR}/${file}`, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) continue;
  const data = YAML.parse(fm[1]);
  const slug = data?.slug;
  if (!slug) continue;
  const playersPerTeam = data.playersPerTeam ?? null;
  const maxSubstitutes = data.maxSubstitutes ?? 0;
  if (playersPerTeam != null && (!Number.isInteger(playersPerTeam) || playersPerTeam < 1)) {
    fail(file, `ugyldig playersPerTeam (${playersPerTeam})`);
  }
  if (!Number.isInteger(maxSubstitutes) || maxSubstitutes < 0) {
    fail(file, `ugyldig maxSubstitutes (${maxSubstitutes})`);
  }
  if (playersPerTeam == null && maxSubstitutes !== 0) {
    fail(file, 'maxSubstitutes må være 0 for individuelle turneringer');
  }
  const rankingLevel = data.rankingLevel ?? null;
  if (rankingLevel != null && !RANKING_LEVELS.has(String(rankingLevel))) {
    fail(file, `ugyldig rankingLevel (${rankingLevel})`);
  }
  if (playersPerTeam != null && rankingLevel != null && String(rankingLevel) !== '10') {
    fail(file, 'lagturneringer kan bare bruke rankingLevel 10');
  }
  if (playersPerTeam == null && String(rankingLevel) === '10') {
    fail(file, 'rankingLevel 10 er bare for lagturneringer');
  }
  config[slug] = {
    date: data.date,
    playersPerTeam,
    maxSubstitutes,
    rankingLevel: rankingLevel == null ? null : String(rankingLevel),
    registrationQuestions: questionsFor(file, data.registrationQuestions),
    // only emitted when closed — the API treats a missing flag as open
    ...(data.registrationOpen === false ? { registrationOpen: false } : {}),
  };
}

writeFileSync(OUT, JSON.stringify(config, null, 1) + '\n');
console.log(`gen-tournament-config: ${Object.keys(config).length} turneringer -> functions/lib/tournament-config.json`);
