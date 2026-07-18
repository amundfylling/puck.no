#!/usr/bin/env node
/**
 * One-off fix-up (kept for reference, like patch-tournaments.mjs).
 *
 * Cleans Wix scrape artifacts from src/content/tournaments/*.md:
 *  1. Removes the "[< Tilbake](/turneringer)" nav link at the top of bodies.
 *  2. Removes the Wix registration-widget block: everything from
 *     "# Registrer spiller" (incl. "1234", "# Registrer lag",
 *     "# Påmeldte spillere", the count and the duplicated participant table)
 *     up to "# Tidsskjema" (kept) or EOF.
 *     Participant lists are rendered from src/data/registrations-snapshot.json
 *     instead (Phase 2).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = new URL('../src/content/tournaments/', import.meta.url).pathname;
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.md')) continue;
  const p = path.join(dir, file);
  let text = readFileSync(p, 'utf8');
  const before = text;

  // 1. "[< Tilbake](/turneringer)" line (+ trailing blank line)
  text = text.replace(/^\[< Tilbake\]\(\/turneringer\)\n\n?/m, '');

  // 2. registration widget block
  const regIdx = text.search(/^# Registrer spiller$/m);
  if (regIdx !== -1) {
    const rest = text.slice(regIdx);
    const schedIdx = rest.search(/^# Tidsskjema$/m);
    text = schedIdx === -1
      ? text.slice(0, regIdx).trimEnd() + '\n'
      : text.slice(0, regIdx) + rest.slice(schedIdx);
  }

  // 3. duplicate page header: leading "# <name>" + "## <date>" — the Phase 2
  //    template renders name/date from frontmatter instead.
  text = text.replace(/(---\n[\s\S]*?\n---\n)\n?# [^\n]+\n+\n?## [^\n]+\n+/, '$1');

  if (text !== before) {
    writeFileSync(p, text);
    console.log('cleaned', file);
  } else {
    console.log('unchanged', file);
  }
}
