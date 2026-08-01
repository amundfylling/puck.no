/** Ops tools: local health checks and deployment status. */
import { z } from 'zod';
import { REPO_ROOT, githubRepo } from '../lib/config.js';
import { run } from '../lib/run.js';
import { ok, tool } from '../lib/respond.js';

async function siteHealth() {
  const steps = [
    ['astro check', ['run', 'check']],
    ['build', ['run', 'build']],
    ['check-links', ['run', 'check-links']],
  ];
  const results = [];
  for (const [label, npmArgs] of steps) {
    const started = Date.now();
    try {
      const { stdout, stderr } = await run('npm', npmArgs, {
        cwd: REPO_ROOT,
        timeoutMs: 5 * 60_000,
      });
      const out = (stdout + stderr).trim();
      results.push({ step: label, ok: true, seconds: Math.round((Date.now() - started) / 1000), tail: out.slice(-400) });
    } catch (err) {
      results.push({
        step: label,
        ok: false,
        seconds: Math.round((Date.now() - started) / 1000),
        tail: `${err.stdout ?? ''}${err.stderr ?? ''}`.slice(-1500) || err.message,
      });
      break; // a red step makes later ones pointless
    }
  }
  const allOk = results.every((r) => r.ok);
  return ok(
    allOk
      ? `ALT GRØNT: ${results.map((r) => `${r.step} (${r.seconds}s)`).join(' → ')}`
      : `RØDT: ${results.find((r) => !r.ok)?.step} feilet.`,
    results,
  );
}

async function deployStatus(args) {
  const repo = githubRepo();
  let json;
  try {
    const { stdout } = await run('gh', [
      'api', `repos/${repo}/commits/${args.ref ?? 'main'}/check-runs?per_page=30`,
    ], { cwd: REPO_ROOT });
    json = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      'Kunne ikke hente deployment-status via gh. Er `gh auth login` gjort? ' + err.message,
    );
  }
  const runs = json.check_runs ?? [];
  const pagesRuns = runs.filter((r) => /pages|cloudflare/i.test(r.name));
  const pick = (pagesRuns.length ? pagesRuns : runs).slice(0, 5).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    startedAt: r.started_at,
    url: r.html_url,
  }));
  if (pick.length === 0) {
    return ok(
      'Fant ingen check runs på main. Cloudflare Pages bygger via egen GitHub-integrasjon — sjekk dashbordet (Workers & Pages → puck-no → Deployments).',
      [],
    );
  }
  const latest = pick[0];
  return ok(
    `Siste bygg (${latest.name}): ${latest.status}${latest.conclusion ? ` / ${latest.conclusion}` : ''} — ${latest.url}`,
    pick,
  );
}

export function registerOpsTools(server) {
  server.registerTool(
    'site_health',
    {
      title: 'Site health check',
      description:
        'READ-ONLY (runs locally, a few minutes). Runs astro check → build → check-links and reports green/red per step with the failing output tail.',
      inputSchema: {},
    },
    tool(siteHealth),
  );

  server.registerTool(
    'deploy_status',
    {
      title: 'Deployment status',
      description:
        'READ-ONLY. Latest Cloudflare Pages build status for main (via GitHub check runs through the gh CLI).',
      inputSchema: {
        ref: z.string().optional().describe('Branch/SHA to check (default: main)'),
      },
    },
    tool(deployStatus),
  );
}
