import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

export const RINK_WIDTH = 415;
export const RINK_HEIGHT = 720;

const GREEN_MINIMUM = 115;
const GREEN_SEPARATION = 25;

function isAnnotationGreen(red, green, blue) {
  return green > GREEN_MINIMUM
    && green - red > GREEN_SEPARATION
    && green - blue > GREEN_SEPARATION;
}

function connectedComponents(mask, width, height, minimumArea) {
  const seen = new Uint8Array(mask.length);
  const components = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start];
    const pixels = [];
    seen[start] = 1;

    while (queue.length) {
      const pixel = queue.pop();
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }

    if (pixels.length >= minimumArea) components.push(pixels);
  }

  return components;
}

// Zhang-Suen thinning turns each thick green annotation into a one-pixel graph.
function thin(source, width, height) {
  const result = source.slice();
  const valueAt = (x, y) => result[y * width + x];
  let changed = true;
  let iteration = 0;

  while (changed && iteration < 250) {
    changed = false;
    iteration += 1;
    for (let pass = 0; pass < 2; pass += 1) {
      const remove = [];
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          if (!valueAt(x, y)) continue;
          const p2 = valueAt(x, y - 1);
          const p3 = valueAt(x + 1, y - 1);
          const p4 = valueAt(x + 1, y);
          const p5 = valueAt(x + 1, y + 1);
          const p6 = valueAt(x, y + 1);
          const p7 = valueAt(x - 1, y + 1);
          const p8 = valueAt(x - 1, y);
          const p9 = valueAt(x - 1, y - 1);
          const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9];
          const count = neighbors.reduce((total, value) => total + value, 0);
          if (count < 2 || count > 6) continue;
          let transitions = 0;
          for (let index = 0; index < neighbors.length; index += 1) {
            if (!neighbors[index] && neighbors[(index + 1) % neighbors.length]) transitions += 1;
          }
          if (transitions !== 1) continue;
          if (pass === 0 && (p2 * p4 * p6 || p4 * p6 * p8)) continue;
          if (pass === 1 && (p2 * p4 * p8 || p2 * p6 * p8)) continue;
          remove.push(y * width + x);
        }
      }
      if (remove.length) {
        changed = true;
        for (const pixel of remove) result[pixel] = 0;
      }
    }
  }

  return result;
}

function graphFor(skeleton, width, height, component) {
  const pixels = new Set(component.filter((pixel) => skeleton[pixel]));
  const neighbors = (pixel) => {
    const result = [];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (pixels.has(next)) result.push(next);
      }
    }
    return result;
  };
  return { pixels, neighbors };
}

function pointFor(pixel, width) {
  return [pixel % width, Math.floor(pixel / width)];
}

