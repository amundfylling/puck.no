export const RINK_WIDTH = 415;
export const RINK_HEIGHT = 720;
export const RINK_ID = 'stiga-playoff-v1';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pathKinds = new Set(['pass', 'move', 'shot']);
const playerKinds = new Set(['attacker', 'defender', 'goalie']);
const playerRoles = new Set(['center', 'right-wing', 'left-wing', 'right-defense', 'left-defense', 'goalie']);

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function pointErrors(point, label) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(isFiniteNumber)) {
    return [`${label} must be an [x, y] number tuple`];
  }
  const errors = [];
  if (point[0] < 0 || point[0] > RINK_WIDTH) errors.push(`${label}.x must be between 0 and ${RINK_WIDTH}`);
  if (point[1] < 0 || point[1] > RINK_HEIGHT) errors.push(`${label}.y must be between 0 and ${RINK_HEIGHT}`);
  return errors;
}

export function validateIllustrationScene(scene, source = 'scene') {
  const errors = [];
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return [`${source} must contain a JSON object`];
  if (typeof scene.slug !== 'string' || !slugPattern.test(scene.slug)) errors.push(`${source}.slug is invalid`);
  if (scene.version !== 1) errors.push(`${source}.version must be 1`);
  if (scene.rink !== RINK_ID) errors.push(`${source}.rink must be ${RINK_ID}`);

  const viewport = scene.viewport;
  if (!viewport || typeof viewport !== 'object') {
    errors.push(`${source}.viewport is required`);
  } else {
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!isFiniteNumber(viewport[key])) errors.push(`${source}.viewport.${key} must be a number`);
    }
    if (isFiniteNumber(viewport.x) && isFiniteNumber(viewport.width) && (viewport.x < 0 || viewport.width <= 0 || viewport.x + viewport.width > RINK_WIDTH)) {
      errors.push(`${source}.viewport must fit inside the ${RINK_WIDTH}px rink width`);
    }
    if (isFiniteNumber(viewport.y) && isFiniteNumber(viewport.height) && (viewport.y < 0 || viewport.height <= 0 || viewport.y + viewport.height > RINK_HEIGHT)) {
      errors.push(`${source}.viewport must fit inside the ${RINK_HEIGHT}px rink height`);
    }
  }

  if (!Array.isArray(scene.paths) || scene.paths.length === 0) {
    errors.push(`${source}.paths must contain at least one path`);
    return errors;
  }
  const ids = new Set();
  const steps = new Set();
  scene.paths.forEach((path, index) => {
    const prefix = `${source}.paths[${index}]`;
    if (!path || typeof path !== 'object') {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (typeof path.id !== 'string' || !slugPattern.test(path.id)) errors.push(`${prefix}.id is invalid`);
    else if (ids.has(path.id)) errors.push(`${prefix}.id is duplicated`);
    else ids.add(path.id);
    if (!Number.isInteger(path.step) || path.step < 1 || path.step > 20) errors.push(`${prefix}.step must be an integer from 1 to 20`);
    else if (steps.has(path.step)) errors.push(`${prefix}.step is duplicated`);
    else steps.add(path.step);
    if (!pathKinds.has(path.kind)) errors.push(`${prefix}.kind must be pass, move, or shot`);
    if (typeof path.curve !== 'boolean') errors.push(`${prefix}.curve must be boolean`);
    if (!Array.isArray(path.points) || path.points.length < 2) errors.push(`${prefix}.points needs at least two points`);
    else path.points.forEach((point, pointIndex) => errors.push(...pointErrors(point, `${prefix}.points[${pointIndex}]`)));
    errors.push(...pointErrors(path.label, `${prefix}.label`));
  });
  [...steps].sort((a, b) => a - b).forEach((step, index) => {
    if (step !== index + 1) errors.push(`${source}.paths steps must be consecutive and start at 1`);
  });

  if (scene.players != null && !Array.isArray(scene.players)) {
    errors.push(`${source}.players must be an array`);
  } else {
    const playerIds = new Set();
    (scene.players ?? []).forEach((player, index) => {
      const prefix = `${source}.players[${index}]`;
      if (!player || typeof player !== 'object') {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (typeof player.id !== 'string' || !slugPattern.test(player.id)) errors.push(`${prefix}.id is invalid`);
      else if (playerIds.has(player.id)) errors.push(`${prefix}.id is duplicated`);
      else playerIds.add(player.id);
      if (!playerKinds.has(player.kind)) errors.push(`${prefix}.kind must be attacker, defender, or goalie`);
      if (player.role != null && !playerRoles.has(player.role)) errors.push(`${prefix}.role is invalid`);
      errors.push(...pointErrors(player.position, `${prefix}.position`));
      if (!isFiniteNumber(player.rotation) || player.rotation < -360 || player.rotation > 360) errors.push(`${prefix}.rotation must be between -360 and 360`);
      if (!isFiniteNumber(player.scale) || player.scale < 0.5 || player.scale > 1.5) errors.push(`${prefix}.scale must be between 0.5 and 1.5`);
    });
  }

  if (scene.puck !== null) errors.push(`${source}.puck must be null; movement paths already show the puck route`);
  return [...new Set(errors)];
}

export function validateIllustrationGraph(tricks, scenes) {
  const errors = [];
  const sceneBySlug = new Map(scenes.map((scene) => [scene.slug, scene]));
  const references = new Map();
  for (const trick of tricks) {
    if (!trick.illustration) continue;
    if (!sceneBySlug.has(trick.illustration)) errors.push(`trick ${trick.slug} references missing illustration ${trick.illustration}`);
    if (trick.illustration !== trick.slug) errors.push(`trick ${trick.slug} must reference an illustration with the same slug`);
    references.set(trick.illustration, (references.get(trick.illustration) ?? 0) + 1);
  }
  for (const scene of scenes) {
    if (!references.has(scene.slug)) errors.push(`illustration ${scene.slug} is not referenced by a trick`);
    if ((references.get(scene.slug) ?? 0) > 1) errors.push(`illustration ${scene.slug} is referenced by multiple tricks`);
  }
  return errors;
}
