/**
 * Registration tools (D1 plane — these touch the LIVE production database
 * via wrangler). Reads return public fields only; contact data (email/phone)
 * is masked in chat output and only ever written to a git-ignored local
 * file by export_registrations. Destructive tools are dry-run by default.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { PATHS } from '../lib/config.js';
import { d1, d1Select, sqlValue } from '../lib/d1.js';
import { getRankedPlayer, searchRanking } from '../lib/ranking.js';
import {
  assertEmail, assertPhone, assertSlug, maskEmail, maskPhone, readTournamentConfig,
  ValidationError,
} from '../lib/validate.js';
import { ensureClean, commitFiles } from '../lib/git.js';
import { ok, tool } from '../lib/respond.js';

const cfg = readTournamentConfig;

function knownSlug(slug) {
  assertSlug(slug);
  if (!cfg()[slug]) throw new ValidationError(`Ukjent turnering «${slug}» (ikke i tournament-config.json).`);
  return cfg()[slug];
}

const publicRow = (r) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  country: r.country ?? '',
  worldRanking: r.world_ranking ?? null,
  playerId: r.player_id ?? null,
  registeredAt: r.created_at,
});

async function listRegistrations(args) {
  const { tournamentSlug, limit = 500 } = args;
  knownSlug(tournamentSlug);
  const rows = await d1Select(
    `SELECT id, type, name, country, world_ranking, player_id, created_at
     FROM registrations WHERE tournament_slug = ${sqlValue(tournamentSlug)}
     ORDER BY id ASC LIMIT ${Number(limit) | 0}`,
  );
  return ok(
    `${rows.length} påmeldte i ${tournamentSlug} (kun offentlige felter — bruk export_registrations for full kontaktinfo).`,
    rows.map(publicRow),
  );
}

async function countRegistrations(args) {
  if (args.tournamentSlug) {
    knownSlug(args.tournamentSlug);
    const rows = await d1Select(
      `SELECT COUNT(*) AS n, COALESCE(SUM(type = 'team'), 0) AS teams
       FROM registrations WHERE tournament_slug = ${sqlValue(args.tournamentSlug)}`,
    );
    return ok(`${rows[0].n} påmeldinger i ${args.tournamentSlug} (hvorav ${rows[0].teams} lag).`, rows[0]);
  }
  const rows = await d1Select(
    `SELECT tournament_slug AS slug, COUNT(*) AS n, COALESCE(SUM(type = 'team'), 0) AS teams
     FROM registrations GROUP BY tournament_slug ORDER BY n DESC`,
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  return ok(`${total} påmeldinger totalt, fordelt på ${rows.length} turneringer.`, rows);
}

/**
 * Mirror of functions/api/registrations.ts validation + dedup (keep in
 * sync!). Turnstile is skipped — this is an operator tool, not a public
 * endpoint. Registration-closed is NOT enforced (manual adds are exactly
 * what you do after closing), but we say when it applies.
 */