function distanceBetween(left, right, width) {
  const [leftX, leftY] = pointFor(left, width);
  const [rightX, rightY] = pointFor(right, width);
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function shortestPath(start, end, neighbors) {
  const queue = [start];
  const previous = new Map([[start, null]]);
  for (let index = 0; index < queue.length && !previous.has(end); index += 1) {
    for (const next of neighbors(queue[index])) {
      if (!previous.has(next)) {
        previous.set(next, queue[index]);
        queue.push(next);
      }
    }
  }
  if (!previous.has(end)) return [];
  const path = [];
  for (let pixel = end; pixel != null; pixel = previous.get(pixel)) path.push(pixel);
  return path.reverse();
}

function distancesFrom(start, graph) {
  const queue = [start];
  const distances = new Map([[start, 0]]);
  for (let index = 0; index < queue.length; index += 1) {
    const pixel = queue[index];
    for (const next of graph.neighbors(pixel)) {
      if (!distances.has(next)) {
        distances.set(next, distances.get(pixel) + 1);
        queue.push(next);
      }
    }
  }
  return distances;
}

function tracedEndpoints(graph, width) {
  const endpoints = [...graph.pixels].filter((pixel) => graph.neighbors(pixel).length === 1);
  if (endpoints.length < 2) return [...graph.pixels].slice(0, 2);

  const junctions = [...graph.pixels].filter((pixel) => graph.neighbors(pixel).length >= 3);
  let bestArrow = null;
  for (const junction of junctions) {
    const distances = distancesFrom(junction, graph);
    const ranked = endpoints
      .map((endpoint) => ({ endpoint, distance: distances.get(endpoint) ?? Number.POSITIVE_INFINITY }))
      .filter((entry) => Number.isFinite(entry.distance))
      .sort((left, right) => left.distance - right.distance);
    if (ranked.length < 3) continue;
    const nearby = ranked.filter((entry) => entry.distance <= Math.max(55, width / 11));
    if (nearby.length < 2) continue;
    const furthest = ranked.at(-1);
    const score = furthest.distance - nearby.slice(0, 3).reduce((total, entry) => total + entry.distance, 0) / Math.min(3, nearby.length);
    if (!bestArrow || score > bestArrow.score) bestArrow = { junction, ranked, furthest, score };
  }

  if (bestArrow) {
    const start = bestArrow.furthest.endpoint;
    const stem = shortestPath(start, bestArrow.junction, graph.neighbors);
    const beforeJunction = pointFor(stem[Math.max(0, stem.length - Math.max(8, Math.round(width / 30)))], width);
    const junctionPoint = pointFor(bestArrow.junction, width);
    const forward = [junctionPoint[0] - beforeJunction[0], junctionPoint[1] - beforeJunction[1]];
    const forwardLength = Math.max(1, Math.hypot(forward[0], forward[1]));
    const tip = bestArrow.ranked
      .filter((entry) => entry.endpoint !== start && entry.distance <= Math.max(75, width / 8))
      .map((entry) => {
        const point = pointFor(entry.endpoint, width);
        const projection = ((point[0] - junctionPoint[0]) * forward[0] + (point[1] - junctionPoint[1]) * forward[1]) / forwardLength;
        return { ...entry, projection };
      })
      .sort((left, right) => right.projection - left.projection)[0]?.endpoint;
    if (tip != null) return [start, tip];
  }

  // The Euclidean diameter ignores the short side branches of an arrowhead.
  let pair = [endpoints[0], endpoints[1]];
  let longest = -1;
  for (let leftIndex = 0; leftIndex < endpoints.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < endpoints.length; rightIndex += 1) {
      const distance = distanceBetween(endpoints[leftIndex], endpoints[rightIndex], width);
      if (distance > longest) {
        longest = distance;
        pair = [endpoints[leftIndex], endpoints[rightIndex]];
      }
    }
  }
  return pair;
}

function closestPixelTo(point, pixels, width) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const pixel of pixels) {
    const candidate = pointFor(pixel, width);
    const distance = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
    if (distance < closestDistance) {
      closest = pixel;
      closestDistance = distance;
    }
  }
  return { pixel: closest, distance: closestDistance };
}

