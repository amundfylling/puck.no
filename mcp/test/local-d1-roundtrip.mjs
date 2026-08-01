/**
 * Local round-trip test for the D1 WRITE tools — runs entirely against the
 * LOCAL dev database (MCP_D1_LOCAL=1), never production:
 *   add (individual + team) → duplicate rejection → update → move →
 *   delete (dry-run, then real) → verify gone.
 *
 * Prereq: npx wrangler d1 migrations apply puck-no --local
 * Run:    MCP_D1_LOCAL=1 node test/local-d1-roundtrip.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['src/index.js'],
  env: { ...process.env, MCP_D1_LOCAL: '1', MCP_ALLOW_DRAFTS: '1' },
  stderr: 'pipe',
});
const client = new Client({ name: 'roundtrip-test', version: '0.1.0' });

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  — ${detail}`}`);
  if (!cond) failures++;
};

const IND = 'test-individuell-2026';
const TEAM = 'test-lagturnering-2026';
const IND2 = 'duo-nm-2026'; // also a team tournament — for team-to-team move

try {
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: !!res.isError, text: res.content?.[0]?.text ?? '' };
  };
  // Clean slate (idempotent — ignore failures if rows don't exist)
  await call('delete_registration', { email: 'roundtrip@test.no', tournamentSlug: IND, dryRun: false });
  await call('delete_registration', { email: 'roundtrip2@test.no', tournamentSlug: IND, dryRun: false });
  await call('delete_registration', { email: 'roundtrip3@test.no', tournamentSlug: TEAM, dryRun: false });
  await call('delete_registration', { email: 'roundtrip3@test.no', tournamentSlug: IND2, dryRun: false });

  // --- individual, free-text name ---
  const add1 = await call('add_registration', { tournamentSlug: IND, email: 'RoundTrip@Test.no', name: 'Runde Tur' });
  check('add individual (free-text name)', !add1.isError && add1.text.includes('Registrert'), add1.text.slice(0, 400));

  const dup1 = await call('add_registration', { tournamentSlug: IND, email: 'roundtrip@test.no', name: 'Runde Tur Igjen' });
  check('duplicate email rejected (case-insensitive)', dup1.isError && dup1.text.includes('allerede'), dup1.text.slice(0, 300));

  // --- individual, ranked (live ranking lookup) ---
  const lookup = await call('ranking_lookup', { query: 'fylling', limit: 1 });
  const idMatch = lookup.text.match(/"id": (\d+)/);
  check('ranking_lookup returns a playerId', !lookup.isError && !!idMatch, lookup.text.slice(0, 300));
  const pid = idMatch ? Number(idMatch[1]) : null;

  let add2 = { isError: true, text: 'skipped — no playerId' };
  if (pid) {
    add2 = await call('add_registration', { tournamentSlug: IND, email: 'roundtrip2@test.no', playerId: pid });
    check('add individual (ranked playerId)', !add2.isError && add2.text.includes('Registrert'), add2.text.slice(0, 400));

    const dup2 = await call('add_registration', { tournamentSlug: IND, email: 'other@test.no', playerId: pid });
    check('duplicate playerId rejected regardless of email', dup2.isError && dup2.text.includes('allerede'), dup2.text.slice(0, 300));
  }

  // --- team tournament with ranked ids ---
  const lookup2 = await call('ranking_lookup', { query: 'kalnins', limit: 1 });
  const id2Match = lookup2.text.match(/"id": (\d+)/);
  const pid2 = id2Match ? Number(id2Match[1]) : null;
  check('second ranked player found', !!pid2 && pid2 !== pid, lookup2.text.slice(0, 300));

  let teamAdded = false;
  if (pid && pid2) {
    const answers = { 'lunsj-antall': '2' };
    const addT = await call('add_registration', { tournamentSlug: TEAM, email: 'roundtrip3@test.no', playerIds: [pid, pid2], answers });
    check('add team (2 ranked players)', !addT.isError && addT.text.includes('Registrert'), addT.text.slice(0, 400));
    teamAdded = !addT.isError;

    const dupT = await call('add_registration', { tournamentSlug: TEAM, email: 'another@test.no', playerIds: [pid, pid2], answers });
    check('overlapping team rejected', dupT.isError && dupT.text.includes('allerede'), dupT.text.slice(0, 300));

    const wrongSize = await call('add_registration', { tournamentSlug: TEAM, email: 'solo@test.no', playerIds: [pid], answers });
    check('team size below playersPerTeam rejected', wrongSize.isError && wrongSize.text.includes('mellom 2 og 3'), wrongSize.text.slice(0, 300));
  }

  // --- list + update ---
  const list = await call('list_registrations', { tournamentSlug: IND });
  const rowId = Number(list.text.match(/"id": (\d+)/)?.[1]);
  check('list_registrations shows the added rows', !list.isError && Number.isInteger(rowId) && list.text.includes('Runde Tur'), list.text.slice(0, 400));

  const upd = await call('update_registration', { id: rowId, name: 'Runde Tur Korrigert' });
  check('update_registration fixes name', !upd.isError && upd.text.includes('Korrigert'), upd.text.slice(0, 300));

  // --- move (individual → individual not available; use team → team) ---
  if (teamAdded) {
    const teamList = await call('list_registrations', { tournamentSlug: TEAM });
    const teamRowId = Number(teamList.text.match(/"id": (\d+)/)?.[1]);
    const move = await call('move_registration', { id: teamRowId, toTournamentSlug: IND2 });
    check('move team to another team tournament', !move.isError && move.text.includes(IND2), move.text.slice(0, 300));

    const badMove = await call('move_registration', { id: teamRowId, toTournamentSlug: IND });
    check('move team to individual tournament refused', badMove.isError && badMove.text.includes('individuell'), badMove.text.slice(0, 300));
  }

  // --- delete: dry-run first, then real ---
  const dry = await call('delete_registration', { email: 'roundtrip@test.no', tournamentSlug: IND });
  check('delete dry-run previews without deleting', !dry.isError && dry.text.includes('DRY RUN'), dry.text.slice(0, 300));

  const real = await call('delete_registration', { email: 'roundtrip@test.no', tournamentSlug: IND, dryRun: false });
  check('delete for real', !real.isError && real.text.includes('Slettet 1'), real.text.slice(0, 300));

  const gone = await call('delete_registration', { email: 'roundtrip@test.no', tournamentSlug: IND, dryRun: false });
  check('row is gone afterwards', !gone.isError && gone.text.includes('ingen'), gone.text.slice(0, 300));

  // --- cleanup of remaining test rows ---
  await call('delete_registration', { email: 'roundtrip2@test.no', tournamentSlug: IND, dryRun: false });
  await call('delete_registration', { email: 'roundtrip3@test.no', tournamentSlug: IND2, dryRun: false });
  console.log('(cleanup done)');
} catch (err) {
  console.error('ROUNDTRIP CRASHED:', err);
  failures++;
} finally {
  await client.close();
}

console.log(failures === 0 ? '\nALL ROUNDTRIP TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
