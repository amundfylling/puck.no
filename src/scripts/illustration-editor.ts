import {
  illustrationPathData,
  RINK_ASSET,
  RINK_HEIGHT,
  RINK_WIDTH,
  viewportPresets,
  type IllustrationPath,
  type IllustrationPoint,
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

interface DragState {
  pathId: string;
  pointIndex?: number;
  label?: boolean;
  before: string;
  moved: boolean;
}

const clone = <T>(value: T): T => structuredClone(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Number(value.toFixed(1));
const sceneKey = (slug: string) => `puck-illustration:${slug}:v1`;

function newScene(slug: string): IllustrationScene {
  return {
    slug,
    version: 1,
    rink: 'stiga-playoff-v1',
    viewport: { ...viewportPresets['offensive-zone'] },
    paths: [],
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
  const selection = required<HTMLElement>('[data-editor-selection]');
  const selectionEmpty = required<HTMLElement>('[data-editor-selection-empty]');
  const kindSelect = required<HTMLSelectElement>('[data-editor-kind]');
  const pointsInput = required<HTMLTextAreaElement>('[data-editor-points]');
  const labelX = required<HTMLInputElement>('[data-editor-label-x]');
  const labelY = required<HTMLInputElement>('[data-editor-label-y]');
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
      selectedPathId = `step-${step}`;
    }, `Pil ${step} lagt til.`);
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
    selection.classList.toggle('hidden', !path);
    selectionEmpty.classList.toggle('hidden', Boolean(path));
    if (!path) return;
    kindSelect.value = path.kind;
    pointsInput.value = path.points.map(([x, y]) => `${x}, ${y}`).join('\n');
    labelX.value = String(path.label[0]);
    labelY.value = String(path.label[1]);
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
    const pathMarkup = scene.paths.map((path) => {
      const style = pathStyle(path);
      const selected = path.id === selectedPathId;
      const handles = selected
        ? path.points.map(([x, y], index) => `<circle data-point-index="${index}" data-path-id="${path.id}" cx="${x}" cy="${y}" r="7" fill="#fff" stroke="#c8102e" stroke-width="2" vector-effect="non-scaling-stroke" />`).join('')
        : '';
      return `<g>
        <path data-path-id="${path.id}" d="${illustrationPathData(path.points, path.curve)}" fill="none" stroke="transparent" stroke-width="22" pointer-events="stroke" vector-effect="non-scaling-stroke" />
        <path d="${illustrationPathData(path.points, path.curve)}" fill="none" stroke="${style.stroke}" stroke-width="${style.width}" stroke-dasharray="${style.dash}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#editor-arrowhead)" vector-effect="non-scaling-stroke" pointer-events="none" />
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
      <pattern id="editor-grid-small" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#0e2a57" stroke-opacity=".16" stroke-width=".6" /></pattern>
      <pattern id="editor-grid" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#editor-grid-small)" /><path d="M50 0H0V50" fill="none" stroke="#0e2a57" stroke-opacity=".3" stroke-width="1" /></pattern>
    </defs>
    <rect width="415" height="720" fill="#526f78" />
    <image href="${RINK_ASSET}" x="0" y="0" width="415" height="720" draggable="false" />
    ${grid}${pathMarkup}${temporary}`;
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
    selectedPathId = null;
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
    selectedPathId = null;
    saveDraft();
    render();
    announce('Siste endring er angret.');
  };
  const redo = () => {
    const next = future.pop();
    if (!next) return;
    history.push(snapshot());
    scene = JSON.parse(next) as IllustrationScene;
    selectedPathId = null;
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
      selectedPathId = null;
    }, deleted ? `Pil ${deleted} er slettet.` : 'Pilen er slettet.');
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
    const pathElement = target.closest<SVGElement>('[data-path-id]');
    if (!pathElement?.dataset.pathId) {
      selectedPathId = null;
      render();
      return;
    }
    selectedPathId = pathElement.dataset.pathId;
    const pointIndex = pathElement.dataset.pointIndex;
    if (pointIndex != null || pathElement.dataset.label === 'true') {
      drag = {
        pathId: selectedPathId,
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
    const path = scene.paths.find((candidate) => candidate.id === drag?.pathId);
    if (!path) return;
    if (drag.label) path.label = point;
    else if (drag.pointIndex != null) path.points[drag.pointIndex] = point;
    drag.moved = true;
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
        announce('Pilen er flyttet.');
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
      mutate(() => { scene = imported; selectedPathId = null; }, `${file.name} er importert.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke importere filen.');
    } finally {
      input.value = '';
    }
  });
  required<HTMLButtonElement>('[data-editor-apply-json]').addEventListener('click', () => {
    try {
      const imported = parseScene(JSON.parse(jsonInput.value), currentSlug);
      mutate(() => { scene = imported; selectedPathId = null; }, 'JSON-endringene er brukt.');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Kunne ikke bruke JSON.');
    }
  });
  required<HTMLButtonElement>('[data-editor-reset]').addEventListener('click', () => {
    if (!window.confirm('Forkaste det lokale utkastet for denne kombinasjonen?')) return;
    try { localStorage.removeItem(sceneKey(currentSlug)); } catch {}
    const item = items.get(currentSlug);
    scene = item?.scene ? parseScene(clone(item.scene), currentSlug) : newScene(currentSlug);
    selectedPathId = null;
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
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPathId) {
      event.preventDefault();
      deleteSelected();
    } else if (selectedPathId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const amount = event.shiftKey ? 5 : 1;
      const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      const path = selectedPath();
      if (!path) return;
      mutate(() => {
        path.points = path.points.map(([x, y]) => [clamp(x + dx, 0, RINK_WIDTH), clamp(y + dy, 0, RINK_HEIGHT)]);
        path.label = [clamp(path.label[0] + dx, 0, RINK_WIDTH), clamp(path.label[1] + dy, 0, RINK_HEIGHT)];
      }, `Pil ${path.step} er flyttet.`);
    }
  });

  loadSlug(currentSlug);
}

export function initializeIllustrationEditors() {
  document.querySelectorAll<HTMLElement>('[data-illustration-editor]').forEach(initializeEditor);
}
