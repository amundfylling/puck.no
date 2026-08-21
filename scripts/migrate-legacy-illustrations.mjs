import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { legacyPathKind, traceLegacyIllustration } from './lib/legacy-illustration-tracer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRICKS_DIR = path.join(ROOT, 'src/content/tricks');
const ILLUSTRATIONS_DIR = path.join(ROOT, 'src/content/illustrations');
const WRITE = process.argv.includes('--write');
const REFRESH = process.argv.includes('--refresh');
const HAND_TUNED = new Set([
  'agdur',
  'bacalao',
  'fakie-horvath',
  'fakie-invers-kano',
  'fakie-nacka',
  'fakie-veggdyr',
  'horvath',
  'invers-kano',
  'lillhael',
  'nacka',
  'spjass-horvath',
  'veggdyr',
]);

const defaultPlayers = [
  { id: 'attacking-left-wing', kind: 'attacker', role: 'left-wing', position: [57.3, 114.5], rotation: -180, scale: 0.86 },
  { id: 'attacking-center', kind: 'attacker', role: 'center', position: [213.3, 228], rotation: -90, scale: 0.9 },
  { id: 'attacking-right-wing', kind: 'attacker', role: 'right-wing', position: [352.1, 245], rotation: -88, scale: 0.86 },
  { id: 'defending-left-defense', kind: 'defender', role: 'left-defense', position: [134.1, 189.9], rotation: 98, scale: 0.86 },
  { id: 'defending-right-defense', kind: 'defender', role: 'right-defense', position: [286.8, 166], rotation: 94, scale: 0.86 },
  { id: 'defending-goalie', kind: 'goalie', role: 'goalie', position: [206.6, 162.2], rotation: 180, scale: 0.9 },
];

const roleGuides = {
  'left-wing': [[232.2, 58.5], [114.5, 58.5], [88.7, 69.7], [68.5, 85.4], [57.3, 114.5], [55.1, 149.3], [59.6, 217.6], [66.3, 259.1], [82, 296.1]],
  center: [[210.9, 210.9], [237.8, 404.8]],
  'right-wing': [[334.1, 67.5], [348.7, 91], [352.1, 123.5], [361, 417.1]],
  'left-defense': [[132.4, 121.3], [136.9, 305], [132.5, 331], [133, 666]],
  'right-defense': [[285.9, 57.4], [288.2, 337.5], [284.8, 360], [269.1, 390.2], [281, 418], [286, 601]],
};

function nearestOnSegment(point, start, end) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared));
  const candidate = [start[0] + deltaX * progress, start[1] + deltaY * progress];
  return { candidate, distance: Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) };
}

function nearestRole(point) {
  let best = null;
  for (const [role, guide] of Object.entries(roleGuides)) {
    for (let index = 0; index < guide.length - 1; index += 1) {
      const match = nearestOnSegment(point, guide[index], guide[index + 1]);
      if (!best || match.distance < best.distance) best = { role, ...match };
    }
  }
  return best;
}

function roundedPoint(point) {
  return point.map((value) => Number(value.toFixed(1)));
}

function usefulAttackingPlayers(paths) {
  const players = defaultPlayers.map((player) => ({ ...player, position: [...player.position] }));
  const actorPoints = [paths[0][0], ...paths.slice(0, -1).map((points) => points.at(-1))];
  const placedRoles = new Set();
  for (const point of actorPoints) {
    const match = nearestRole(point);
    if (!match || match.distance > 42 || placedRoles.has(match.role)) continue;
    const existing = players.find((player) => player.id === `attacking-${match.role}`);
    if (existing) existing.position = roundedPoint(match.candidate);
    placedRoles.add(match.role);
  }
  const transitions = paths.slice(0, -1).map((points) => points.at(-1));
  for (const point of transitions) {
    if (point[0] < 28 || point[0] > 387 || point[1] < 135) continue;
    const match = nearestRole(point);
    if (!match || match.distance > 42 || ['center', 'left-wing', 'right-wing'].includes(match.role)) continue;
    const id = `attacking-${match.role}`;
    if (players.some((player) => player.id === id)) continue;
    players.push({
      id,
      kind: 'attacker',
      role: match.role,
      position: roundedPoint(match.candidate),
      rotation: -90,
      scale: 0.86,
    });
  }

  const goalieTransition = transitions.find((point) => point[1] > 475 && point[0] > 155 && point[0] < 260);
  if (goalieTransition) {
    players.push({
      id: 'attacking-goalie',
      kind: 'goalie',
      role: null,
      position: roundedPoint(goalieTransition),
      rotation: 0,
      scale: 0.9,
    });
  }
  return players;
}

