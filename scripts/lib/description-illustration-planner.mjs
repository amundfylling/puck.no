const ROLE_PATTERNS = [
  ['right-wing', /\b(?:høyreving|høgreving|right wing)\b/giu],
  ['left-wing', /\b(?:venstreving|left wing)\b/giu],
  ['right-defense', /\b(?:høyreback|høgreback|right defen[cs]e)\b/giu],
  ['left-defense', /\b(?:venstreback|left defen[cs]e)\b/giu],
  ['center', /\b(?:senter|center|centre)\b/giu],
  ['goalie', /\b(?:keeper|målvakt|goalie)\b/giu],
];

const DEFAULT_POSITIONS = {
  'right-wing': [352, 245],
  'left-wing': [66, 259],
  'right-defense': [281, 455],
  'left-defense': [133, 455],
  center: [213, 228],
  goalie: [208, 555],
  goal: [208, 145],
};

const STARTING_PLAYERS = [
  { id: 'attacking-left-wing', kind: 'attacker', role: 'left-wing', position: [57.3, 114.5], rotation: -180, scale: 0.86 },
  { id: 'attacking-center', kind: 'attacker', role: 'center', position: [213.3, 228], rotation: -90, scale: 0.9 },
  { id: 'attacking-right-wing', kind: 'attacker', role: 'right-wing', position: [352.1, 245], rotation: -88, scale: 0.86 },
  { id: 'defending-left-defense', kind: 'defender', role: 'left-defense', position: [134.1, 189.9], rotation: 98, scale: 0.86 },
  { id: 'defending-right-defense', kind: 'defender', role: 'right-defense', position: [286.8, 166], rotation: 94, scale: 0.86 },
  { id: 'defending-goalie', kind: 'goalie', role: 'goalie', position: [206.6, 162.2], rotation: 180, scale: 0.9 },
];

const REVIEW_TERMS = [
  ['kiosk', 'Kioskskudd needs a table-hockey expert to place the exact shot path.'],
  ['skyffel', 'Skyffel describes stick technique that text alone does not locate precisely.'],
  ['smyg', 'Smyger timing and stick position need visual or expert confirmation.'],
  ['flikk', 'The flick direction and contact point need confirmation.'],
  ['snurr', 'Player rotation cannot be inferred as a puck path without confirmation.'],
  ['hælgrop', 'Heel-pocket wording identifies technique, not an exact coordinate.'],
  ['køllegrop', 'Stick-pocket wording identifies technique, not an exact coordinate.'],
  ['løft', 'A lifted puck needs a visual convention or video reference.'],
  ['keeperens rygg', 'A bank via the goalie requires the goalie position and contact side.'],
  ['via kølla', 'A bank via another player’s stick requires exact player and contact positions.'],
  ['stolpe', 'A post rebound requires an exact post and rebound line.'],
  ['kryss', 'Confirm which goal corner the player sees as near or far.'],
  ['rundvant', 'Confirm the exact rail contact point on the curved board.'],
  ['hele veien rundt', 'A full-rink rail route needs explicit intermediate wall points.'],
  ['later som', 'A feint needs player-motion information beyond the puck route.'],
  ['går forbi', 'The player-motion portion needs expert confirmation.'],
];

function normalize(text) {
  return text.normalize('NFKC').toLocaleLowerCase('nb-NO');
}

function roleMentions(description) {
  const mentions = [];
  for (const [role, pattern] of ROLE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of description.matchAll(pattern)) mentions.push({ role, index: match.index, text: match[0] });
  }
  const ordered = mentions
    .sort((left, right) => left.index - right.index)
    .filter((mention, index, all) => index === 0 || mention.role !== all[index - 1].role);
  const actionIndex = description.search(/\b(?:fører|drar|pasn|pass|sender|legger|skyter|scor|flikk|utfører|later)\w*/u);
  if (actionIndex < 0) return ordered;
  const actor = ordered.filter((mention) => mention.index <= actionIndex).at(-1);
  const afterAction = ordered.filter((mention) => mention.index > actionIndex);
  return actor ? [actor, ...afterAction] : afterAction;
}

function contextualPosition(role, description, mentionIndex) {
  const context = description.slice(Math.max(0, mentionIndex - 45), mentionIndex + 70);
  const point = [...DEFAULT_POSITIONS[role]];
  if (/langt bak|helt bak/.test(context)) {
    if (role === 'right-wing') point[1] = 390;
    if (role === 'left-wing') point[1] = 390;
    if (role === 'center') point[1] = 385;
  } else if (/langt fram|helt fram|fremme i sporet|framme i sporet/.test(context)) {
    if (role === 'right-wing') point[1] = 145;
    if (role === 'left-wing') point[1] = 145;
    if (role === 'center') point[1] = 213;
  }
  return point;
}

function goalPosition(description) {
  if (/(?:venstre|lang)hjørn/.test(description)) return [181, 145];
  if (/(?:høyre|høgre|kort)hjørn/.test(description)) return [237, 145];
  return [...DEFAULT_POSITIONS.goal];
}

