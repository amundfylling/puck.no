#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateIllustrationGraph, validateIllustrationScene } from './lib/illustrations.mjs';

const ROOT = process.cwd();
const TRICKS_DIR = path.join(ROOT, 'src/content/tricks');
const ILLUSTRATIONS_DIR = path.join(ROOT, 'src/content/illustrations');
const RINK_ASSET = path.join(ROOT, 'public/illustrations/rinks/stiga-playoff-v1.png');

async function jsonFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => path.join(directory, entry.name)).sort();
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const errors = [];
const illustrationFiles = await jsonFiles(ILLUSTRATIONS_DIR);
const scenes = [];
for (const file of illustrationFiles) {
  const relative = path.relative(ROOT, file);
  const scene = await readJson(file);
  scenes.push(scene);
  errors.push(...validateIllustrationScene(scene, relative));
  if (scene.slug && path.basename(file, '.json') !== scene.slug) errors.push(`${relative}: filename must match slug ${scene.slug}`);
}
const tricks = await Promise.all((await jsonFiles(TRICKS_DIR)).map(readJson));
errors.push(...validateIllustrationGraph(tricks, scenes));
try {
  await fs.access(RINK_ASSET);
} catch {
  errors.push(`missing shared rink asset: ${path.relative(ROOT, RINK_ASSET)}`);
}

if (errors.length) {
  console.error(`check-illustrations: ${errors.length} error(s)`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`check-illustrations: ${scenes.length} editable scene(s), ${tricks.length} combinations, all valid`);
}
