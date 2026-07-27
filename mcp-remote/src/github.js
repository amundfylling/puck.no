/**
 * GitHub API layer. The worker's PAT (GITHUB_TOKEN secret, fine-grained:
 * this repo, Contents read+write) does repo operations; the OAuth user
 * only proves their GitHub identity, and authorization = collaborator
 * check on the repo (same trust model as the Sveltia CMS).
 */

export class GitHubError extends Error {
  constructor(status, path, body) {
    super(`GitHub ${status} for ${path}: ${String(body).slice(0, 500)}`);
    this.status = status;
  }
}

const repo = (env) => env.GITHUB_REPO ?? 'amundfylling/puck.no';

async function api(env, path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'puck-no-mcp-remote',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GitHubError(res.status, path, await res.text());
  return res.status === 204 ? null : res.json();
}

const te = new TextEncoder();
const td = new TextDecoder();

export function toBase64(data) {
  const bytes = typeof data === 'string' ? te.encode(data) : new Uint8Array(data);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function fromBase64(b64) {
  return Uint8Array.from(atob(b64.replaceAll('\n', '')), (c) => c.charCodeAt(0));
}

/** Fetch a text file from the repo at main, via raw.githubusercontent (public repo). */
export async function getTextFile(env, path) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo(env)}/main/${path}`, {
    headers: { 'User-Agent': 'puck-no-mcp-remote' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, path, await res.text());
  return res.text();
}

/** List repo file paths (recursive git tree of main). */
export async function listFiles(env) {
  const tree = await api(env, `/repos/${repo(env)}/git/trees/main?recursive=1`);
  return (tree.tree ?? []).filter((n) => n.type === 'blob').map((n) => n.path);
}

/**
 * Commit multiple files to main in ONE commit (Git Data API):
 *   ref → base tree → blobs → new tree → commit → update ref.
 * files: [{ path, text }] for UTF-8 text, [{ path, base64 }] for binary.
 */
export async function commitFiles(env, { message, files }) {
  const ref = await api(env, `/repos/${repo(env)}/git/ref/heads/main`);
  const headSha = ref.object.sha;
  const head = await api(env, `/repos/${repo(env)}/git/commits/${headSha}`);

  const treeEntries = [];
  for (const f of files) {
    const blob = await api(env, `/repos/${repo(env)}/git/blobs`, {
      method: 'POST',
      body: f.base64 !== undefined
        ? { content: f.base64, encoding: 'base64' }
        : { content: f.text, encoding: 'utf-8' },
    });
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await api(env, `/repos/${repo(env)}/git/trees`, {
    method: 'POST',
    body: { base_tree: head.tree.sha, tree: treeEntries },
  });
  const commit = await api(env, `/repos/${repo(env)}/git/commits`, {
    method: 'POST',
    body: { message, tree: newTree.sha, parents: [headSha] },
  });
  await api(env, `/repos/${repo(env)}/git/refs/heads/main`, {
    method: 'PATCH',
    body: { sha: commit.sha },
  });
  return { commitSha: commit.sha.slice(0, 7), url: commit.html_url };
}

/**
 * Authorization check: is `username` a collaborator on the repo?
 * Uses the worker PAT (needs Metadata+Contents on the repo).
 */
export async function isCollaborator(env, username) {
  const res = await fetch(
    `https://api.github.com/repos/${repo(env)}/collaborators/${encodeURIComponent(username)}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'puck-no-mcp-remote',
      },
    },
  );
  if (res.status === 204) return true;
  if (res.status === 404) return false;
  throw new GitHubError(res.status, 'collaborators', await res.text());
}

/** Latest check runs on a ref (for deploy_status). */
export async function checkRuns(env, ref = 'main') {
  return api(env, `/repos/${repo(env)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=30`);
}
