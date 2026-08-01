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
const GITHUB_TIMEOUT_MS = 15_000;

async function githubRequest(path, operation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    const timedOut = error?.name === 'AbortError';
    throw new GitHubError(
      timedOut ? 504 : 502,
      path,
      timedOut ? 'request timed out' : 'network request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function api(env, path, { method = 'GET', body } = {}) {
  return githubRequest(path, async (signal) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'puck-no-mcp-remote',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const responseText = await res.text();
    if (!res.ok) throw new GitHubError(res.status, path, responseText);
    try {
      return JSON.parse(responseText);
    } catch {
      throw new GitHubError(502, path, 'invalid JSON response');
    }
  });
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

/**
 * Pin a multi-file operation to one immutable main commit. Mutating tools use
 * the returned env so every read and the eventual commit share one base.
 */
export async function withGitSnapshot(env) {
  const ref = await api(env, `/repos/${repo(env)}/git/ref/heads/main`);
  return { ...env, __gitBaseSha: ref.object.sha };
}

/** Fetch a text file from the operation's immutable base (or main for reads). */
export async function getTextFile(env, path) {
  const ref = env.__gitBaseSha ?? 'main';
  return githubRequest(path, async (signal) => {
    const res = await fetch(`https://raw.githubusercontent.com/${repo(env)}/${ref}/${path}`, {
      signal,
      headers: { 'User-Agent': 'puck-no-mcp-remote' },
    });
    if (res.status === 404) return null;
    const responseText = await res.text();
    if (!res.ok) throw new GitHubError(res.status, path, responseText);
    return responseText;
  });
}

/** List repo file paths (recursive git tree of main). */
export async function listFiles(env) {
  const ref = env.__gitBaseSha ?? 'main';
  const tree = await api(env, `/repos/${repo(env)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return (tree.tree ?? []).filter((n) => n.type === 'blob').map((n) => n.path);
}

/**
 * Commit multiple files to main in ONE commit (Git Data API):
 *   ref → base tree → blobs → new tree → commit → update ref.
 * files: [{ path, text }] for UTF-8 text, [{ path, base64 }] for binary.
 */
export async function commitFiles(env, { message, files }) {
  const headSha = env.__gitBaseSha ??
    (await api(env, `/repos/${repo(env)}/git/ref/heads/main`)).object.sha;
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
    // If main advanced after the pinned snapshot GitHub rejects this update
    // as non-fast-forward. Failing visibly is safer than restoring stale file
    // contents over a concurrent CMS/MCP edit.
    body: { sha: commit.sha, force: false },
  });
  return { commitSha: commit.sha.slice(0, 7), url: commit.html_url };
}

/**
 * Authorization check: is `username` a collaborator on the repo?
 * Uses the worker PAT (needs Metadata+Contents on the repo).
 */
export async function isCollaborator(env, username) {
  return githubRequest('collaborators', async (signal) => {
    const res = await fetch(
      `https://api.github.com/repos/${repo(env)}/collaborators/${encodeURIComponent(username)}`,
      {
        signal,
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
  });
}

/** Latest check runs on a ref (for deploy_status). */
export async function checkRuns(env, ref = 'main') {
  return api(env, `/repos/${repo(env)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=30`);
}
