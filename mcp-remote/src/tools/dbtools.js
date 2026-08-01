/**
 * Registration tools — native D1 binding (parameterized queries, real-D1
 * meta.changes). Same validation and duplicate protection as
 * functions/api/registrations.ts and the local MCP server (keep in sync!).
 * Contact data (email/phone) is always masked in output.
 */
import {
  assertEmail, assertPhone, assertSlug, maskEmail, maskPhone, ValidationError,
} from '../lib/validate.js';
import { canonicalNameKey, getRankedPlayer, searchRanking } from '../lib/ranking.js';
import { requireTournament } from '../lib/tournamentConfig.js';

const publicRow = (r) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  country: r.country ?? '',
  club: r.club ?? '',
  worldRanking: r.world_ranking ?? null,
  rankingPoints: r.ranking_points ?? null,
  rankingValue: r.ranking_value ?? null,
  playerId: r.player_id ?? null,
  roster: r.roster ? JSON.parse(r.roster) : null,
  registeredAt: r.created_at,
});

const maskedRow = (r) => ({
  id: r.id,
  tournament: r.tournament_slug,
  type: r.type,
  name: r.name,
  email: maskEmail(r.email),
  phone: maskPhone(r.phone),
  registeredAt: r.created_at,
});

function registrationAnswers(config, values = {}) {
  const known = new Set((config.registrationQuestions ?? []).map((question) => question.id));
  for (const id of Object.keys(values ?? {})) {
    if (!known.has(id)) throw new ValidationError(`Ukjent tilleggsspørsmål «${id}».`);
  }
  const answers = [];
  for (const question of config.registrationQuestions ?? []) {
    const value = values?.[question.id];
    if (value == null || value === '') {
      if (question.required) throw new ValidationError(`Svar på «${question.labelNo}» er påkrevd.`);
      continue;
    }
    const option = question.options.find((candidate) => candidate.value === value);
    if (!option) throw new ValidationError(`Ugyldig svar på «${question.labelNo}».`);
    answers.push({
      questionId: question.id, questionLabelNo: question.labelNo, questionLabelEn: question.labelEn,
      value: option.value, labelNo: option.labelNo, labelEn: option.labelEn,
    });
  }
  return answers.length ? JSON.stringify(answers) : null;
}

async function listRegistrations(env, { tournamentSlug, limit = 500 }) {
  assertSlug(tournamentSlug);
  const { results } = await env.DB.prepare(
    `SELECT id, type, name, country, club, world_ranking, ranking_points, ranking_value, player_id, roster, created_at
     FROM registrations WHERE tournament_slug = ? ORDER BY id ASC LIMIT ?`,
  ).bind(tournamentSlug, Math.min(5000, limit | 0)).all();
  return [
    `${results.length} påmeldte i ${tournamentSlug} (kun offentlige felter — full eksport via /admin/pameldinger i nettleseren).`,
    results.map(publicRow),
  ];
}

