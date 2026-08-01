/**
 * Git flow for content changes: feature branch + push + PR via `gh`.
 * The browser CMS has its own documented direct-main exception; developer
 * MCP tools follow the repository's pull-request rule unconditionally.
 *
 * Safety: requires a clean working tree before the tool writes anything,
 * stages ONLY the files the tool touched, never force-pushes, never
 * touches main history otherwise.
 */
import { REPO_ROOT } from './config.js';
import { run } from './run.js';
import { randomUUID } from 'node:crypto';

async function git(args) {
  return (await run('git', args, { cwd: REPO_ROOT })).stdout.trim();
}

/** Throw before a tool writes if it is not starting from a clean main. */
export async function ensureClean() {
  const branch = await git(['branch', '--show-current']);
  if (branch !== 'main') {
    throw new Error(`MCP-gitverktøy må startes fra main (nåværende branch er «${branch || 'detached HEAD'}»).`);
  }
  const out = await git(['status', '--porcelain']);
  if (out) {
    const paths = out.split('\n').map((l) => l.slice(3)).slice(0, 20);
    throw new Error(
      `Working tree is not clean — commit or stash these first, then retry:\n  ${paths.join('\n  ')}`,
    );
  }
}

/**
 * Commit `files` (repo-relative paths) with `message`.
 * Returns { mode: 'pr', branch, prUrl, commitSha }.
 */
export async function commitFiles({ files, message, prBody, branchPrefix = 'mcp' }) {
  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomUUID().slice(0, 8)}`;
  const originalBranch = await git(['branch', '--show-current']);
  if (originalBranch !== 'main') {
    throw new Error(`MCP-gitverktøy må startes fra main (nåværende branch er «${originalBranch}»).`);
  }

  const branch = `${branchPrefix}/${stamp}`;
  await git(['checkout', '-b', branch]);
  try {
    await git(['add', '--', ...files]);
    await git(['commit', '-m', message]);
    const sha = await git(['rev-parse', '--short', 'HEAD']);
    await git(['push', '-u', 'origin', branch]);
    const { stdout: prUrl } = await run('gh', [
      'pr', 'create',
      '--title', message,
      '--body', prBody ?? `${message}\n\n_Opprettet via puck-no-admin MCP-server._`,
      '--base', 'main',
    ], { cwd: REPO_ROOT });
    return { mode: 'pr', branch, prUrl: prUrl.trim().split('\n').pop(), commitSha: sha };
  } finally {
    // Return to main so the repo is left in a predictable state; the
    // feature branch (and PR) stays on the remote.
    await git(['checkout', originalBranch]).catch(() => {});
  }
}
