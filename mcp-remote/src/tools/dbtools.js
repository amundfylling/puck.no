/**
 * Registration tools — native D1 binding (parameterized queries, real-D1
 * meta.changes). Same validation and duplicate protection as
 * functions/api/registrations.ts and the local MCP server (keep in sync!).
 * Contact data (email/phone) is always masked in output.
 */
import {
  assertEmail, assertPhone, assertSlug, maskEmail, maskPhone, ValidationError,
} from '../lib/validate.js';
import { getRankedPlayer, searchRanking } from '../lib/ranking.js';
import { requireTournament } from '../lib/tournamentConfig.js';

const publicRow = (r) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  country: r.country ?? '',
  worldRanking: r.world_ranking ?? null,
  playerId: r.player_id ?? null,
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

async function listRegistrations(env, { tournamentSlug, limit = 500 }) {
  assertSlug(tournamentSlug);
  const { results } = await env.DB.prepare(
    `SELECT id, type, name, country, world_ranking, player_id, created_at
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
  const isTeam = cfg.teamMin != null && cfg.teamMax != null;
  assertEmail(args.email);
  assertPhone(args.phone);
  const email = args.email.trim().toLowerCase();
  const phone = args.phone?.trim() || null;

  let name, country = null, wr = null, playerId = null, playerIdsJson = null;

  if (isTeam) {
    const ids = Array.isArray(args.playerIds) ? args.playerIds : null;
    const names = Array.isArray(args.names) ? args.names : null;
    if ((ids == null) === (names == null)) {
      throw new ValidationError('Lagturnering: oppgi enten playerIds ELLER names (ikke begge).');
    }
    const count = (ids ?? names).length;
    if (count < cfg.teamMin || count > cfg.teamMax) {
      throw new ValidationError(`Laget må ha mellom ${cfg.teamMin} og ${cfg.teamMax} spillere.`);
    }
    if (ids) {
      if (ids.some((v) => !Number.isInteger(v) || v <= 0)) throw new ValidationError('Ugyldig spiller-ID.');
      if (new Set(ids).size !== ids.length) throw new ValidationError('Samme spiller er valgt flere ganger.');
      const resolved = [];
      for (const id of ids) {
        const p = await getRankedPlayer(id);
        if (!p) throw new ValidationError(`Spiller-ID ${id} ble ikke funnet på verdensrankingen.`);
        resolved.push(p);
      }
      name = resolved.map((p) => p.name).join(' / ');
      playerIdsJson = JSON.stringify(ids);
    } else {
      const trimmed = names.map((n) => String(n).trim());
      if (trimmed.some((n) => !n)) throw new ValidationError('Spillernavn kan ikke være tomme.');
      const lower = trimmed.map((n) => n.toLowerCase());
      if (new Set(lower).size !== lower.length) throw new ValidationError('Samme spiller står flere ganger på laget.');
      name = trimmed.join(' / ');
    }
  } else {
    if (args.playerId == null && !args.name) throw new ValidationError('Oppgi playerId eller name.');
    if (args.playerId != null) {
      const p = await getRankedPlayer(args.playerId);
      if (!p) throw new ValidationError(`Spiller-ID ${args.playerId} ble ikke funnet på verdensrankingen.`);
      name = p.name;
      country = p.nation || null;
      wr = p.rank;
      playerId = p.id;
    } else {
      name = String(args.name).trim();
      if (!name || name.length > 500) throw new ValidationError('Ugyldig navn.');
    }
  }

  let changes, lastRowId;
  try {
    if (isTeam && playerIdsJson) {
      const ids = JSON.parse(playerIdsJson);
      const ph = ids.map(() => '?').join(', ');
      const res = await env.DB.prepare(
        `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id, player_ids)
         SELECT ?, 'team', ?, NULL, ?, ?, NULL, NULL, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM registrations r
           WHERE r.tournament_slug = ?
             AND (r.player_id IN (${ph}) OR (json_valid(r.player_ids) AND EXISTS (
               SELECT 1 FROM json_each(r.player_ids) je WHERE je.value IN (${ph})
             )))
         )`,
      ).bind(tournamentSlug, name, email, phone, playerIdsJson, tournamentSlug, ...ids, ...ids).run();
      ({ changes, last_row_id: lastRowId } = res.meta);
      if (changes === 0) throw new ValidationError('En av spillerne er allerede registrert i denne turneringen!');
    } else if (isTeam) {
      const res = await env.DB.prepare(
        `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id, player_ids)
         SELECT ?, 'team', ?, NULL, ?, ?, NULL, NULL, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM registrations r
           WHERE r.tournament_slug = ? AND r.type = 'team' AND lower(r.name) = ?
         )`,
      ).bind(tournamentSlug, name, email, phone, tournamentSlug, name.toLowerCase()).run();
      ({ changes, last_row_id: lastRowId } = res.meta);
      if (changes === 0) throw new ValidationError('Laget er allerede registrert i denne turneringen!');
    } else {
      const res = await env.DB.prepare(
        `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id, player_ids)
         VALUES (?, 'player', ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind(tournamentSlug, name, country, email, phone, wr, playerId).run();
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

  const targetIsTeam = target.teamMin != null;
  if ((row.type === 'team') !== targetIsTeam) {
    throw new ValidationError(
      targetIsTeam
        ? 'Kan ikke flytte en individuell påmelding til en lagturnering.'
        : 'Kan ikke flytte et lag til en individuell turnering.',
    );
  }
  if (row.type === 'team') {
    const teamSize = row.player_ids
      ? JSON.parse(row.player_ids).length
      : String(row.name).split(' / ').length;
    if (teamSize < target.teamMin || teamSize > target.teamMax) {
      throw new ValidationError(
        `Laget har ${teamSize} spillere; ${toTournamentSlug} krever ${target.teamMin}–${target.teamMax}.`,
      );
    }
  }

  const dupClauses = [];
  const dupBinds = [];
  if (row.player_id != null) {
    dupClauses.push('player_id = ?');
    dupBinds.push(row.player_id);
  }
  if (row.type === 'player') {
    dupClauses.push(`(type = 'player' AND player_id IS NULL AND lower(email) = lower(?))`);
    dupBinds.push(row.email);
  }
  if (row.player_ids) {
    const ids = JSON.parse(row.player_ids);
    const ph = ids.map(() => '?').join(', ');
    dupClauses.push(`player_id IN (${ph})`);
    dupClauses.push(`(json_valid(player_ids) AND EXISTS (SELECT 1 FROM json_each(player_ids) je WHERE je.value IN (${ph})))`);
    dupBinds.push(...ids, ...ids);
  }
  if (row.type === 'team') {
    dupClauses.push(`(type = 'team' AND lower(name) = lower(?))`);
    dupBinds.push(row.name);
  }
  if (dupClauses.length) {
    const { results: dups } = await env.DB.prepare(
      `SELECT id, name FROM registrations WHERE tournament_slug = ? AND (${dupClauses.join(' OR ')})`,
    ).bind(toTournamentSlug, ...dupBinds).all();
    if (dups.length) {
      throw new ValidationError(
        `Konflikt i målturneringen — allerede registrert der (id ${dups.map((d) => d.id).join(', ')}).`,
      );
    }
  }

  await env.DB.prepare('UPDATE registrations SET tournament_slug = ? WHERE id = ?')
    .bind(toTournamentSlug, args.id).run();
  return [
    `Flyttet påmelding ${args.id} (${row.name}) fra ${row.tournament_slug} til ${toTournamentSlug}.`,
    { id: args.id, from: row.tournament_slug, to: toTournamentSlug },
  ];
}