function movementLead(description, initialRole) {
  const match = description.match(/\b(?:fører|drar|flyttar|flytter) pucken[^,.]*(fremover|framover|bakover|baketter)[^,.]*/u);
  if (!match) return null;
  const start = contextualPosition(initialRole, description, 0);
  const end = [...start];
  const forward = /fremover|framover/.test(match[1]);
  if (initialRole === 'right-wing' || initialRole === 'left-wing') end[1] = forward ? 155 : 370;
  else if (initialRole === 'center') end[1] = forward ? 205 : 365;
  return { start, end, source: match[0] };
}

function wallPoints(segment, start, end) {
  if (!/vant/.test(segment)) return [];
  if (/bak eget mål/.test(segment)) {
    const side = start[0] > 208 ? 390 : 25;
    return [[side, 500], [side, 675], [208, 695], [end[0] < 208 ? 25 : 390, 675]];
  }
  if (/bak mål/.test(segment)) {
    const side = start[0] > 208 ? 390 : 25;
    return [[side, 170], [side, 70], [208, 48], [end[0] < 208 ? 25 : 390, 70]];
  }
  if (/høyre vant|høgre vant/.test(segment)) return [[390, Math.max(155, Math.min(330, (start[1] + end[1]) / 2))]];
  if (/venstre vant/.test(segment)) return [[25, Math.max(155, Math.min(330, (start[1] + end[1]) / 2))]];
  return [];
}

function uniqueWarnings(description) {
  return REVIEW_TERMS
    .filter(([term]) => description.includes(term))
    .map(([, warning]) => warning);
}

function playerFor(role, point) {
  if (role === 'goalie') return { id: 'attacking-goalie', kind: 'goalie', role: null, position: point, rotation: 0, scale: 0.9 };
  return { id: `attacking-${role}`, kind: 'attacker', role, position: point, rotation: role === 'right-wing' ? -88 : -90, scale: 0.86 };
}

function viewportFor(paths) {
  const maximumY = Math.max(...paths.flatMap((path) => path.points.map((point) => point[1])));
  if (maximumY > 490) return { x: 0, y: 0, width: 415, height: 720 };
  if (maximumY > 300) return { x: 0, y: 0, width: 415, height: 415 };
  return { x: 0, y: 0, width: 415, height: 303 };
}

export function planIllustrationFromDescription(trick) {
  const description = normalize(trick.description.no);
  const mentions = roleMentions(description);
  const initialRole = trick.players?.[0] ?? mentions[0]?.role;
  const warnings = uniqueWarnings(description);
  if (!initialRole || !DEFAULT_POSITIONS[initialRole]) warnings.push('The starting player could not be identified.');

  const route = [];
  const lead = initialRole ? movementLead(description, initialRole) : null;
  if (lead) {
    route.push({ role: initialRole, point: lead.start, index: 0, source: lead.source });
    route.push({ role: initialRole, point: lead.end, index: description.indexOf(lead.source) + lead.source.length, source: lead.source, move: true });
  }
  for (const mention of mentions) {
    if (route.length && mention.role === route.at(-1).role && mention.index <= route.at(-1).index) continue;
    route.push({ ...mention, point: contextualPosition(mention.role, description, mention.index) });
  }
  if (!route.length && initialRole) route.push({ role: initialRole, point: [...DEFAULT_POSITIONS[initialRole]], index: 0, source: initialRole });
  if (/(?:mål|scor|hjørn|kryss)/u.test(description)) {
    route.push({ role: 'goal', point: goalPosition(description), index: description.length, source: 'mål' });
  }
  if (route.length < 2) warnings.push('The description does not contain a complete origin-to-destination route.');

  const paths = [];
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const sourceSegment = description.slice(start.index, end.index + String(end.source ?? '').length);
    const points = [start.point, ...wallPoints(sourceSegment, start.point, end.point), end.point];
    paths.push({
      id: `step-${index + 1}`,
      step: index + 1,
      kind: end.role === 'goal' ? 'shot' : end.move ? 'move' : 'pass',
      curve: false,
      points,
      label: [...start.point],
    });
  }

  const players = STARTING_PLAYERS.map((player) => ({ ...player, position: [...player.position] }));
  const seenRoles = new Set();
  for (const stop of route.filter((entry) => entry.role !== 'goal')) {
    if (seenRoles.has(stop.role)) continue;
    seenRoles.add(stop.role);
    const existing = players.find((player) => player.id === `attacking-${stop.role}`);
    if (existing) existing.position = [...stop.point];
    else players.push(playerFor(stop.role, [...stop.point]));
  }

  const scene = {
    slug: trick.slug,
    version: 1,
    rink: 'stiga-playoff-v1',
    viewport: viewportFor(paths),
    paths,
    players,
    puck: null,
  };

  return {
    slug: trick.slug,
    name: trick.name,
    description: trick.description,
    confidence: warnings.length ? 'needs-review' : 'high',
    recognizedRoute: route.map(({ role, point, source }) => ({ role, point, source })),
    warnings: [...new Set(warnings)],
    scene,
  };
}