async function addRegistration(args) {
  const { tournamentSlug } = args;
  const config = knownSlug(tournamentSlug);
  const isTeam = config.teamMin != null && config.teamMax != null;
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
    if (count < config.teamMin || count > config.teamMax) {
      throw new ValidationError(`Laget må ha mellom ${config.teamMin} og ${config.teamMax} spillere.`);
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

  async function insertRegistration() {
    try {
      if (isTeam && playerIdsJson) {
        const ids = JSON.parse(playerIdsJson);
        const inList = ids.map(sqlValue).join(', ');
        await d1(
          `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id, player_ids)
           SELECT ${sqlValue(tournamentSlug)}, 'team', ${sqlValue(name)}, NULL, ${sqlValue(email)}, ${sqlValue(phone)}, NULL, NULL, ${sqlValue(playerIdsJson)}
           WHERE NOT EXISTS (
             SELECT 1 FROM registrations r
             WHERE r.tournament_slug = ${sqlValue(tournamentSlug)}
               AND (r.player_id IN (${inList}) OR (json_valid(r.player_ids) AND EXISTS (
                 SELECT 1 FROM json_each(r.player_ids) je WHERE je.value IN (${inList})
               )))
           )`,
        );
      } else if (isTeam) {
        await d1(
          `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id, player_ids)
           SELECT ${sqlValue(tournamentSlug)}, 'team', ${sqlValue(name)}, NULL, ${sqlValue(email)}, ${sqlValue(phone)}, NULL, NULL, NULL
           WHERE NOT EXISTS (
             SELECT 1 FROM registrations r
             WHERE r.tournament_slug = ${sqlValue(tournamentSlug)} AND r.type = 'team' AND lower(r.name) = ${sqlValue(name.toLowerCase())}
           )`,
        );
      } else {
        await d1(
          `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id, player_ids)
           VALUES (${sqlValue(tournamentSlug)}, 'player', ${sqlValue(name)}, ${sqlValue(country)}, ${sqlValue(email)}, ${sqlValue(phone)}, ${sqlValue(wr)}, ${sqlValue(playerId)}, NULL)`,
        );
      }
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        throw new ValidationError('Spilleren er allerede registrert (e-post eller ranking-ID).');
      }
      throw err;
    }
  }

  // meta.changes/last_row_id are unreliable in local (miniflare) D1, so
  // verify the write meta-independently: teams by before/after row count
  // (a name-match can't distinguish a fresh insert from the conflicting
  // row when names are identical), individuals via the newest matching row.
  let newId;
  if (isTeam) {
    const countOf = async () =>
      (await d1Select(
        `SELECT COUNT(*) AS n FROM registrations WHERE tournament_slug = ${sqlValue(tournamentSlug)} AND type = 'team'`,
      ))[0].n;
    const before = await countOf();
    await insertRegistration();
    const after = await countOf();
    if (after === before) {
      throw new ValidationError(
        playerIdsJson
          ? 'En av spillerne er allerede registrert i denne turneringen!'
          : 'Laget er allerede registrert i denne turneringen!',
      );
    }
    newId = (
      await d1Select(
        `SELECT MAX(id) AS id FROM registrations WHERE tournament_slug = ${sqlValue(tournamentSlug)} AND type = 'team'`,
      )
    )[0].id;
  } else {
    await insertRegistration();
    newId = (
      await d1Select(
        `SELECT id FROM registrations WHERE tournament_slug = ${sqlValue(tournamentSlug)} AND type = 'player' AND lower(email) = ${sqlValue(email)} ORDER BY id DESC LIMIT 1`,
      )
    )[0]?.id;
  }

  const closed = config.registrationOpen === false;
  return ok(
    `Registrert: ${name} i ${tournamentSlug} (id ${newId}).` +
      (closed ? ' Merk: påmeldingen for denne turneringen er STENGT for publikum — dette er en manuell admin-påmelding.' : ''),
    { id: newId, tournamentSlug, name, email: maskEmail(email), registrationClosedForPublic: closed },
  );
}

async function findRows(args) {
  if (args.id != null) {
    return d1Select(`SELECT * FROM registrations WHERE id = ${sqlValue(args.id)}`);
  }
  if (args.email && args.tournamentSlug) {
    knownSlug(args.tournamentSlug);
    return d1Select(
      `SELECT * FROM registrations WHERE tournament_slug = ${sqlValue(args.tournamentSlug)}
       AND lower(email) = ${sqlValue(args.email.trim().toLowerCase())}`,
    );
  }
  throw new ValidationError('Oppgi enten id, eller email + tournamentSlug.');
}

const maskedRow = (r) => ({
  id: r.id,
  tournament: r.tournament_slug,
  type: r.type,
  name: r.name,
  email: maskEmail(r.email),
  phone: maskPhone(r.phone),
  registeredAt: r.created_at,
});

async function deleteRegistration(args) {
  const dryRun = args.dryRun !== false;
  const rows = await findRows(args);
  if (rows.length === 0) return ok('Fant ingen påmelding som matcher — ingenting slettet.', { deleted: 0 });
  if (dryRun) {
    return ok(
      `DRY RUN — ville slettet ${rows.length} påmelding(er). Kjør igjen med dryRun: false for å utføre.`,
      rows.map(maskedRow),
    );
  }
  const ids = rows.map((r) => r.id);
  await d1(`DELETE FROM registrations WHERE id IN (${ids.map(sqlValue).join(', ')})`);
  // Don't trust meta.changes (unreliable for DELETE in some wrangler
  // versions) — verify by re-selecting.
  const remaining = await d1Select(
    `SELECT id FROM registrations WHERE id IN (${ids.map(sqlValue).join(', ')})`,
  );
  const deleted = ids.length - remaining.length;
  return ok(`Slettet ${deleted} påmelding(er).`, { deleted, rows: rows.map(maskedRow) });
}

async function updateRegistration(args) {
  const rows = await findRows({ id: args.id });
  if (rows.length === 0) throw new ValidationError(`Fant ikke påmelding med id ${args.id}.`);
  const row = rows[0];
  const sets = [];
  const changes = {};
  if (args.name !== undefined) {
    const n = String(args.name).trim();
    if (!n || n.length > 500) throw new ValidationError('Ugyldig navn.');
    sets.push(`name = ${sqlValue(n)}`);
    changes.name = { from: row.name, to: n };
  }
  if (args.email !== undefined) {
    assertEmail(args.email);
    sets.push(`email = ${sqlValue(args.email.trim().toLowerCase())}`);
    changes.email = { from: maskEmail(row.email), to: maskEmail(args.email) };
  }
  if (args.phone !== undefined) {
    assertPhone(args.phone);
    sets.push(`phone = ${sqlValue(args.phone?.trim() || null)}`);
    changes.phone = { from: maskPhone(row.phone), to: maskPhone(args.phone) };
  }
  if (sets.length === 0) throw new ValidationError('Ingen felt å oppdatere (name/email/phone).');
  try {
    await d1(`UPDATE registrations SET ${sets.join(', ')} WHERE id = ${sqlValue(args.id)}`);
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err.message)) {
      throw new ValidationError('E-posten er allerede i bruk av en annen påmelding i denne turneringen.');
    }
    throw err;
  }
  return ok(`Oppdaterte påmelding ${args.id}.`, changes);
}

