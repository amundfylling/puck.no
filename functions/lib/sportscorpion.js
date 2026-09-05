function decodeHtmlText(fragment) {
  return fragment
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse the server-rendered stage table on a SportScorpion tournament page. */
export function parseSportScorpionStages(html) {
  const table = html.match(
    /<table\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bstages-table\b)[^>]*>([\s\S]*?)<\/table>/i,
  )?.[1];
  if (!table) return [];

  const stages = [];
  const seen = new Set();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = row[1];
    const id = Number(rowHtml.match(/\/eng\/tournament\/stage\/(\d+)\//i)?.[1]);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;

    const type = /\/eng\/tournament\/stage\/\d+\/draws\//i.test(rowHtml)
      ? 'bracket'
      : /\/eng\/tournament\/stage\/\d+\/results\//i.test(rowHtml)
        ? 'table'
        : null;
    if (!type) continue;

    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    const name = cells[1] ? decodeHtmlText(cells[1][1]) : '';
    if (!name || name.length > 160) continue;

    seen.add(id);
    stages.push({ id, name, type });
  }
  return stages;
}

export function isSportScorpionStageArray(value) {
  return Array.isArray(value) &&
    value.length <= 100 &&
    value.every((stage) =>
      Number.isInteger(stage?.id) &&
      stage.id > 0 &&
      typeof stage.name === 'string' &&
      stage.name.length > 0 &&
      stage.name.length <= 160 &&
      (stage.type === 'bracket' || stage.type === 'table'),
    );
}

export function validateSportScorpionSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([tournamentId, stages]) =>
    /^\d+$/.test(tournamentId) && isSportScorpionStageArray(stages),
  );
}
