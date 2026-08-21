import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { planIllustrationFromDescription } from './lib/description-illustration-planner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const write = process.argv.includes('--write');

if (!slug) {
  console.error('Usage: npm run illustration:draft -- <slug> [--write]');
  process.exitCode = 1;
} else {
  const trickPath = path.join(ROOT, 'src/content/tricks', `${slug}.json`);
  const trick = JSON.parse(await fs.readFile(trickPath, 'utf8'));
  const plan = planIllustrationFromDescription(trick);
  if (write) {
    const outputDirectory = path.join(ROOT, 'migration/illustration-drafts');
    await fs.mkdir(outputDirectory, { recursive: true });
    const scenePath = path.join(outputDirectory, `${slug}.json`);
    const briefPath = path.join(outputDirectory, `${slug}.brief.json`);
    await fs.writeFile(scenePath, `${JSON.stringify(plan.scene, null, 2)}\n`);
    await fs.writeFile(briefPath, `${JSON.stringify({ ...plan, scene: undefined }, null, 2)}\n`);
    console.log(`Draft scene: ${path.relative(ROOT, scenePath)}`);
    console.log(`Review brief: ${path.relative(ROOT, briefPath)}`);
    console.log('Import the draft in /admin/illustrasjoner/, resolve every warning, and compare it with expert knowledge before publishing.');
  } else {
    console.log(JSON.stringify(plan, null, 2));
  }
}