async function countRegistrations(env, { tournamentSlug }) {
  if (tournamentSlug) {
    assertSlug(tournamentSlug);
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(type = 'team'), 0) AS teams
       FROM registrations WHERE tournament_slug = ?`,
    ).bind(tournamentSlug).all();
    return [`${results[0].n} påmeldinger i ${tournamentSlug} (hvorav ${results[0].teams} lag).`, results[0]];
  }
  const { results } = await env.DB.prepare(
    `SELECT tournament_slug AS slug, COUNT(*) AS n, COALESCE(SUM(type = 'team'), 0) AS teams
     FROM registrations GROUP BY tournament_slug ORDER BY n DESC`,
  ).all();
  const total = results.reduce((s, r) => s + r.n, 0);
  return [`${total} påmeldinger totalt, fordelt på ${results.length} turneringer.`, results];
}

async function addRegistration(env, args) {
  const { tournamentSlug } = args;
  assertSlug(tournamentSlug);
  const cfg = await requireTournament(env, tournamentSlug);
  const isTeam = cfg.playersPerTeam != null;
  assertEmail(args.email);
  assertPhone(args.phone);
  const email = args.email.trim().toLowerCase();
  const phone = args.phone?.trim() || null;
  const answersJson = registrationAnswers(cfg, args.answers);

  let name, country = null, club = null, wr = null, rankingPoints = 0, rankingValue = 0;
  let playerId = null, playerIdsJson = null, rosterJson = null;

  if (isTeam) {
    const sources = [args.players, args.playerIds, args.names].filter(Array.isArray);
    if (sources.length !== 1) throw new ValidationError('Lagturnering: oppgi players (anbefalt), playerIds eller names.');
    const entries = Array.isArray(args.players)
      ? args.players
      : Array.isArray(args.playerIds)
        ? args.playerIds.map((rankedId) => ({ playerId: rankedId }))
        : args.names.map((freeName) => ({ name: freeName }));
    const count = entries.length;
    const max = cfg.playersPerTeam + (cfg.maxSubstitutes ?? 0);
    if (count < cfg.playersPerTeam || count > max) {
      throw new ValidationError(`Laget må ha mellom ${cfg.playersPerTeam} og ${max} spillere.`);
    }
    const roster = [];
    for (const entry of entries) {
      const hasId = entry?.playerId != null;
      const freeName = String(entry?.name ?? '').trim();
      if (hasId === Boolean(freeName)) throw new ValidationError('Hver spiller må ha enten playerId eller name.');
      if (hasId) {
        if (!Number.isInteger(entry.playerId) || entry.playerId <= 0) throw new ValidationError('Ugyldig spiller-ID.');
        const p = await getRankedPlayer(entry.playerId);
        if (!p) throw new ValidationError(`Spiller-ID ${entry.playerId} ble ikke funnet på verdensrankingen.`);
        roster.push({ playerId: p.id, name: p.name, club: p.club || null, country: p.nation || null, worldRanking: p.rank, rankingPoints: p.points, rankingValue: p.value });
      } else {
        if (!freeName || freeName.length > 500) throw new ValidationError('Ugyldig spillernavn.');
        roster.push({ playerId: null, name: freeName, nameKey: canonicalNameKey(freeName), club: null, country: null, worldRanking: null, rankingPoints: 0, rankingValue: 0 });
      }
    }
    const ids = roster.flatMap((p) => p.playerId == null ? [] : [p.playerId]);
    const lower = roster.map((p) => canonicalNameKey(p.name));
    if (new Set(ids).size !== ids.length || new Set(lower).size !== lower.length) throw new ValidationError('Samme spiller er valgt flere ganger.');
    roster.sort((a, b) => b.rankingPoints - a.rankingPoints || (a.worldRanking ?? Infinity) - (b.worldRanking ?? Infinity));
    name = roster.map((p) => p.name).join(' / ');
    playerIdsJson = ids.length ? JSON.stringify(ids) : null;
    rosterJson = JSON.stringify(roster);
    rankingPoints = roster.slice(0, cfg.playersPerTeam).reduce((sum, p) => sum + p.rankingPoints, 0);
    wr = roster.find((p) => p.worldRanking != null)?.worldRanking ?? null;
  } else {
    if (args.playerId == null && !args.name) throw new ValidationError('Oppgi playerId eller name.');
    if (args.playerId != null) {
      const p = await getRankedPlayer(args.playerId);
      if (!p) throw new ValidationError(`Spiller-ID ${args.playerId} ble ikke funnet på verdensrankingen.`);
      name = p.name;
      country = p.nation || null;
      club = p.club || null;
      wr = p.rank;
      rankingPoints = p.points;
      rankingValue = p.value;
      playerId = p.id;
    } else {
      name = String(args.name).trim();
      if (!name || name.length > 500) throw new ValidationError('Ugyldig navn.');
    }
  }

  let changes, lastRowId;
  try {
    if (isTeam) {
      const roster = JSON.parse(rosterJson);
      const ids = roster.flatMap((player) => player.playerId == null ? [] : [player.playerId]);
      const unrankedNames = roster
        .filter((player) => player.playerId == null)
        .map((player) => canonicalNameKey(player.name));
      const clauses = [];
      const conflictBinds = [];
      if (ids.length) {
        const ph = ids.map(() => '?').join(', ');
        clauses.push(`r.player_id IN (${ph})`);
        conflictBinds.push(...ids);
        clauses.push(`(json_valid(r.player_ids) AND EXISTS (
          SELECT 1 FROM json_each(r.player_ids) legacy_ids WHERE legacy_ids.value IN (${ph})
        ))`);
        conflictBinds.push(...ids);
        clauses.push(`(json_valid(r.roster) AND EXISTS (
          SELECT 1 FROM json_each(r.roster) roster_ids
          WHERE json_extract(roster_ids.value, '$.playerId') IN (${ph})
        ))`);
        conflictBinds.push(...ids);
      }
      if (unrankedNames.length) {
        const ph = unrankedNames.map(() => '?').join(', ');
        clauses.push(`(json_valid(r.roster) AND EXISTS (
          SELECT 1 FROM json_each(r.roster) roster_keys
          WHERE json_extract(roster_keys.value, '$.playerId') IS NULL
            AND json_extract(roster_keys.value, '$.nameKey') IN (${ph})
        ))`);
        conflictBinds.push(...unrankedNames);
        clauses.push(`(json_valid(r.roster) AND EXISTS (
          SELECT 1 FROM json_each(r.roster) roster_names
          WHERE json_extract(roster_names.value, '$.playerId') IS NULL
            AND lower(json_extract(roster_names.value, '$.name')) IN (${ph})
        ))`);
        conflictBinds.push(...unrankedNames);
      }
      clauses.push(`(r.type = 'team' AND lower(r.name) = ?)`);
      conflictBinds.push(name.toLowerCase());
      const res = await env.DB.prepare(
        `INSERT INTO registrations (tournament_slug, type, name, country, club, email, phone, world_ranking, ranking_points, ranking_value, player_id, player_ids, roster, answers)
         SELECT ?, 'team', ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM registrations r
           WHERE r.tournament_slug = ?
             AND (${clauses.join(' OR ')})
         )`,
      ).bind(
        tournamentSlug, name, email, phone, wr, rankingPoints,
        playerIdsJson, rosterJson, answersJson, tournamentSlug, ...conflictBinds,
      ).run();
      ({ changes, last_row_id: lastRowId } = res.meta);
      if (changes === 0) throw new ValidationError('En av spillerne er allerede registrert i denne turneringen!');
    } else {
      const res = await env.DB.prepare(
        `INSERT INTO registrations (tournament_slug, type, name, country, club, email, phone, world_ranking, ranking_points, ranking_value, player_id, player_ids, roster, answers)
         VALUES (?, 'player', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      ).bind(tournamentSlug, name, country, club, email, phone, wr, rankingPoints, rankingValue, playerId, answersJson).run();
      ({ last_row_id: lastRowId } = res.meta);
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    if (/UNIQUE constraint failed/i.test(err.message)) {
      throw new ValidationError('Spilleren er allerede registrert (e-post eller ranking-ID).');
    }
    throw err;
  }

  const closed = cfg.registrationOpen === false;
  return [
    `Registrert: ${name} i ${tournamentSlug} (id ${lastRowId}).` +
      (closed ? ' Merk: påmeldingen for denne turneringen er STENGT for publikum — dette er en manuell admin-påmelding.' : ''),
    { id: lastRowId, tournamentSlug, name, email: maskEmail(email), registrationClosedForPublic: closed },
  ];
}

