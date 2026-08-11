import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ORGANIZED_SINCE_YEAR } from '../../src/config/site.ts';

function getFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (statSync(filePath).isDirectory()) {
      getFiles(filePath, fileList);
    } else if (/\.(md|astro|ts|js|json|mjs)$/.test(filePath) && !filePath.includes('src/config/site.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

test('verifies history statements match ORGANIZED_SINCE_YEAR', () => {
  const srcFiles = getFiles(path.resolve('src'));
  const failures = [];
  const configuredYear = String(ORGANIZED_SINCE_YEAR);

  // Specifically target federation organising history statements:
  // "har arrangert bordhockeyturneringer ... siden <year>"
  // "has organised/organized table hockey tournaments ... since <year>"
  // "history since <year>"
  const federationHistoryRegex = /(?:har arrangert bordhockeyturneringer.*?siden|has organi[sz]ed table hockey tournaments.*?since|history since)\s+(19\d{2}|20\d{2})/gi;

  for (const file of srcFiles) {
    const content = readFileSync(file, 'utf8');
    const relative = path.relative(path.resolve('.'), file);

    for (const match of content.matchAll(federationHistoryRegex)) {
      const year = match[1];
      if (year !== configuredYear) {
        failures.push(`${relative}: federation history statement uses year ${year} (configured ORGANIZED_SINCE_YEAR is ${configuredYear})`);
      }
    }
  }

  assert.equal(failures.length, 0, `Founding year contradictions found:\n${failures.join('\n')}`);
});