function arrowTipFrom(start, graph, width) {
  const endpoints = [...graph.pixels].filter((pixel) => graph.neighbors(pixel).length === 1);
  if (!endpoints.length) return null;
  const fromStart = distancesFrom(start, graph);
  const junctions = [...graph.pixels].filter((pixel) => graph.neighbors(pixel).length >= 3);
  let best = null;

  for (const junction of junctions) {
    const startDistance = fromStart.get(junction);
    if (startDistance == null || startDistance < 5) continue;
    const fromJunction = distancesFrom(junction, graph);
    const nearbyEndpoints = endpoints.filter((endpoint) => (fromJunction.get(endpoint) ?? Number.POSITIVE_INFINITY) <= Math.max(75, width / 8));
    if (nearbyEndpoints.length < 2) continue;
    const score = startDistance + nearbyEndpoints.length * width;
    if (!best || score > best.score) best = { junction, nearbyEndpoints, score };
  }

  if (!best) {
    return endpoints.sort((left, right) => (fromStart.get(right) ?? 0) - (fromStart.get(left) ?? 0))[0];
  }

  const stem = shortestPath(start, best.junction, graph.neighbors);
  const beforeJunction = pointFor(stem[Math.max(0, stem.length - Math.max(8, Math.round(width / 30)))], width);
  const junctionPoint = pointFor(best.junction, width);
  const forward = [junctionPoint[0] - beforeJunction[0], junctionPoint[1] - beforeJunction[1]];
  const forwardLength = Math.max(1, Math.hypot(forward[0], forward[1]));
  return best.nearbyEndpoints
    .map((endpoint) => {
      const point = pointFor(endpoint, width);
      const projection = ((point[0] - junctionPoint[0]) * forward[0] + (point[1] - junctionPoint[1]) * forward[1]) / forwardLength;
      return { endpoint, projection };
    })
    .sort((left, right) => right.projection - left.projection)[0].endpoint;
}