async function findRows(env, args) {
  if (args.id != null) {
    return (await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(args.id).all()).results;
  }
  if (args.email && args.tournamentSlug) {
    assertSlug(args.tournamentSlug);
    return (
      await env.DB.prepare(
        'SELECT * FROM registrations WHERE tournament_slug = ? AND lower(email) = ?',
      ).bind(args.tournamentSlug, args.email.trim().toLowerCase()).all()
    ).results;
  }
  throw new ValidationError('Oppgi enten id, eller email + tournamentSlug.');
}

async function deleteRegistration(env, args) {
  const dryRun = args.dryRun !== false;
  const rows = await findRows(env, args);
  if (rows.length === 0) return ['Fant ingen påmelding som matcher — ingenting slettet.', { deleted: 0 }];
  if (dryRun) {
    return [
      `DRY RUN — ville slettet ${rows.length} påmelding(er). Kjør igjen med dryRun: false for å utføre.`,
      rows.map(maskedRow),
    ];
  }
  const ids = rows.map((r) => r.id);
  const res = await env.DB.prepare(
    `DELETE FROM registrations WHERE id IN (${ids.map(() => '?').join(', ')})`,
  ).bind(...ids).run();
  return [`Slettet ${res.meta.changes} påmelding(er).`, { deleted: res.meta.changes, rows: rows.map(maskedRow) }];
}