async function moveRegistration(args) {
  const { toTournamentSlug } = args;
  const target = knownSlug(toTournamentSlug);
  const rows = await findRows({ id: args.id });
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
  // Pre-check duplicates in the target tournament
  const dupClauses = [];
  if (row.player_id != null) dupClauses.push(`player_id = ${sqlValue(row.player_id)}`);
  if (row.type === 'player') dupClauses.push(`(type = 'player' AND player_id IS NULL AND lower(email) = lower(${sqlValue(row.email)}))`);
  if (row.player_ids) {
    const ids = JSON.parse(row.player_ids);
    const ph = ids.map(sqlValue).join(', ');
    dupClauses.push(`player_id IN (${ph})`);
    dupClauses.push(`(json_valid(player_ids) AND EXISTS (SELECT 1 FROM json_each(player_ids) je WHERE je.value IN (${ph})))`);
  }
  if (row.type === 'team') dupClauses.push(`(type = 'team' AND lower(name) = lower(${sqlValue(row.name)}))`);
  if (dupClauses.length) {
    const dups = await d1Select(
      `SELECT id, name FROM registrations WHERE tournament_slug = ${sqlValue(toTournamentSlug)} AND (${dupClauses.join(' OR ')})`,
    );
    if (dups.length) {
      throw new ValidationError(
        `Konflikt i målturneringen — allerede registrert der (id ${dups.map((d) => d.id).join(', ')}).`,
      );
    }
  }

  await d1(
    `UPDATE registrations SET tournament_slug = ${sqlValue(toTournamentSlug)} WHERE id = ${sqlValue(args.id)}`,
  );
  return ok(
    `Flyttet påmelding ${args.id} (${row.name}) fra ${row.tournament_slug} til ${toTournamentSlug}.`,
    { id: args.id, from: row.tournament_slug, to: toTournamentSlug },
  );
}

const csvField = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

