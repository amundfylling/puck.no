/**
 * Smoke test: spawn the server over real stdio and exercise the READ-ONLY
 * tools end-to-end (live D1 reads, ranking fetch, file parsing) plus a few
 * validation failures. No git or D1 writes are performed.
 *
 * Run: node test/smoke.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['src/index.js'],
  stderr: 'pipe',
});

const client = new Client({ name: 'smoke-test', version: '0.1.0' });
let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  — ${detail}`}`);
  if (!cond) failures++;
};

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  check('lists 21 tools', tools.length === 21, `got ${tools.length}: ${tools.map((t) => t.name).join(', ')}`);

  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: !!res.isError, text: res.content?.[0]?.text ?? '' };
  };

  // --- read-only happy paths ---
  const count = await call('count_registrations');
  check('count_registrations', !count.isError && /\d+ påmeldinger totalt/.test(count.text), count.text.slice(0, 300));

  const countOne = await call('count_registrations', { tournamentSlug: 'norway-open-2026' });
  check('count_registrations (one tournament)', !countOne.isError && /norway-open-2026/.test(countOne.text), countOne.text.slice(0, 300));

  const listT = await call('list_tournaments');
  check('list_tournaments', !listT.isError && listT.text.includes('norway-open-2026'), listT.text.slice(0, 300));

  const listR = await call('list_registrations', { tournamentSlug: 'norway-open-2026' });
  check(
    'list_registrations (public fields only)',
    !listR.isError && listR.text.includes('Kalnins') && !listR.text.includes('@'),
    listR.text.slice(0, 400),
  );

  const rank = await call('ranking_lookup', { query: 'fylling', limit: 5 });
  check('ranking_lookup', !rank.isError && /treff|Ingen treff/.test(rank.text), rank.text.slice(0, 300));

  const arch = await call('archive_tournament', { slug: 'norway-open-2025' });
  check('archive_tournament (past tournament)', !arch.isError && arch.text.includes('TIDLIGERE'), arch.text.slice(0, 300));

  // --- validation failures (nothing written) ---
  const badSlug = await call('create_tournament', { name: 'X', slug: 'BRAKE SLUG!!', date: '5. september 2026' });
  check('create_tournament rejects bad slug', badSlug.isError && badSlug.text.includes('Ugyldig'), badSlug.text.slice(0, 300));

  const badDate = await call('create_tournament', { name: 'X', slug: 'brake-slug', date: 'September 5 2026' });
  check('create_tournament rejects unparseable date', badDate.isError && badDate.text.includes('dato'), badDate.text.slice(0, 300));

  const unknownT = await call('list_registrations', { tournamentSlug: 'finnes-ikke-2026' });
  check('list_registrations rejects unknown slug', unknownT.isError && unknownT.text.includes('Ukjent'), unknownT.text.slice(0, 300));

  const dryDel = await call('delete_registration', { email: 'nobody@example.org', tournamentSlug: 'norway-open-2026' });
  check('delete_registration dry-run with no match is harmless', !dryDel.isError && dryDel.text.includes('ingen'), dryDel.text.slice(0, 300));

  const badEmail = await call('add_registration', { tournamentSlug: 'test-individuell-2026', email: 'not-an-email', name: 'Test' });
  check('add_registration validates email before touching D1', badEmail.isError && badEmail.text.includes('e-post'), badEmail.text.slice(0, 300));
} catch (err) {
  console.error('SMOKE TEST CRASHED:', err);
  failures++;
} finally {
  await client.close();
}

console.log(failures === 0 ? '\nALL SMOKE TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