async function updateRegistration(env, args) {
  const rows = await findRows(env, { id: args.id });
  if (rows.length === 0) throw new ValidationError(`Fant ikke påmelding med id ${args.id}.`);
  const row = rows[0];
  const sets = [];
  const binds = [];
  const changes = {};
  if (args.name !== undefined) {
    const n = String(args.name).trim();
    if (!n || n.length > 500) throw new ValidationError('Ugyldig navn.');
    sets.push('name = ?');
    binds.push(n);
    changes.name = { from: row.name, to: n };
  }
  if (args.email !== undefined) {
    assertEmail(args.email);
    sets.push('email = ?');
    binds.push(args.email.trim().toLowerCase());
    changes.email = { from: maskEmail(row.email), to: maskEmail(args.email) };
  }
  if (args.phone !== undefined) {
    assertPhone(args.phone);
    sets.push('phone = ?');
    binds.push(args.phone?.trim() || null);
    changes.phone = { from: maskPhone(row.phone), to: maskPhone(args.phone) };
  }
  if (sets.length === 0) throw new ValidationError('Ingen felt å oppdatere (name/email/phone).');
  try {
    await env.DB.prepare(`UPDATE registrations SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, args.id).run();
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err.message)) {
      throw new ValidationError('E-posten er allerede i bruk av en annen påmelding i denne turneringen.');
    }
    throw err;
  }
  return [`Oppdaterte påmelding ${args.id}.`, changes];
}

async function moveRegistration(env, args) {
  const { toTournamentSlug } = args;
  assertSlug(toTournamentSlug);
  const target = await requireTournament(env, toTournamentSlug);
  const rows = await findRows(env, { id: args.id });
  if (rows.length === 0) throw new ValidationError(`Fant ikke påmelding med id ${args.id}.`);
  const row = rows[0];
  if (row.tournament_slug === toTournamentSlug) {
    throw new ValidationError('Påmeldingen er allerede i den turneringen.');
  }

  const targetIsTeam = target.playersPerTeam != null;
  if ((row.type === 'team') !== targetIsTeam) {
    throw new ValidationError(
      targetIsTeam
        ? 'Kan ikke flytte en individuell påmelding til en lagturnering.'
        : 'Kan ikke flytte et lag til en individuell turnering.',
    );
  }
  const answersJson = registrationAnswers(target, args.answers);
  if (row.type === 'team') {
    let roster;
    try {
      roster = row.roster ? JSON.parse(row.roster) : null;
    } catch {
      roster = null;
    }
    if (!Array.isArray(roster)) {
      const ids = row.player_ids ? JSON.parse(row.player_ids) : [];
      const names = String(row.name).split(/\s+\/\s+|\s*,\s*/).filter(Boolean);
      roster = [];
      for (let index = 0; index < Math.max(ids.length, names.length); index++) {
        if (Number.isInteger(ids[index])) {
          const player = await getRankedPlayer(ids[index]);
          if (!player) throw new ValidationError(`Spiller-ID ${ids[index]} ble ikke funnet på verdensrankingen.`);
          roster.push({ playerId: player.id, name: player.name, club: player.club || null, country: player.nation || null, worldRanking: player.rank, rankingPoints: player.points, rankingValue: player.value });
        } else if (names[index]) {
          roster.push({ playerId: null, name: names[index], nameKey: canonicalNameKey(names[index]), club: null, country: null, worldRanking: null, rankingPoints: 0, rankingValue: 0 });
        }
      }
    }
    roster = roster.map((player) => player.playerId == null
      ? { ...player, nameKey: canonicalNameKey(player.name) }
      : player);
    const teamSize = roster.length;
    const targetMax = target.playersPerTeam + (target.maxSubstitutes ?? 0);
    if (teamSize < target.playersPerTeam || teamSize > targetMax) {
      throw new ValidationError(
        `Laget har ${teamSize} spillere; ${toTournamentSlug} krever ${target.playersPerTeam}–${targetMax}.`,
      );
    }
    roster.sort((a, b) =>
      Number(b.rankingPoints ?? 0) - Number(a.rankingPoints ?? 0) ||
      (a.worldRanking ?? Infinity) - (b.worldRanking ?? Infinity) ||
      String(a.name).localeCompare(String(b.name), 'nb-NO'));
    const ids = roster.flatMap((player) => Number.isInteger(player.playerId) ? [player.playerId] : []);
    const unrankedKeys = roster
      .filter((player) => player.playerId == null)
      .map((player) => canonicalNameKey(player.name));
    const dupClauses = [];
    const dupBinds = [];
    if (ids.length) {
    const ph = ids.map(() => '?').join(', ');
    dupClauses.push(`player_id IN (${ph})`);
    dupClauses.push(`(json_valid(player_ids) AND EXISTS (SELECT 1 FROM json_each(player_ids) je WHERE je.value IN (${ph})))`);
      dupClauses.push(`(json_valid(roster) AND EXISTS (
        SELECT 1 FROM json_each(roster) je WHERE json_extract(je.value, '$.playerId') IN (${ph})
      ))`);
      dupBinds.push(...ids, ...ids, ...ids);
    }
    if (unrankedKeys.length) {
      const ph = unrankedKeys.map(() => '?').join(', ');
      dupClauses.push(`(json_valid(roster) AND EXISTS (
        SELECT 1 FROM json_each(roster) je
        WHERE json_extract(je.value, '$.playerId') IS NULL
          AND json_extract(je.value, '$.nameKey') IN (${ph})
      ))`);
      dupClauses.push(`(json_valid(roster) AND EXISTS (
        SELECT 1 FROM json_each(roster) je
        WHERE json_extract(je.value, '$.playerId') IS NULL
          AND lower(json_extract(je.value, '$.name')) IN (${ph})
      ))`);
      dupBinds.push(...unrankedKeys, ...unrankedKeys);
    }
    dupClauses.push('(type = \'team\' AND lower(name) = lower(?))');
    dupBinds.push(roster.map((player) => player.name).join(' / '));
    const displayName = roster.map((player) => player.name).join(' / ');
    const rankingPoints = roster.slice(0, target.playersPerTeam)
      .reduce((sum, player) => sum + Number(player.rankingPoints ?? 0), 0);
    const worldRanking = roster.find((player) => player.worldRanking != null)?.worldRanking ?? null;
    const result = await env.DB.prepare(
      `UPDATE registrations
       SET tournament_slug = ?, name = ?, world_ranking = ?, ranking_points = ?, ranking_value = NULL,
           player_ids = ?, roster = ?, answers = ?
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM registrations WHERE tournament_slug = ? AND (${dupClauses.join(' OR ')})
       )`,
    ).bind(
      toTournamentSlug, displayName, worldRanking, rankingPoints,
      ids.length ? JSON.stringify(ids) : null, JSON.stringify(roster), answersJson,
      args.id, toTournamentSlug, ...dupBinds,
    ).run();
    if (result.meta.changes !== 1) {
      throw new ValidationError('Konflikt i målturneringen — en av spillerne er allerede registrert der.');
    }
  } else {
    try {
      const result = await env.DB.prepare(
        'UPDATE registrations SET tournament_slug = ?, answers = ? WHERE id = ?',
      ).bind(toTournamentSlug, answersJson, args.id).run();
      if (result.meta.changes !== 1) throw new ValidationError('Påmeldingen kunne ikke flyttes.');
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error.message)) {
        throw new ValidationError('Spilleren er allerede registrert i målturneringen.');
      }
      throw error;
    }
  }
  return [
    `Flyttet påmelding ${args.id} (${row.name}) fra ${row.tournament_slug} til ${toTournamentSlug}.`,
    { id: args.id, from: row.tournament_slug, to: toTournamentSlug },
  ];
}

async function syncParticipantSnapshot(env) {
  const { results } = await env.DB.prepare(
    'SELECT tournament_slug, type, name, country, club, world_ranking, ranking_points, ranking_value, roster FROM registrations',
  ).all();
  const tournaments = {};
  for (const r of results) {
    (tournaments[r.tournament_slug] ??= []).push({
      name: r.name,
      country: r.country ?? '',
      type: r.type,
      ...(r.club ? { club: r.club } : {}),
      ...(r.world_ranking != null ? { world_ranking: String(r.world_ranking) } : {}),
      ...(r.ranking_points != null ? { ranking_points: r.ranking_points } : {}),
      ...(r.ranking_value != null ? { ranking_value: r.ranking_value } : {}),
      ...(r.roster ? { roster: JSON.parse(r.roster) } : {}),
    });
  }
  for (const list of Object.values(tournaments)) {
    list.sort((a, b) => {
      const ap = a.ranking_points ?? -1;
      const bp = b.ranking_points ?? -1;
      const aw = a.world_ranking != null ? Number(a.world_ranking) : Infinity;
      const bw = b.world_ranking != null ? Number(b.world_ranking) : Infinity;
      return bp - ap || aw - bw || a.name.localeCompare(b.name);
    });
  }
  const snapshot = {
    snapshot_date: new Date().toISOString().slice(0, 10),
    tournaments,
  };
  const { commitFiles, withGitSnapshot } = await import('../github.js');
  env = await withGitSnapshot(env);
  const { commitSha, url } = await commitFiles(env, {
    message: 'chore(data): sync registrations snapshot from D1 (via remote MCP)',
    files: [{ path: 'src/data/registrations-snapshot.json', text: JSON.stringify(snapshot, null, 1) + '\n' }],
  });
  return [
    `Snapshot oppdatert (${results.length} påmeldte, ${Object.keys(tournaments).length} turneringer) og committet til main (${commitSha}: ${url}). ` +
      'Den statiske deltakerlisten oppdateres ved neste bygg (siden hydrerer uansett live fra API-et).',
    { registrations: results.length, tournaments: Object.keys(tournaments).length, commit: url },
  ];
}

async function rankingLookup(_env, { query, limit = 10 }) {
  const hits = await searchRanking(query, limit);
  if (hits.length === 0) return [`Ingen treff på «${query}» på verdensrankingen.`, []];
  return [`${hits.length} treff på «${query}» (rank, ITHF playerId, navn, klubb, nasjon, poeng og Player_Value).`, hits];
}

export const dbTools = [
  {
    name: 'list_registrations',
    title: 'List registrations',
    description: 'READ-ONLY (live D1). Registrations for a tournament — public fields only (id, name, country, world ranking, ranking points and Player_Value).',
    inputSchema: {
      type: 'object',
      properties: {
        tournamentSlug: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 5000 },
      },
      required: ['tournamentSlug'],
    },
    run: listRegistrations,
  },
  {
    name: 'count_registrations',
    title: 'Count registrations',
    description: 'READ-ONLY (live D1). Registration counts, per tournament or for one tournament.',
    inputSchema: {
      type: 'object',
      properties: { tournamentSlug: { type: 'string' } },
    },
    run: countRegistrations,
  },
  {
    name: 'add_registration',
    title: 'Add registration (manual)',
    description:
      'WRITES LIVE D1. Manually register a player/team (walk-ins, late sign-ups). Same validation and duplicate protection as the public API. Team tournaments: playerIds (ITHF ranking ids — find them with ranking_lookup) or free-text names. Individual: playerId or name.',
    inputSchema: {
      type: 'object',
      properties: {
        tournamentSlug: { type: 'string' },
        email: { type: 'string', description: 'Contact email (stored once per registration)' },
        phone: { type: 'string' },
        playerId: { type: 'integer', description: 'ITHF ranking id (individual tournaments)' },
        name: { type: 'string', description: 'Free-text name for unranked players' },
        players: {
          type: 'array',
          items: { type: 'object', properties: { playerId: { type: 'integer' }, name: { type: 'string' } } },
          description: 'Team tournaments: mixed roster; each entry has playerId OR free-text name',
        },
        playerIds: { type: 'array', items: { type: 'integer' }, description: 'Team tournaments: ranking ids' },
        names: { type: 'array', items: { type: 'string' }, description: 'Team tournaments: free-text names' },
        answers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Custom question id -> selected option value' },
      },
      required: ['tournamentSlug', 'email'],
    },
    run: addRegistration,
  },
  {
    name: 'delete_registration',
    title: 'Delete registration',
    description:
      'DESTRUCTIVE (live D1), dry-run by default. Identify by id OR email+tournamentSlug. First call previews; call again with dryRun: false to delete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        email: { type: 'string' },
        tournamentSlug: { type: 'string' },
        dryRun: { type: 'boolean', description: 'Default true = preview only' },
      },
    },
    run: deleteRegistration,
  },
  {
    name: 'update_registration',
    title: 'Update registration',
    description: 'WRITES LIVE D1. Fix name/email/phone on an existing registration (by id).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['id'],
    },
    run: updateRegistration,
  },
  {
    name: 'move_registration',
    title: 'Move registration',
    description:
      'WRITES LIVE D1. Move a registration to another tournament (e.g. wrong NM class). Validates type compatibility, team size and duplicates in the target.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        toTournamentSlug: { type: 'string' },
        answers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Answers required by the target tournament' },
      },
      required: ['id', 'toTournamentSlug'],
    },
    run: moveRegistration,
  },
  {
    name: 'sync_participant_snapshot',
    title: 'Sync participant snapshot',
    description:
      'READS live D1, WRITES GIT (commit to main). Regenerates src/data/registrations-snapshot.json (public fields only) from the live database.',
    inputSchema: { type: 'object', properties: {} },
    run: syncParticipantSnapshot,
  },
  {
    name: 'ranking_lookup',
    title: 'ITHF ranking lookup',
    description: 'READ-ONLY (network). Search the live ITHF world ranking by name → rank, playerId, club, nation, points and Player_Value.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name (substring, case-insensitive)' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    run: rankingLookup,
  },
];
