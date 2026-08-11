#!/usr/bin/env node
/** Generate the Agent Skills Discovery RFC v0.2.0 index from public skills. */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const ROOT = path.resolve('public/.well-known/agent-skills');
const INDEX = path.join(ROOT, 'index.json');
const SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

function readFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const metadata = parse(match[1]);
  if (typeof metadata?.name !== 'string' || typeof metadata?.description !== 'string') {
    throw new Error(`${file}: frontmatter must contain name and description`);
  }
  return metadata;
}

export async function createAgentSkillsIndex(root = ROOT) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'SKILL.md');
    let raw;
    try {
      raw = await fs.readFile(file);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const metadata = readFrontmatter(raw.toString('utf8'), file);
    if (metadata.name !== entry.name) {
      throw new Error(`${file}: name must match its directory (${entry.name})`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || metadata.name.length > 64) {
      throw new Error(`${file}: invalid skill name`);
    }
    skills.push({
      name: metadata.name,
      type: 'skill-md',
      description: metadata.description,
      url: `/.well-known/agent-skills/${entry.name}/SKILL.md`,
      digest: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    });
  }
  return { $schema: SCHEMA, skills };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const index = await createAgentSkillsIndex();
  await fs.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`gen-agent-skills-index: wrote ${index.skills.length} skill(s)`);
}
