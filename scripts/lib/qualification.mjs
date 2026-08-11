const GUARANTEE_POINTS = new Map([
  [1, 600], [2, 550], [3, 500], [4, 450], [5, 400], [6, 350], [7, 300], [8, 260],
  [9, 230], [10, 210], [11, 200], [12, 190], [13, 180], [14, 170], [15, 160],
  [16, 150], [17, 140], [18, 130], [19, 120], [20, 110], [21, 100], [22, 94],
  [23, 88], [24, 82], [25, 76], [26, 70], [27, 64], [28, 58], [29, 52], [30, 46],
  [31, 40], [32, 36], [33, 32], [34, 28], [35, 24], [36, 20], [37, 16], [38, 12],
  [39, 8], [40, 4],
]);

export const QUALIFICATION_CATEGORIES = [
  { id: 'open', quota: 8 },
  { id: 'women', quota: 5 },
  { id: 'junior', quota: 5 },
  { id: 'veteran', quota: 5 },
  { id: 'kids', quota: 10 },
  { id: 'superveteran', quota: 5 },
];

const ENTITY_NAMES = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
};

export function decodeHtml(value) {
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return ENTITY_NAMES[code.toLowerCase()] ?? entity;
    const numeric = code[1].toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}

export function textFromHtml(value) {
  return decodeHtml(
    String(value ?? '')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

export function extractElementById(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html).match(
    new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'),
  );
  return match?.[2] ?? '';
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function extractRows(fragment) {
  return [...String(fragment).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
}

function linkFromHtml(value, type) {
  const match = String(value).match(new RegExp(`href=["']([^"']*${type}\\.aspx\\?[^"']*id=(\\d+)[^"']*)["']`, 'i'));
  return match ? { href: decodeHtml(match[1]), id: Number(match[2]) } : null;
}

export function parseIthfDate(value) {
  const match = String(value).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function parseCalendarHtml(html) {
  const fragment = extractElementById(html, 'LabTournaments');
  const tournaments = [];
  for (const row of extractRows(fragment)) {
    const cells = extractCells(row);
    if (cells.length !== 7) continue;
    const date = parseIthfDate(textFromHtml(cells[0]));
    const link = linkFromHtml(cells[1], 'tournament');
    if (!date || !link) continue;
    const city = textFromHtml(cells[3]);
    const country = city.match(/\(([A-Z]{3})\)\s*$/)?.[1] ?? null;
    tournaments.push({
      id: link.id,
      date,
      name: textFromHtml(cells[1]),
      city,
      country,
    });
  }
  return tournaments;
}

export function parsePlayerHtml(html, player) {
  const birthText = textFromHtml(extractElementById(html, 'LabBirth'));
  const birthYear = /^\d{4}$/.test(birthText) ? Number(birthText) : null;
  const rankText = textFromHtml(extractElementById(html, 'LabRank'));
  const fragment = extractElementById(html, 'LabTournaments');
  const results = [];

  for (const row of extractRows(fragment)) {
    const cells = extractCells(row);
    if (cells.length !== 7) continue;
    const date = parseIthfDate(textFromHtml(cells[0]));
    const link = linkFromHtml(cells[1], 'tournament');
    const position = Number.parseInt(textFromHtml(cells[5]), 10);
    const points = Number.parseInt(textFromHtml(cells[6]).replace(/\s/g, ''), 10);
    if (!date || !link || !Number.isInteger(position) || !Number.isFinite(points)) continue;
    const city = textFromHtml(cells[4]);
    results.push({
      tournamentId: link.id,
      date,
      name: textFromHtml(cells[1]).replace(/^\*\s*/, ''),
      country: city.match(/\(([A-Z]{3})\)\s*$/)?.[1] ?? null,
      position,
      ithfPoints: points,
    });
  }

  return {
    id: player.id,
    name: player.name,
    birthYear,
    isWoman: /(?:ladies|women) ranking/i.test(rankText),
    results,
  };
}

export function parseSharedThird(html) {
  const fragment = extractElementById(html, 'LabTable');
  let thirdPlaces = 0;
  for (const row of extractRows(fragment)) {
    const cells = extractCells(row);
    if (cells.length !== 7) continue;
    if (Number.parseInt(textFromHtml(cells[0]), 10) === 3) thirdPlaces += 1;
  }
  return thirdPlaces > 1;
}

export function classifyTournament(name) {
  const normalized = String(name).replace(/^\*\s*/, '').toLowerCase();
  if (/\b(kids?|u\s*-?\s*13)\b/.test(normalized)) return 'kids';
  if (/\b(super\s*-?\s*veterans?|superveterans?|55\s*\+)\b/.test(normalized)) return 'superveteran';
  if (/\b(women|ladies)\b/.test(normalized)) return 'women';
  if (/\bjuniors?\b/.test(normalized)) return 'junior';
  if (/\bveterans?\b/.test(normalized)) return 'veteran';
  return 'open';
}

export function isInternationalChampionship(name) {
  return /^(?:\*\s*)?(?:world|european) championships?\b/i.test(String(name).trim());
}

function playerEligible(player, categoryId) {
  if (categoryId === 'open') return true;
  if (categoryId === 'women') return player.isWoman;
  if (player.birthYear == null) return false;
  if (categoryId === 'junior') return player.birthYear >= 2009;
  if (categoryId === 'kids') return player.birthYear >= 2014;
  if (categoryId === 'veteran') return player.birthYear <= 1982;
  if (categoryId === 'superveteran') return player.birthYear <= 1972;
  return false;
}

function resultEligible(result, categoryId) {
  const resultCategory = classifyTournament(result.name);
  if (categoryId === 'open') return resultCategory === 'open';
  return resultCategory === 'open' || resultCategory === categoryId;
}

function compareResults(a, b) {
  return b.points - a.points || b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'en');
}

function scorePlayer(player, categoryId, tournamentMap, sharedThirdIds) {
  const eligible = player.results
    .filter((result) => tournamentMap.has(result.tournamentId))
    .map((result) => ({ ...result, ...tournamentMap.get(result.tournamentId) }))
    .filter((result) => !isInternationalChampionship(result.name) && resultEligible(result, categoryId))
    .map((result) => {
      const resultCategory = classifyTournament(result.name);
      const sharedThird = result.position === 3 && sharedThirdIds.has(result.tournamentId);
      const guarantee = result.country === 'NOR' && resultCategory === 'open'
        ? (sharedThird ? 475 : GUARANTEE_POINTS.get(result.position) ?? 0)
        : 0;
      return {
        tournamentId: result.tournamentId,
        name: result.name,
        date: result.date,
        position: result.position,
        points: Math.max(result.ithfPoints, guarantee),
        type: result.country === 'NOR' ? 'NBHF' : 'ITHF',
      };
    });

  const domestic = eligible.filter((result) => result.type === 'NBHF').sort(compareResults);
  const international = eligible.filter((result) => result.type === 'ITHF').sort(compareResults).slice(0, 3);
  const selected = [...domestic, ...international].sort(compareResults).slice(0, 8);
  const displayed = selected.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'NBHF' ? -1 : 1;
    return compareResults(a, b);
  });
  return {
    playerId: player.id,
    name: player.name,
    points: selected.reduce((sum, result) => sum + result.points, 0),
    results: displayed,
  };
}

export function buildQualificationData({ players, tournaments, sharedThirdIds, generatedAt }) {
  const tournamentMap = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  const categories = QUALIFICATION_CATEGORIES.map(({ id, quota }) => {
    const ranked = players
      .filter((player) => playerEligible(player, id))
      .map((player) => scorePlayer(player, id, tournamentMap, sharedThirdIds))
      .filter((player) => player.results.length > 0)
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'nb'))
      .map((player, index) => ({
        rank: index + 1,
        qualified: index < quota,
        ...player,
      }));
    return { id, quota, players: ranked };
  });

  return {
    version: 1,
    championship: {
      kind: 'world',
      year: 2027,
      location: 'Valmiera, Latvia',
      startsOn: '2027-06-11',
      endsOn: '2027-06-13',
      qualificationStartsOn: '2025-07-01',
      qualificationEndsOn: '2027-06-10',
    },
    generatedAt,
    categories,
  };
}

