/**
 * Git flow for content changes. Default: feature branch + push + PR via
 * `gh` (repo convention: changes to main go through PRs). Opt-in
 * directToMain commits to main and pushes (same as the CMS workflow).
 *
 * Safety: requires a clean working tree before the tool writes anything,
 * stages ONLY the files the tool touched, never force-pushes, never
 * touches main history otherwise.
 */
import { REPO_ROOT } from './config.js';
import { run } from './run.js';

async function git(args) {
  return (await run('git', args, { cwd: REPO_ROOT })).stdout.trim();
}

/** Throw if the working tree is dirty (lists the offending paths). */
export async function ensureClean() {
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
 * Returns { mode: 'pr'|'direct', branch?, prUrl?, commitSha }.
 */
export async function commitFiles({ files, message, prBody, directToMain = false, branchPrefix = 'mcp' }) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  if (directToMain) {
    const branch = await git(['branch', '--show-current']);
    if (branch !== 'main') {
      throw new Error(`directToMain requires the main branch (currently on «${branch}»).`);
    }
    await git(['add', '--', ...files]);
    await git(['commit', '-m', message]);
    const sha = await git(['rev-parse', '--short', 'HEAD']);
    await git(['push', 'origin', 'main']);
    return { mode: 'direct', commitSha: sha };
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
    await git(['checkout', 'main']).catch(() => {});
  }
}
