import { RINK_WIDTH, RINK_HEIGHT, snapPointToPlayerGuide, type IllustrationPoint, type IllustrationScene, type IllustrationPath, type IllustrationPlayer, type IllustrationPlayerKind } from './illustration-geometry.ts';
type Viewport = IllustrationScene['viewport'];
const round = (value: number) => Number(value.toFixed(1));
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const playerKinds = ['attacker', 'defender', 'goalie'] as const;
const playerRoles = ['center', 'right-wing', 'left-wing', 'right-defense', 'left-defense', 'goalie'] as const;

function isPoint(value: unknown): value is IllustrationPoint {
  return Array.isArray(value)
    && value.length === 2
    && value.every((part) => typeof part === 'number' && Number.isFinite(part))
    && value[0] >= 0 && value[0] <= RINK_WIDTH
    && value[1] >= 0 && value[1] <= RINK_HEIGHT;
}

export function parseScene(value: unknown, expectedSlug: string, allowEmpty = true): IllustrationScene {
  if (!value || typeof value !== 'object') throw new Error('JSON-filen må inneholde et sceneobjekt.');
  const candidate = value as Record<string, unknown>;
  if (candidate.slug !== expectedSlug) throw new Error(`Scenen må ha slug «${expectedSlug}».`);
  if (candidate.version !== 1 || candidate.rink !== 'stiga-playoff-v1') throw new Error('Ukjent sceneversjon eller bane.');
  if (candidate.published != null && typeof candidate.published !== 'boolean') throw new Error('Publiseringsvalget må være sant eller usant.');

  const viewport = candidate.viewport as Record<string, unknown> | undefined;
  if (!viewport || !['x', 'y', 'width', 'height'].every((field) => typeof viewport[field] === 'number' && Number.isFinite(viewport[field]))) {
    throw new Error('Utsnittet mangler gyldige tall.');
  }
  const parsedViewport = viewport as unknown as Viewport;
  if (
    parsedViewport.x < 0 || parsedViewport.y < 0
    || parsedViewport.width <= 0 || parsedViewport.height <= 0
    || parsedViewport.x + parsedViewport.width > RINK_WIDTH
    || parsedViewport.y + parsedViewport.height > RINK_HEIGHT
  ) throw new Error('Utsnittet må ligge innenfor banen på 415 × 720.');

  if (!Array.isArray(candidate.paths) || (!allowEmpty && candidate.paths.length === 0)) {
    throw new Error('Illustrasjonen må inneholde minst én pil.');
  }
  if (candidate.paths.length > 20) throw new Error('Maksimalt 20 piler er tillatt.');
  const paths = candidate.paths.map((raw, index): IllustrationPath => {
    if (!raw || typeof raw !== 'object') throw new Error(`Pil ${index + 1} er ugyldig.`);
    const path = raw as Record<string, unknown>;
    if (!Array.isArray(path.points) || path.points.length < 2 || path.points.length > 100 || !path.points.every(isPoint)) {
      throw new Error(`Pil ${index + 1} må ha minst to gyldige punkter.`);
    }
    if (!isPoint(path.label)) throw new Error(`Pil ${index + 1} mangler en gyldig nummerplassering.`);
    if (!['pass', 'move', 'shot'].includes(String(path.kind))) throw new Error(`Pil ${index + 1} har ukjent type.`);
    const kind = path.kind as IllustrationPath['kind'];
    if (typeof path.curve !== 'boolean' || (path.followsWall != null && typeof path.followsWall !== 'boolean')) throw new Error('Ugyldig pilform.');
    const curve = path.curve;
    const followsWall = Boolean(path.followsWall);
    if (kind !== 'move' && curve && !followsWall) throw new Error(`Pil ${index + 1} er en kurvet puckbane og må følge vantet bak mål.`);
    if (followsWall && kind === 'move') throw new Error(`Pil ${index + 1} kan ikke være både spillerbevegelse og puckbane bak mål.`);
    if (followsWall && (!curve || path.points.length < 3)) throw new Error(`Pil ${index + 1} må ha minst tre punkter for å følge vantet bak mål.`);
    return {
      id: `step-${index + 1}`,
      step: index + 1,
      kind,
      curve,
      followsWall,
      points: path.points.map((point) => [round(point[0]), round(point[1])]),
      label: [round(path.label[0]), round(path.label[1])],
    };
  });

  const rawPlayers = candidate.players ?? [];
  if (!Array.isArray(rawPlayers)) throw new Error('Spillere må være en liste.');
  if (rawPlayers.length > 30) throw new Error('Maksimalt 30 spillere er tillatt.');
  const playerIds = new Set<string>();
  const players = rawPlayers.map((raw, index): IllustrationPlayer => {
    if (!raw || typeof raw !== 'object') throw new Error(`Spiller ${index + 1} er ugyldig.`);
    const player = raw as Record<string, unknown>;
    if (typeof player.id !== 'string' || !idPattern.test(player.id) || playerIds.has(player.id)) {
      throw new Error(`Spiller ${index + 1} må ha en unik id med små bokstaver, tall og bindestreker.`);
    }
    if (!playerKinds.includes(player.kind as IllustrationPlayerKind)) throw new Error(`Spiller ${index + 1} har ukjent type.`);
    if (player.role != null && !playerRoles.includes(player.role as typeof playerRoles[number])) throw new Error(`Spiller ${index + 1} har ukjent rolle.`);
    if (!isPoint(player.position)) throw new Error(`Spiller ${index + 1} mangler en gyldig posisjon.`);
    if (typeof player.rotation !== 'number' || !Number.isFinite(player.rotation) || player.rotation < -360 || player.rotation > 360) {
      throw new Error(`Spiller ${index + 1} må ha rotasjon mellom -360 og 360.`);
    }
    if (typeof player.scale !== 'number' || !Number.isFinite(player.scale) || player.scale < 0.5 || player.scale > 1.5) {
      throw new Error(`Spiller ${index + 1} må ha størrelse mellom 0,5 og 1,5.`);
    }
    const role = (player.role ?? null) as IllustrationPlayer['role'];
    const position: IllustrationPoint = [round(player.position[0]), round(player.position[1])];
    playerIds.add(player.id);
    return {
      id: player.id,
      kind: player.kind as IllustrationPlayerKind,
      role,
      position: snapPointToPlayerGuide(position, role),
      rotation: round(player.rotation),
      scale: round(player.scale),
    };
  });

  return {
    slug: expectedSlug,
    version: 1,
    rink: 'stiga-playoff-v1',
    published: candidate.published === true,
    viewport: {
      x: round(parsedViewport.x),
      y: round(parsedViewport.y),
      width: round(parsedViewport.width),
      height: round(parsedViewport.height),
    },
    paths,
    players,
    puck: null,
  };
}