export function validateQualificationData(data) {
  if (!data || data.version !== 1 || data.championship?.year !== 2027 || !Array.isArray(data.categories)) {
    return false;
  }
  const expected = new Map(QUALIFICATION_CATEGORIES.map((category) => [category.id, category.quota]));
  if (data.categories.length !== expected.size) return false;
  const seenCategories = new Set();
  for (const category of data.categories) {
    if (seenCategories.has(category.id) || expected.get(category.id) !== category.quota || !Array.isArray(category.players)) {
      return false;
    }
    seenCategories.add(category.id);
    for (const player of category.players) {
      if (!Number.isInteger(player.rank) || typeof player.name !== 'string' || !Number.isFinite(player.points)) return false;
      if (!Number.isInteger(player.playerId) || !Array.isArray(player.results)) return false;
      if (player.qualified !== (player.rank <= category.quota) || player.results.length > 8) return false;
      if (player.results.filter((result) => result.type === 'ITHF').length > 3) return false;
      for (const result of player.results) {
        if (!Number.isInteger(result.tournamentId) || typeof result.name !== 'string' || typeof result.date !== 'string') {
          return false;
        }
        if (!Number.isInteger(result.position) || !Number.isFinite(result.points) || !['NBHF', 'ITHF'].includes(result.type)) {
          return false;
        }
      }
    }
  }
  return seenCategories.size === expected.size && typeof data.generatedAt === 'string';
}