function labelFor(points, step) {
  const start = points[0];
  const next = points[1];
  const deltaX = next[0] - start[0];
  const deltaY = next[1] - start[1];
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const side = step % 2 === 0 ? -1 : 1;
  return roundedPoint([
    Math.max(12, Math.min(403, start[0] - side * (deltaY / length) * 15)),
    Math.max(12, Math.min(708, start[1] + side * (deltaX / length) * 15)),
  ]);
}

function goalTarget(description) {
  if (/venstre hjørne/i.test(description)) return [181, 145];
  if (/(?:høgre|høyre) hjørne/i.test(description)) return [237, 145];
  return [208, 145];
}

const trickFiles = (await fs.readdir(TRICKS_DIR)).filter((filename) => filename.endsWith('.json')).sort();
let migrated = 0;
for (const filename of trickFiles) {
  const trickPath = path.join(TRICKS_DIR, filename);
  const trick = JSON.parse(await fs.readFile(trickPath, 'utf8'));
  if (!trick.diagram || (trick.illustration && (!REFRESH || HAND_TUNED.has(trick.slug)))) continue;

  const traced = await traceLegacyIllustration(path.join(ROOT, 'public', trick.diagram));
  if (!traced.paths.length) throw new Error(`${trick.slug}: no green movement paths found in ${trick.diagram}`);
  const followsRoundedWall = /(?:bak\s+(?:eige\s+)?mål|bakom\s+(?:eige\s+)?mål|velodrom|glid\s+langs\s+vantet)/i.test(trick.description.no);
  const paths = traced.paths.map((points, index) => {
    const followsWall = followsRoundedWall && points.length >= 5;
    return {
      id: `step-${index + 1}`,
      step: index + 1,
      kind: legacyPathKind(points),
      curve: followsWall,
      followsWall,
      points,
      label: traced.labels[index]?.point ?? labelFor(points, index + 1),
    };
  });
  if (/(?:mål|scor)/i.test(trick.description.no) && paths.at(-1).points.at(-1)[1] > 180) {
    const start = [...paths.at(-1).points.at(-1)];
    paths.push({
      id: `step-${paths.length + 1}`,
      step: paths.length + 1,
      kind: 'shot',
      curve: false,
      followsWall: false,
      points: [start, goalTarget(trick.description.no)],
      label: start,
    });
  }
  const scene = {
    slug: trick.slug,
    version: 1,
    rink: 'stiga-playoff-v1',
    viewport: traced.viewport,
    paths,
    players: usefulAttackingPlayers(paths.map((entry) => entry.points)),
    puck: null,
  };

  if (WRITE) {
    trick.illustration = trick.slug;
    await fs.writeFile(path.join(ILLUSTRATIONS_DIR, `${trick.slug}.json`), `${JSON.stringify(scene, null, 2)}\n`);
    await fs.writeFile(trickPath, `${JSON.stringify(trick, null, 2)}\n`);
  }
  console.log(`${WRITE ? 'migrated' : 'would migrate'} ${trick.slug}: ${scene.paths.length} path(s), ${scene.viewport.height}px viewport`);
  migrated += 1;
}

console.log(`${WRITE ? 'Migrated' : 'Found'} ${migrated} legacy illustration(s).${WRITE ? '' : ' Run with --write to create scenes.'}`);
