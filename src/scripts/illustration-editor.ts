import {
  defaultIllustrationPlayers,
  illustrationPathData,
  playerRoleGuides,
  playerSpritePlacement,
  RINK_ASSET,
  RINK_HEIGHT,
  RINK_WIDTH,
  snapPointToPlayerGuide,
  viewportPresets,
  type IllustrationPath,
  type IllustrationPoint,
  type IllustrationPlayer,
  type IllustrationPlayerKind,
  type IllustrationScene,
} from '../lib/illustrations';

type Tool = 'select' | 'line' | 'curve';
type Viewport = IllustrationScene['viewport'];

interface EditorItem {
  slug: string;
  name: string;
  player: string;
  difficulty: number;
  illustration: string | null;
  diagram: string | null;
  scene: IllustrationScene | null;
}

type DragState =
  | { type: 'path'; pathId: string; pointIndex?: number; label?: boolean; before: string; moved: boolean }
  | { type: 'player'; playerId: string; before: string; moved: boolean }
  | { type: 'puck'; before: string; moved: boolean };

const clone = <T>(value: T): T => structuredClone(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Number(value.toFixed(1));
const sceneKey = (slug: string) => `puck-illustration:${slug}:v3`;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const playerKinds = ['attacker', 'defender', 'goalie'] as const;
const playerRoles = ['center', 'right-wing', 'left-wing', 'right-defense', 'left-defense', 'goalie'] as const;

function newScene(slug: string): IllustrationScene {
  return {
    slug,
    version: 1,
    rink: 'stiga-playoff-v1',
    viewport: { ...viewportPresets['offensive-zone'] },
    paths: [],
    players: defaultIllustrationPlayers(),
    puck: null,
  };
}

function isPoint(value: unknown): value is IllustrationPoint {
  return Array.isArray(value)
    && value.length === 2
    && value.every((part) => typeof part === 'number' && Number.isFinite(part))
    && value[0] >= 0 && value[0] <= RINK_WIDTH
    && value[1] >= 0 && value[1] <= RINK_HEIGHT;
}

function parseScene(value: unknown, expectedSlug: string, allowEmpty = true): IllustrationScene {
  if (!value || typeof value !== 'object') throw new Error('JSON-filen må inneholde et sceneobjekt.');
  const candidate = value as Record<string, unknown>;
  if (candidate.slug !== expectedSlug) throw new Error(`Scenen må ha slug «${expectedSlug}».`);
  if (candidate.version !== 1 || candidate.rink !== 'stiga-playoff-v1') throw new Error('Ukjent sceneversjon eller bane.');

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
  const paths = candidate.paths.map((raw, index): IllustrationPath => {
    if (!raw || typeof raw !== 'object') throw new Error(`Pil ${index + 1} er ugyldig.`);
    const path = raw as Record<string, unknown>;
    if (!Array.isArray(path.points) || path.points.length < 2 || !path.points.every(isPoint)) {
      throw new Error(`Pil ${index + 1} må ha minst to gyldige punkter.`);
    }
    if (!isPoint(path.label)) throw new Error(`Pil ${index + 1} mangler en gyldig nummerplassering.`);
    if (!['pass', 'move', 'shot'].includes(String(path.kind))) throw new Error(`Pil ${index + 1} har ukjent type.`);
    return {
      id: `step-${index + 1}`,
      step: index + 1,
      kind: path.kind as IllustrationPath['kind'],
      curve: Boolean(path.curve),
      points: path.points.map((point) => [round(point[0]), round(point[1])]),
      label: [round(path.label[0]), round(path.label[1])],
    };
  });

  const rawPlayers = candidate.players ?? [];
  if (!Array.isArray(rawPlayers)) throw new Error('Spillere må være en liste.');
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

  let puck: IllustrationScene['puck'] = null;
  if (candidate.puck != null) {
    if (typeof candidate.puck !== 'object' || Array.isArray(candidate.puck)) throw new Error('Pucken er ugyldig.');
    const rawPuck = candidate.puck as Record<string, unknown>;
    if (!isPoint(rawPuck.position)) throw new Error('Pucken mangler en gyldig posisjon.');
    if (typeof rawPuck.radius !== 'number' || !Number.isFinite(rawPuck.radius) || rawPuck.radius < 3 || rawPuck.radius > 12) {
      throw new Error('Puckradius må være mellom 3 og 12.');
    }
    puck = {
      position: [round(rawPuck.position[0]), round(rawPuck.position[1])],
      radius: round(rawPuck.radius),
    };
  }

  return {
    slug: expectedSlug,
    version: 1,
    rink: 'stiga-playoff-v1',
    viewport: {
      x: round(parsedViewport.x),
      y: round(parsedViewport.y),
      width: round(parsedViewport.width),
      height: round(parsedViewport.height),
    },
    paths,
    players,
    puck,
  };
}

function pathStyle(path: IllustrationPath) {
  return {
    stroke: path.kind === 'move' ? '#0e2a57' : '#0a9f2f',
    dash: path.kind === 'move' ? '8 6' : '',
    width: path.kind === 'shot' ? 8 : 7,
  };
}

function initializeEditor(root: HTMLElement) {
  if (root.dataset.editorReady === 'true') return;
  root.dataset.editorReady = 'true';

  const required = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Illustration editor is missing ${selector}`);
    return element;
  };
  const data = JSON.parse(required<HTMLScriptElement>('[data-editor-data]').textContent ?? '[]') as EditorItem[];
  const items = new Map(data.map((item) => [item.slug, item]));
  const trickSelect = required<HTMLSelectElement>('[data-editor-trick]');
  const svg = required<SVGSVGElement>('[data-editor-stage]');
  const status = required<HTMLElement>('[data-editor-status]');
  const preview = required<HTMLAnchorElement>('[data-editor-preview]');
  const referenceWrap = required<HTMLDetailsElement>('[data-editor-reference-wrap]');
  const reference = required<HTMLImageElement>('[data-editor-reference]');
  const viewportSelect = required<HTMLSelectElement>('[data-editor-viewport]');
  const viewportFields = Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [key, required<HTMLInputElement>(`[data-editor-viewport-field="${key}"]`)]),
  ) as Record<keyof Viewport, HTMLInputElement>;
  const pathSelection = required<HTMLElement>('[data-editor-selection]');
  const playerSelection = required<HTMLElement>('[data-editor-player-selection]');
  const puckSelection = required<HTMLElement>('[data-editor-puck-selection]');
  const selectionEmpty = required<HTMLElement>('[data-editor-selection-empty]');
  const kindSelect = required<HTMLSelectElement>('[data-editor-kind]');
  const pointsInput = required<HTMLTextAreaElement>('[data-editor-points]');
  const labelX = required<HTMLInputElement>('[data-editor-label-x]');
  const labelY = required<HTMLInputElement>('[data-editor-label-y]');
  const playerKind = required<HTMLSelectElement>('[data-editor-player-kind]');
  const playerRole = required<HTMLSelectElement>('[data-editor-player-role]');
  const playerX = required<HTMLInputElement>('[data-editor-player-x]');
  const playerY = required<HTMLInputElement>('[data-editor-player-y]');
  const playerRotation = required<HTMLInputElement>('[data-editor-player-rotation]');
  const playerScale = required<HTMLInputElement>('[data-editor-player-scale]');
  const puckX = required<HTMLInputElement>('[data-editor-puck-x]');
  const puckY = required<HTMLInputElement>('[data-editor-puck-y]');
  const puckRadius = required<HTMLInputElement>('[data-editor-puck-radius]');
  const jsonInput = required<HTMLTextAreaElement>('[data-editor-json]');
  const undoButton = required<HTMLButtonElement>('[data-editor-undo]');
  const redoButton = required<HTMLButtonElement>('[data-editor-redo]');
  const finishButton = required<HTMLButtonElement>('[data-editor-finish]');
  const cancelButton = required<HTMLButtonElement>('[data-editor-cancel]');
  const gridToggle = required<HTMLInputElement>('[data-editor-grid]');

  let currentSlug = trickSelect.value;
  let scene = newScene(currentSlug);
  let tool: Tool = 'select';
  let selectedPathId: string | null = null;
  let selectedPlayerId: string | null = null;
  let puckSelected = false;
  let history: string[] = [];
  let future: string[] = [];
  let drawingPoints: IllustrationPoint[] = [];
  let previewPoint: IllustrationPoint | null = null;
  let lineStart: IllustrationPoint | null = null;
  let drag: DragState | null = null;

  const announce = (message: string) => { status.textContent = message; };
  const snapshot = () => JSON.stringify(scene);
  const saveDraft = () => {
    try { localStorage.setItem(sceneKey(currentSlug), JSON.stringify(scene)); } catch {}
  };
  const mutate = (change: () => void, message: string) => {
    history.push(snapshot());
    if (history.length > 100) history.shift();
    future = [];
    change();
    saveDraft();
    render();
    announce(message);
  };
  const selectedPath = () => scene.paths.find((path) => path.id === selectedPathId);
  const selectedPlayer = () => scene.players.find((player) => player.id === selectedPlayerId);
  const clearSelection = () => {
    selectedPathId = null;
    selectedPlayerId = null;
    puckSelected = false;
  };
  const selectPath = (id: string) => {
    clearSelection();
    selectedPathId = id;
  };
  const selectPlayer = (id: string) => {
    clearSelection();
    selectedPlayerId = id;
  };
  const selectPuck = () => {
    clearSelection();
    puckSelected = true;
  };

  const pointFromEvent = (event: PointerEvent): IllustrationPoint => {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    const transformed = matrix ? point.matrixTransform(matrix) : point;
    return [round(clamp(transformed.x, 0, RINK_WIDTH)), round(clamp(transformed.y, 0, RINK_HEIGHT))];
  };

  const nextStep = () => scene.paths.length + 1;
  const addPath = (points: IllustrationPoint[], curve: boolean) => {
    const step = nextStep();
    mutate(() => {
      scene.paths.push({
        id: `step-${step}`,
        step,
        kind: 'pass',
        curve,
        points: points.map((point) => [...point]),
        label: [...points[0]],
      });
      selectPath(`step-${step}`);
    }, `Pil ${step} lagt til.`);
  };

  const nextPlayerId = (kind: IllustrationPlayerKind) => {
    let number = 1;
    while (scene.players.some((player) => player.id === `${kind}-${number}`)) number += 1;
    return `${kind}-${number}`;
  };

  const nextAvailableRole = (kind: IllustrationPlayerKind): IllustrationPlayer['role'] => {
    const candidates: IllustrationPlayer['role'][] = kind === 'attacker'
      ? ['center', 'left-wing', 'right-wing']
      : kind === 'defender'
        ? ['left-defense', 'right-defense']
        : ['goalie'];
    return candidates.find((role) => !scene.players.some((player) => player.role === role)) ?? null;
  };

  const addPlayer = (kind: IllustrationPlayerKind) => {
    if (tool !== 'select') setTool('select');
    const id = nextPlayerId(kind);
    const role = nextAvailableRole(kind);
    const layout = role ? defaultIllustrationPlayers().find((player) => player.role === role) : undefined;
    const position: IllustrationPoint = layout
      ? [...layout.position]
      : [round(scene.viewport.x + scene.viewport.width / 2), round(scene.viewport.y + scene.viewport.height / 2)];
    mutate(() => {
      scene.players.push({
        id,
        kind,
        role,
        position,
        rotation: layout?.rotation ?? (kind === 'attacker' ? -90 : kind === 'defender' ? 90 : 180),
        scale: layout?.scale ?? 1,
      });
      selectPlayer(id);
    }, `${kind === 'attacker' ? 'Angriper' : kind === 'defender' ? 'Forsvarer' : 'Keeper'} lagt til.`);
  };

  const addPuck = () => {
    if (tool !== 'select') setTool('select');
    if (scene.puck) {
      selectPuck();
      render();
      announce('Pucken finnes allerede og er valgt.');
      return;
    }
    mutate(() => {
      scene.puck = {
        position: [round(scene.viewport.x + scene.viewport.width / 2), round(scene.viewport.y + scene.viewport.height / 2)],
        radius: 5,
      };
      selectPuck();
    }, 'Puck lagt til.');
  };

  const finishCurve = () => {
    if (drawingPoints.length < 2) {
      announce('En bøyd pil trenger minst to punkter.');
      return;
    }
    addPath(drawingPoints, true);
    drawingPoints = [];
    previewPoint = null;
    setTool('select');
  };

  const cancelDrawing = () => {
    drawingPoints = [];
    previewPoint = null;
    lineStart = null;
    render();
    announce('Tegning avbrutt.');
  };

  const setTool = (next: Tool) => {
    if (tool !== next) cancelDrawing();
    tool = next;
    svg.dataset.tool = tool;
    root.querySelectorAll<HTMLButtonElement>('[data-editor-tool]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.editorTool === tool));
    });
    render();
  };

  const renderSelection = () => {
    const path = selectedPath();
    const player = selectedPlayer();
    const hasPuck = puckSelected && scene.puck;
    pathSelection.classList.toggle('hidden', !path);
    playerSelection.classList.toggle('hidden', !player);
    puckSelection.classList.toggle('hidden', !hasPuck);
    selectionEmpty.classList.toggle('hidden', Boolean(path || player || hasPuck));
    if (path) {
      kindSelect.value = path.kind;
      pointsInput.value = path.points.map(([x, y]) => `${x}, ${y}`).join('\n');
      labelX.value = String(path.label[0]);
      labelY.value = String(path.label[1]);
    }
    if (player) {
      playerKind.value = player.kind;
      playerRole.value = player.role ?? '';
      playerX.value = String(player.position[0]);
      playerY.value = String(player.position[1]);
      playerRotation.value = String(player.rotation);
      playerScale.value = String(player.scale);
    }
    if (hasPuck && scene.puck) {
      puckX.value = String(scene.puck.position[0]);
      puckY.value = String(scene.puck.position[1]);
      puckRadius.value = String(scene.puck.radius);
    }
  };

  const presetName = (): string => {
    for (const [name, viewport] of Object.entries(viewportPresets)) {
      if (Object.keys(viewport).every((key) => scene.viewport[key as keyof Viewport] === viewport[key as keyof typeof viewport])) return name;
    }
    return 'custom';
  };

  const render = () => {
    const { viewport } = scene;
    svg.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
    const selectedRole = selectedPlayer()?.role;
    const selectedGuideMarkup = selectedRole
      ? `<polyline points="${playerRoleGuides[selectedRole].map((point) => point.join(',')).join(' ')}" fill="none" stroke="#c8102e" stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" vector-effect="non-scaling-stroke" pointer-events="none" />`
      : '';
    const playerMarkup = scene.players.map((player) => {
      const placement = playerSpritePlacement(player);
      const selected = player.id === selectedPlayerId;
      return `<g transform="translate(${player.position[0]} ${player.position[1]}) rotate(${player.rotation})" pointer-events="none" filter="url(#editor-player-shadow)">
        <image href="${placement.asset}" x="${placement.x}" y="${placement.y}" width="${placement.width}" height="${placement.height}" preserveAspectRatio="xMidYMid meet" />
        ${selected ? `<rect x="${placement.x - 4}" y="${placement.y - 4}" width="${placement.width + 8}" height="${placement.height + 8}" rx="5" fill="none" stroke="#c8102e" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" /><circle cx="0" cy="0" r="3.5" fill="#c8102e" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" />` : ''}
      </g>`;
    }).join('');
    const playerHitMarkup = scene.players.map((player) => (
      `<circle data-player-id="${player.id}" cx="${player.position[0]}" cy="${player.position[1]}" r="24" fill="transparent" pointer-events="all" />`
    )).join('');
    const puckMarkup = scene.puck
      ? `<circle cx="${scene.puck.position[0]}" cy="${scene.puck.position[1]}" r="${scene.puck.radius}" fill="#101820" stroke="${puckSelected ? '#c8102e' : '#fff'}" stroke-width="${puckSelected ? 3 : 1.5}" vector-effect="non-scaling-stroke" pointer-events="none" />`
      : '';
    const puckHitMarkup = scene.puck
      ? `<circle data-puck="true" cx="${scene.puck.position[0]}" cy="${scene.puck.position[1]}" r="22" fill="transparent" pointer-events="all" />`
      : '';
    const pathMarkup = scene.paths.map((path) => {
      const style = pathStyle(path);
      return `<path d="${illustrationPathData(path.points, path.curve)}" fill="none" stroke="${style.stroke}" stroke-width="${style.width}" stroke-dasharray="${style.dash}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#editor-arrowhead)" vector-effect="non-scaling-stroke" pointer-events="none" />`;
    }).join('');
    const pathOverlayMarkup = scene.paths.map((path) => {
      const selected = path.id === selectedPathId;
      const handles = selected
        ? path.points.map(([x, y], index) => `<circle data-point-index="${index}" data-path-id="${path.id}" cx="${x}" cy="${y}" r="7" fill="#fff" stroke="#c8102e" stroke-width="2" vector-effect="non-scaling-stroke" />`).join('')
        : '';
      return `<g>
        <path data-path-id="${path.id}" d="${illustrationPathData(path.points, path.curve)}" fill="none" stroke="transparent" stroke-width="22" pointer-events="stroke" vector-effect="non-scaling-stroke" />
        <circle data-label="true" data-path-id="${path.id}" cx="${path.label[0]}" cy="${path.label[1]}" r="11" fill="#101820" stroke="${selected ? '#c8102e' : '#fff'}" stroke-width="${selected ? 2.5 : 1.5}" vector-effect="non-scaling-stroke" />
        <text x="${path.label[0]}" y="${path.label[1]}" fill="#fff" font-family="Geist,system-ui,sans-serif" font-size="14" font-weight="700" text-anchor="middle" dominant-baseline="central" pointer-events="none">${path.step}</text>
        ${handles}
      </g>`;
    }).join('');
    const temporaryPoints = tool === 'curve' && previewPoint ? [...drawingPoints, previewPoint] : drawingPoints;
    const temporary = temporaryPoints.length > 1
      ? `<path d="${illustrationPathData(temporaryPoints, tool === 'curve')}" fill="none" stroke="#c8102e" stroke-width="3" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`
      : '';
    const grid = gridToggle.checked
      ? `<rect width="415" height="720" fill="url(#editor-grid)" pointer-events="none" />`
      : '';
    svg.innerHTML = `<defs>
      <marker id="editor-arrowhead" markerWidth="5" markerHeight="5" refX="4.2" refY="2.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 5 2.5 0 5Z" fill="context-stroke" /></marker>
      <filter id="editor-player-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#101820" flood-opacity="0.45" /></filter>
      <pattern id="editor-grid-small" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#0e2a57" stroke-opacity=".16" stroke-width=".6" /></pattern>
      <pattern id="editor-grid" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#editor-grid-small)" /><path d="M50 0H0V50" fill="none" stroke="#0e2a57" stroke-opacity=".3" stroke-width="1" /></pattern>
    </defs>
    <rect width="415" height="720" fill="#526f78" />
    <image href="${RINK_ASSET}" x="0" y="0" width="415" height="720" draggable="false" />
    ${grid}${selectedGuideMarkup}${pathMarkup}${playerMarkup}${puckMarkup}${pathOverlayMarkup}${temporary}${playerHitMarkup}${puckHitMarkup}`;
    finishButton.classList.toggle('hidden', tool !== 'curve');
    cancelButton.classList.toggle('hidden', tool !== 'curve');
    finishButton.disabled = drawingPoints.length < 2;
    undoButton.disabled = history.length === 0;
    redoButton.disabled = future.length === 0;
    viewportSelect.value = presetName();
    for (const key of Object.keys(viewportFields) as (keyof Viewport)[]) viewportFields[key].value = String(scene.viewport[key]);
    jsonInput.value = `${JSON.stringify(scene, null, 2)}\n`;
    renderSelection();
  };

  const loadSlug = (slug: string) => {
    const item = items.get(slug);
    if (!item) return;
    currentSlug = slug;
    clearSelection();
    history = [];
    future = [];
    drawingPoints = [];
    previewPoint = null;
    let restored = false;
    try {
      const draft = localStorage.getItem(sceneKey(slug));
      if (draft) {
        scene = parseScene(JSON.parse(draft), slug);
        restored = true;
      } else {
        scene = item.scene ? parseScene(clone(item.scene), slug) : newScene(slug);
      }
    } catch {
      scene = item.scene ? parseScene(clone(item.scene), slug) : newScene(slug);
    }
    preview.href = `/kombinasjoner/${slug}/`;
    if (item.diagram) {
      reference.src = item.diagram;
      reference.alt = `Eldre illustrasjon av ${item.name}`;
      referenceWrap.classList.remove('hidden');
    } else {
      reference.removeAttribute('src');
      referenceWrap.classList.add('hidden');
      referenceWrap.open = false;
    }
    setTool('select');
    render();
    announce(restored ? `Lokalt utkast for ${item.name} er gjenopprettet.` : `${item.name} er klar.`);
  };

  const undo = () => {
    const previous = history.pop();
    if (!previous) return;
    future.push(snapshot());
    scene = JSON.parse(previous) as IllustrationScene;
    clearSelection();
    saveDraft();
    render();
    announce('Siste endring er angret.');
  };
  const redo = () => {
    const next = future.pop();
    if (!next) return;
    history.push(snapshot());
    scene = JSON.parse(next) as IllustrationScene;
    clearSelection();
    saveDraft();
    render();
    announce('Endringen er gjort om.');
  };

  const deleteSelected = () => {
    if (!selectedPathId) return;
    const deleted = selectedPath()?.step;
    mutate(() => {
      scene.paths = scene.paths
        .filter((path) => path.id !== selectedPathId)
        .map((path, index) => ({ ...path, id: `step-${index + 1}`, step: index + 1 }));
      clearSelection();
    }, deleted ? `Pil ${deleted} er slettet.` : 'Pilen er slettet.');
  };

  const deleteSelectedPlayer = () => {
    const player = selectedPlayer();
    if (!player) return;
    mutate(() => {
      scene.players = scene.players.filter((candidate) => candidate.id !== player.id);
      clearSelection();
    }, 'Spilleren er slettet.');
  };

  const deletePuck = () => {
    if (!scene.puck) return;
    mutate(() => {
      scene.puck = null;
      clearSelection();
    }, 'Pucken er fjernet.');
  };

  svg.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    if (tool === 'line') {
      lineStart = point;
      previewPoint = point;
      svg.setPointerCapture(event.pointerId);
      render();
      return;
    }
    if (tool === 'curve') {
      drawingPoints.push(point);
      previewPoint = point;
      render();
      announce(drawingPoints.length === 1 ? 'Startpunkt lagt til. Legg til flere punkter og velg Fullfør pil.' : `${drawingPoints.length} punkter lagt til.`);
      return;
    }

    const target = event.target as Element;
    const playerElement = target.closest<SVGElement>('[data-player-id]');
    if (playerElement?.dataset.playerId) {
      selectPlayer(playerElement.dataset.playerId);
      drag = {
        type: 'player',
        playerId: playerElement.dataset.playerId,
        before: snapshot(),
        moved: false,
      };
      svg.setPointerCapture(event.pointerId);
      render();
      return;
    }
    if (target.closest<SVGElement>('[data-puck]') && scene.puck) {
      selectPuck();
      drag = { type: 'puck', before: snapshot(), moved: false };
      svg.setPointerCapture(event.pointerId);
      render();
      return;
    }
    const pathElement = target.closest<SVGElement>('[data-path-id]');
    if (!pathElement?.dataset.pathId) {
      clearSelection();
      render();
      return;
    }
    const pathId = pathElement.dataset.pathId;
    selectPath(pathId);
    const pointIndex = pathElement.dataset.pointIndex;
    if (pointIndex != null || pathElement.dataset.label === 'true') {
      drag = {
        type: 'path',
        pathId,
        pointIndex: pointIndex == null ? undefined : Number(pointIndex),
        label: pathElement.dataset.label === 'true',
        before: snapshot(),
        moved: false,
      };
      svg.setPointerCapture(event.pointerId);
    }
    render();
  });

  svg.addEventListener('pointermove', (event) => {
    const point = pointFromEvent(event);
    if (tool === 'line' && lineStart) {
      previewPoint = point;
      drawingPoints = [lineStart, point];
      render();
      return;
    }
    if (tool === 'curve' && drawingPoints.length) {
      previewPoint = point;
      render();
      return;
    }
    if (!drag) return;
    const activeDrag = drag;
    if (activeDrag.type === 'player') {
      const player = scene.players.find((candidate) => candidate.id === activeDrag.playerId);
      if (!player) return;
      player.position = snapPointToPlayerGuide(point, player.role);
    } else if (activeDrag.type === 'puck') {
      if (!scene.puck) return;
      scene.puck.position = point;
    } else {
      const path = scene.paths.find((candidate) => candidate.id === activeDrag.pathId);
      if (!path) return;
      if (activeDrag.label) path.label = point;
      else if (activeDrag.pointIndex != null) path.points[activeDrag.pointIndex] = point;
    }
    activeDrag.moved = true;
    render();
  });

  svg.addEventListener('pointerup', (event) => {
    if (tool === 'line' && lineStart && previewPoint) {
      svg.releasePointerCapture(event.pointerId);
      const start = lineStart;
      const end = previewPoint;
      lineStart = null;
      previewPoint = null;
      drawingPoints = [];
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) >= 5) addPath([start, end], false);
      else render();
      return;
    }
    if (drag) {
      svg.releasePointerCapture(event.pointerId);
      if (drag.moved) {
        history.push(drag.before);
        future = [];
        saveDraft();
        announce(drag.type === 'player' ? 'Spilleren er flyttet.' : drag.type === 'puck' ? 'Pucken er flyttet.' : 'Pilen er flyttet.');
      }
      drag = null;
      render();
    }
  });

  svg.addEventListener('pointercancel', () => {
    lineStart = null;
    drawingPoints = [];
    previewPoint = null;
    drag = null;
    render();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-editor-tool]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.editorTool as Tool));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-editor-add-player]').forEach((button) => {
    button.addEventListener('click', () => addPlayer(button.dataset.editorAddPlayer as IllustrationPlayerKind));
  });
  required<HTMLButtonElement>('[data-editor-add-puck]').addEventListener('click', addPuck);
  finishButton.addEventListener('click', finishCurve);
  cancelButton.addEventListener('click', cancelDrawing);
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  gridToggle.addEventListener('change', render);
  trickSelect.addEventListener('change', () => loadSlug(trickSelect.value));

  viewportSelect.addEventListener('change', () => {
    if (viewportSelect.value === 'custom') return;
    const preset = viewportPresets[viewportSelect.value as keyof typeof viewportPresets];
    mutate(() => { scene.viewport = { ...preset }; }, `Utsnitt endret til ${viewportSelect.selectedOptions[0]?.textContent ?? 'valgt utsnitt'}.`);
  });
  for (const field of Object.keys(viewportFields) as (keyof Viewport)[]) {
    viewportFields[field].addEventListener('change', () => {
      const values = Object.fromEntries(Object.entries(viewportFields).map(([key, input]) => [key, Number(input.value)])) as unknown as Viewport;
      values.x = clamp(values.x, 0, RINK_WIDTH - 1);
      values.y = clamp(values.y, 0, RINK_HEIGHT - 1);
      values.width = clamp(values.width, 1, RINK_WIDTH - values.x);
      values.height = clamp(values.height, 1, RINK_HEIGHT - values.y);
      mutate(() => { scene.viewport = values; }, 'Utsnittet er oppdatert.');
    });
  }

  required<HTMLButtonElement>('[data-editor-apply-selection]').addEventListener('click', () => {
    const path = selectedPath();
    if (!path) return;
    try {
      const points = pointsInput.value.split(/\n/).map((line) => {
        const values = line.split(',').map((value) => Number(value.trim()));
        if (values.length !== 2 || values.some((value) => !Number.isFinite(value))) throw new Error('Bruk formatet x, y – ett punkt per linje.');
        return [clamp(values[0], 0, RINK_WIDTH), clamp(values[1], 0, RINK_HEIGHT)] as IllustrationPoint;
      });
      if (points.length < 2) throw new Error('Pilen trenger minst to punkter.');
      const x = Number(labelX.value);
      const y = Number(labelY.value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Nummerplasseringen må ha gyldige tall.');
      mutate(() => {
        path.kind = kindSelect.value as IllustrationPath['kind'];
        path.points = points;
        path.label = [clamp(x, 0, RINK_WIDTH), clamp(y, 0, RINK_HEIGHT)];
      }, `Pil ${path.step} er oppdatert.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke oppdatere pilen.');
    }
  });
  required<HTMLButtonElement>('[data-editor-delete]').addEventListener('click', deleteSelected);

  required<HTMLButtonElement>('[data-editor-apply-player]').addEventListener('click', () => {
    const player = selectedPlayer();
    if (!player) return;
    const x = Number(playerX.value);
    const y = Number(playerY.value);
    const rotation = Number(playerRotation.value);
    const scale = Number(playerScale.value);
    if (![x, y, rotation, scale].every(Number.isFinite)) {
      announce('Spillerfeltene må inneholde gyldige tall.');
      return;
    }
    mutate(() => {
      player.kind = playerKind.value as IllustrationPlayerKind;
      const role = (playerRole.value || null) as IllustrationPlayer['role'];
      player.role = role;
      player.position = snapPointToPlayerGuide([clamp(x, 0, RINK_WIDTH), clamp(y, 0, RINK_HEIGHT)], role);
      player.rotation = clamp(rotation, -360, 360);
      player.scale = clamp(scale, 0.5, 1.5);
    }, 'Spilleren er oppdatert.');
  });
  required<HTMLButtonElement>('[data-editor-delete-player]').addEventListener('click', deleteSelectedPlayer);

  required<HTMLButtonElement>('[data-editor-apply-puck]').addEventListener('click', () => {
    if (!scene.puck) return;
    const x = Number(puckX.value);
    const y = Number(puckY.value);
    const radius = Number(puckRadius.value);
    if (![x, y, radius].every(Number.isFinite)) {
      announce('Puckfeltene må inneholde gyldige tall.');
      return;
    }
    mutate(() => {
      if (!scene.puck) return;
      scene.puck.position = [clamp(x, 0, RINK_WIDTH), clamp(y, 0, RINK_HEIGHT)];
      scene.puck.radius = clamp(radius, 3, 12);
    }, 'Pucken er oppdatert.');
  });
  required<HTMLButtonElement>('[data-editor-delete-puck]').addEventListener('click', deletePuck);

  const exportScene = () => parseScene(scene, currentSlug, false);
  required<HTMLButtonElement>('[data-editor-copy]').addEventListener('click', async () => {
    try {
      const text = `${JSON.stringify(exportScene(), null, 2)}\n`;
      await navigator.clipboard.writeText(text);
      announce('JSON er kopiert. Lim den inn i src/content/illustrations.');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke kopiere JSON.');
    }
  });
  required<HTMLButtonElement>('[data-editor-download]').addEventListener('click', () => {
    try {
      const text = `${JSON.stringify(exportScene(), null, 2)}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentSlug}.json`;
      link.click();
      URL.revokeObjectURL(url);
      announce(`${currentSlug}.json er lastet ned.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke laste ned JSON.');
    }
  });

  required<HTMLInputElement>('[data-editor-import]').addEventListener('change', async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = parseScene(JSON.parse(await file.text()), currentSlug);
      mutate(() => { scene = imported; clearSelection(); }, `${file.name} er importert.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke importere filen.');
    } finally {
      input.value = '';
    }
  });
  required<HTMLButtonElement>('[data-editor-apply-json]').addEventListener('click', () => {
    try {
      const imported = parseScene(JSON.parse(jsonInput.value), currentSlug);
      mutate(() => { scene = imported; clearSelection(); }, 'JSON-endringene er brukt.');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke bruke JSON.');
    }
  });
  required<HTMLButtonElement>('[data-editor-reset]').addEventListener('click', () => {
    if (!window.confirm('Forkaste det lokale utkastet for denne kombinasjonen?')) return;
    try { localStorage.removeItem(sceneKey(currentSlug)); } catch {}
    const item = items.get(currentSlug);
    scene = item?.scene ? parseScene(clone(item.scene), currentSlug) : newScene(currentSlug);
    clearSelection();
    history = [];
    future = [];
    render();
    announce('Det lokale utkastet er forkastet.');
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const editingText = target?.matches('input, textarea, select, [contenteditable="true"]');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (editingText) return;
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (editingText) return;
    if (event.key === 'Escape') {
      cancelDrawing();
      setTool('select');
    } else if (event.key === 'Enter' && tool === 'curve') {
      event.preventDefault();
      finishCurve();
    } else if (event.key.toLowerCase() === 'v') {
      setTool('select');
    } else if (event.key.toLowerCase() === 'l') {
      setTool('line');
    } else if (event.key.toLowerCase() === 'c') {
      setTool('curve');
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedPathId || selectedPlayerId || puckSelected)) {
      event.preventDefault();
      if (selectedPathId) deleteSelected();
      else if (selectedPlayerId) deleteSelectedPlayer();
      else deletePuck();
    } else if (selectedPlayerId && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      const player = selectedPlayer();
      if (!player) return;
      const amount = event.shiftKey ? 15 : 5;
      mutate(() => { player.rotation = clamp(player.rotation + (event.key === '[' ? -amount : amount), -360, 360); }, 'Spilleren er rotert.');
    } else if ((selectedPathId || selectedPlayerId || puckSelected) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const amount = event.shiftKey ? 5 : 1;
      const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      const path = selectedPath();
      const player = selectedPlayer();
      if (path) {
        mutate(() => {
          path.points = path.points.map(([x, y]) => [clamp(x + dx, 0, RINK_WIDTH), clamp(y + dy, 0, RINK_HEIGHT)]);
          path.label = [clamp(path.label[0] + dx, 0, RINK_WIDTH), clamp(path.label[1] + dy, 0, RINK_HEIGHT)];
        }, `Pil ${path.step} er flyttet.`);
      } else if (player) {
        mutate(() => {
          const nextPosition: IllustrationPoint = [
            clamp(player.position[0] + dx, 0, RINK_WIDTH),
            clamp(player.position[1] + dy, 0, RINK_HEIGHT),
          ];
          player.position = snapPointToPlayerGuide(nextPosition, player.role);
        }, 'Spilleren er flyttet.');
      } else if (puckSelected && scene.puck) {
        mutate(() => {
          if (!scene.puck) return;
          scene.puck.position = [clamp(scene.puck.position[0] + dx, 0, RINK_WIDTH), clamp(scene.puck.position[1] + dy, 0, RINK_HEIGHT)];
        }, 'Pucken er flyttet.');
      }
    }
  });

  loadSlug(currentSlug);
}

export function initializeIllustrationEditors() {
  document.querySelectorAll<HTMLElement>('[data-illustration-editor]').forEach(initializeEditor);
}