function perpendicularDistance(point, start, end) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared));
  const projectedX = start[0] + progress * deltaX;
  const projectedY = start[1] + progress * deltaY;
  return Math.hypot(point[0] - projectedX, point[1] - projectedY);
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let furthestDistance = 0;
  let furthestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points.at(-1));
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= tolerance) return [points[0], points.at(-1)];
  const left = simplify(points.slice(0, furthestIndex + 1), tolerance);
  const right = simplify(points.slice(furthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function traceComponent(component, mask, width, height, label, target) {
  const isolated = new Uint8Array(mask.length);
  for (const pixel of component) isolated[pixel] = 1;
  const skeleton = thin(isolated, width, height);
  const graph = graphFor(skeleton, width, height, component);
  let start;
  let end;
  if (label) {
    start = closestPixelTo(label, graph.pixels, width).pixel;
    const endpoints = [...graph.pixels].filter((pixel) => graph.neighbors(pixel).length === 1);
    end = closestPixelTo(target, endpoints.length ? endpoints : graph.pixels, width).pixel;
  } else {
    [start, end] = tracedEndpoints(graph, width);
  }
  if (start == null || end == null) return [];
  const pixels = shortestPath(start, end, graph.neighbors);
  const visiblePath = pixels
    .map((pixel) => pointFor(pixel, width))
    .filter((point, index) => index === pixels.length - 1 || !label || Math.hypot(point[0] - label[0], point[1] - label[1]) > width / 50);
  const points = label ? [label, ...visiblePath] : visiblePath;
  return simplify(points, Math.max(4, width / 150));
}

function rounded(value) {
  return Number(value.toFixed(1));
}

const labelReferences = {
  1: { file: '../../public/media/images/trick-nacka-2e6af9fd.png', center: [303, 341] },
  2: { file: '../../public/media/images/trick-nacka-2e6af9fd.png', center: [354, 315] },
  3: { file: '../../public/media/images/trick-agduro-e9ce4ae3.png', center: [326, 547] },
  4: { file: '../../public/media/images/trick-fakie-senter-karusell-d46b2d2c.png', center: [337, 318] },
};

const labelOverrides = new Map([
  // This one high-resolution WebP contains black step markers without digits.
  ['trick-fakie-invers-halv-agduro-8d975656.webp', [[327, 399], [317, 562], [98, 387]]],
]);

let labelTemplatePromise;
function labelTemplates() {
  labelTemplatePromise ??= Promise.all(Object.entries(labelReferences).map(async ([digit, reference]) => {
    const { data, info } = await sharp(fileURLToPath(new URL(reference.file, import.meta.url))).resize({ width: 600 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const samples = [];
    for (let offsetY = -11; offsetY <= 11; offsetY += 1) {
      for (let offsetX = -11; offsetX <= 11; offsetX += 1) {
        if (offsetX ** 2 + offsetY ** 2 > 115) continue;
        const x = reference.center[0] + offsetX;
        const y = reference.center[1] + offsetY;
        samples.push([offsetX, offsetY, data[y * info.width + x]]);
      }
    }
    return [Number(digit), samples];
  })).then((entries) => new Map(entries));
  return labelTemplatePromise;
}

async function detectLabels(rgbData, width, height, count) {
  const grayscale = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < grayscale.length; pixel += 1, offset += 3) {
    grayscale[pixel] = Math.round(rgbData[offset] * 0.299 + rgbData[offset + 1] * 0.587 + rgbData[offset + 2] * 0.114);
  }
  const candidates = [];
  const ring = [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, 6], [6, -6], [-6, -6]];
  for (let y = 12; y < height - 12; y += 1) {
    for (let x = 12; x < width - 12; x += 1) {
      const darkSamples = ring.reduce((total, [offsetX, offsetY]) => total + (grayscale[(y + offsetY) * width + x + offsetX] < 90 ? 1 : 0), 0);
      if (darkSamples >= 5) candidates.push([x, y]);
    }
  }

  const templates = await labelTemplates();
  const labels = [];
  for (let digit = 1; digit <= count; digit += 1) {
    const template = templates.get(digit);
    if (!template) throw new Error(`Legacy tracer only has templates for steps 1–${templates.size}`);
    let best = null;
    for (const [x, y] of candidates) {
      let error = 0;
      for (const [offsetX, offsetY, expected] of template) {
        const actual = grayscale[(y + offsetY) * width + x + offsetX];
        error += (actual - expected) ** 2;
      }
      error /= template.length;
      if (!best || error < best.error) best = { digit, point: [x, y], error };
    }
    labels.push(best);
  }
  return labels;
}

function assignLabels(components, labels, width) {
  const remaining = new Set(components.map((_, index) => index));
  return labels.map((label) => {
    let best = null;
    for (const index of remaining) {
      const match = closestPixelTo(label.point, components[index], width);
      if (!best || match.distance < best.distance) best = { index, distance: match.distance };
    }
    remaining.delete(best.index);
    return { ...label, component: components[best.index] };
  });
}

export async function traceLegacyIllustration(source) {
  const metadata = await sharp(source).metadata();
  const pipeline = metadata.width > 800 ? sharp(source).resize({ width: 600 }) : sharp(source);
  const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 3) {
    mask[pixel] = isAnnotationGreen(data[offset], data[offset + 1], data[offset + 2]) ? 1 : 0;
  }

  const scale = RINK_WIDTH / info.width;
  const minimumArea = 300 * (info.width / 600) ** 2;
  const components = connectedComponents(mask, info.width, info.height, minimumArea);
  const override = [...labelOverrides].find(([filename]) => String(source).endsWith(filename))?.[1];
  const detectedLabels = override
    ? override.map((point, index) => ({ digit: index + 1, point, error: 0 }))
    : await detectLabels(data, info.width, info.height, components.length);
  const labels = assignLabels(components, detectedLabels, info.width);
  const rawPaths = labels.map(({ component, point }, index) => {
    const target = labels[index + 1]?.point ?? [info.width / 2, 180 * info.width / 600];
    const traced = traceComponent(component, mask, info.width, info.height, point, target);
    if (labels[index + 1] && traced.length) traced[traced.length - 1] = [...labels[index + 1].point];
    return traced;
  })
    .filter((points) => points.length >= 2)
    .map((points) => points.map(([x, y]) => [rounded(x * scale), rounded(y * scale)]));

  return {
    viewport: {
      x: 0,
      y: 0,
      width: RINK_WIDTH,
      height: Math.min(RINK_HEIGHT, Math.round(info.height * scale)),
    },
    paths: rawPaths,
    labels: labels.map((label) => ({ step: label.digit, point: label.point.map((value) => rounded(value * scale)), error: rounded(label.error) })),
  };
}