async function exportRegistrations(args) {
  const { tournamentSlug } = args;
  knownSlug(tournamentSlug);
  const rows = await d1Select(
    `SELECT id, tournament_slug, type, name, country, email, phone, world_ranking, created_at
     FROM registrations WHERE tournament_slug = ${sqlValue(tournamentSlug)} ORDER BY id ASC`,
  );
  const header = 'id,tournament_slug,type,name,country,email,phone,world_ranking,created_at';
  const lines = rows.map((r) =>
    [
      r.id,
      csvField(r.tournament_slug),
      csvField(r.type),
      csvField(r.name),
      csvField(r.country),
      csvField(r.email),
      csvField(r.phone),
      r.world_ranking ?? '',
      csvField(r.created_at),
    ].join(','),
  );
  const csv = '﻿' + [header, ...lines].join('\r\n') + '\r\n'; // BOM for Excel

  mkdirSync(PATHS.exportDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const out =
    args.outPath ?? `${PATHS.exportDir}/registrations-${tournamentSlug}-${stamp}.csv`;
  writeFileSync(out, csv);
  return ok(
    `Eksporterte ${rows.length} påmeldinger til ${out}\n` +
      'Filen inneholder e-poster og telefonnumre — den ligger i git-ignorerte migration/raw/. Ikke del den ukritisk, og slett den når du er ferdig.',
    { path: out, rows: rows.length },
  );
}

async function syncParticipantSnapshot(args) {
  const rows = await d1Select(
    `SELECT tournament_slug, name, country, world_ranking FROM registrations`,
  );
  const tournaments = {};
  for (const r of rows) {
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

  await ensureClean();
  writeFileSync(PATHS.snapshot, JSON.stringify(snapshot, null, 1) + '\n');
  const result = await commitFiles({
    files: ['src/data/registrations-snapshot.json'],
    message: 'chore(data): sync registrations snapshot from D1',
    directToMain: args.directToMain ?? false,
  });
  return ok(
    `Snapshot oppdatert (${rows.length} påmeldte, ${Object.keys(tournaments).length} turneringer). ` +
      (result.mode === 'pr' ? `PR: ${result.prUrl}` : `Pushet til main (${result.commitSha}).`) +
      ' Den statiske deltakerlisten oppdateres ved neste bygg (siden hydrerer uansett live fra API-et).',
    { registrations: rows.length, tournaments: Object.keys(tournaments).length, git: result },
  );
}

async function rankingLookup(args) {
  const hits = await searchRanking(args.query, args.limit ?? 10);
  if (hits.length === 0) return ok(`Ingen treff på «${args.query}» på verdensrankingen.`, []);
  return ok(
    `${hits.length} treff på «${args.query}» (rank, ITHF playerId, navn, klubb, nasjon).`,
    hits,
  );
}

export function registerRegistrationTools(server) {
  server.registerTool(
    'list_registrations',
    {
      title: 'List registrations',
      description:
        'READ-ONLY (live D1). Registrations for a tournament — public fields only (id, name, country, world ranking). Use export_registrations for contact details.',
      inputSchema: {
        tournamentSlug: z.string(),
        limit: z.number().int().min(1).max(5000).optional(),
      },
    },
    tool(listRegistrations),
  );

  server.registerTool(
    'count_registrations',
    {
      title: 'Count registrations',
      description: 'READ-ONLY (live D1). Registration counts, per tournament or for one tournament.',
      inputSchema: { tournamentSlug: z.string().optional() },
    },
    tool(countRegistrations),
  );

  server.registerTool(
    'add_registration',
    {
      title: 'Add registration (manual)',
      description:
        'WRITES LIVE D1. Manually register a player/team (walk-ins, late sign-ups). Same validation and duplicate protection as the public API; Turnstile not required. Works for team tournaments with playerIds (ITHF ranking ids — find them with ranking_lookup) or free-text names, and for individual tournaments with playerId or name.',
      inputSchema: {
        tournamentSlug: z.string(),
        email: z.string().describe('Contact email (stored once per registration)'),
        phone: z.string().nullish(),
        playerId: z.number().int().positive().nullish().describe('ITHF ranking id (individual tournaments)'),
        name: z.string().nullish().describe('Free-text name for unranked players (individual tournaments)'),
        playerIds: z.array(z.number().int().positive()).nullish().describe('Team tournaments: ranking ids of all team members'),
        names: z.array(z.string()).nullish().describe('Team tournaments: free-text names of all team members'),
      },
    },
    tool(addRegistration),
  );

  server.registerTool(
    'delete_registration',
    {
      title: 'Delete registration',
      description:
        'DESTRUCTIVE (live D1), dry-run by default. Identify by id OR email+tournamentSlug. First call shows exactly what would be deleted; call again with dryRun: false to actually delete.',
      inputSchema: {
        id: z.number().int().positive().optional(),
        email: z.string().optional(),
        tournamentSlug: z.string().optional(),
        dryRun: z.boolean().optional().describe('Default true = preview only'),
      },
    },
    tool(deleteRegistration),
  );

  server.registerTool(
    'update_registration',
    {
      title: 'Update registration',
      description: 'WRITES LIVE D1. Fix name/email/phone on an existing registration (by id).',
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().nullish(),
      },
    },
    tool(updateRegistration),
  );

  server.registerTool(
    'move_registration',
    {
      title: 'Move registration',
      description:
        'WRITES LIVE D1. Move a registration to another tournament (e.g. wrong NM class). Validates type compatibility, team size and duplicates in the target tournament.',
      inputSchema: {
        id: z.number().int().positive(),
        toTournamentSlug: z.string(),
      },
    },
    tool(moveRegistration),
  );

  server.registerTool(
    'export_registrations',
    {
      title: 'Export registrations (CSV)',
      description:
        'READ-ONLY from D1, WRITES a local file. Full CSV incl. email/phone (PII) for one tournament, written to the git-ignored migration/raw/ folder — contents are never printed to chat.',
      inputSchema: {
        tournamentSlug: z.string(),
        outPath: z.string().optional().describe('Default: migration/raw/registrations-<slug>-<timestamp>.csv'),
      },
    },
    tool(exportRegistrations),
  );

  server.registerTool(
    'sync_participant_snapshot',
    {
      title: 'Sync participant snapshot',
      description:
        'READS live D1, WRITES GIT (PR by default). Regenerates src/data/registrations-snapshot.json (public fields only) from the live database and commits it, so the static build shows current participant lists.',
      inputSchema: { directToMain: z.boolean().optional() },
    },
    tool(syncParticipantSnapshot),
  );

  server.registerTool(
    'ranking_lookup',
    {
      title: 'ITHF ranking lookup',
      description:
        'READ-ONLY (network). Search the live ITHF world ranking by name → rank, playerId, club, nation. Use the playerId with add_registration.',
      inputSchema: {
        query: z.string().describe('Name (substring, case-insensitive)'),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    tool(rankingLookup),
  );
}