async function syncParticipantSnapshot(env) {
  const { results } = await env.DB.prepare(
    'SELECT tournament_slug, name, country, world_ranking FROM registrations',
  ).all();
  const tournaments = {};
  for (const r of results) {
    (tournaments[r.tournament_slug] ??= []).push({
      name: r.name,
      country: r.country ?? '',
      ...(r.world_ranking != null ? { world_ranking: String(r.world_ranking) } : {}),
    });
  }
  for (const list of Object.values(tournaments)) {
    list.sort((a, b) => {
      const aw = a.world_ranking != null ? Number(a.world_ranking) : Infinity;
      const bw = b.world_ranking != null ? Number(b.world_ranking) : Infinity;
      return aw - bw || a.name.localeCompare(b.name);
    });
  }
  const snapshot = {
    snapshot_date: new Date().toISOString().slice(0, 10),
    tournaments,
  };
  const { commitFiles } = await import('../github.js');
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
  return [`${hits.length} treff på «${query}» (rank, ITHF playerId, navn, klubb, nasjon).`, hits];
}

export const dbTools = [
  {
    name: 'list_registrations',
    title: 'List registrations',
    description: 'READ-ONLY (live D1). Registrations for a tournament — public fields only (id, name, country, world ranking).',
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
        playerIds: { type: 'array', items: { type: 'integer' }, description: 'Team tournaments: ranking ids' },
        names: { type: 'array', items: { type: 'string' }, description: 'Team tournaments: free-text names' },
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
    description: 'READ-ONLY (network). Search the live ITHF world ranking by name → rank, playerId, club, nation.',
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
