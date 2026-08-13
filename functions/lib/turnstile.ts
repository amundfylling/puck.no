/// <reference types="@cloudflare/workers-types" />

import { TURNSTILE_REGISTRATION_ACTION } from '../../src/lib/turnstile.ts';

export const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Parse exact hostnames from a comma-separated environment variable. */
export function parseTurnstileHostnames(value: string | undefined): ReadonlySet<string> {
  const hostnames = new Set<string>();
  for (const raw of value?.split(',') ?? []) {
    const candidate = raw.trim().toLowerCase();
    if (!candidate || candidate.includes('*')) continue;
    try {
      const url = new URL(`https://${candidate}`);
      if (
        url.hostname.toLowerCase() === candidate &&
        !url.port &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      ) {
        hostnames.add(candidate);
      }
    } catch {
      // Invalid entries are ignored so a bad allowlist fails closed.
    }
  }
  return hostnames;
}

/** Validate a token with Siteverify and bind it to this action and hostname. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  allowedHostnames: ReadonlySet<string>,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (
    !secret ||
    !token ||
    token.length > MAX_TURNSTILE_TOKEN_LENGTH ||
    allowedHostnames.size === 0
  ) {
    return false;
  }

  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (remoteIp) form.append('remoteip', remoteIp);
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      body: form,
    });
    if (!response.ok) return false;

    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const result = data as Record<string, unknown>;
    const hostname = typeof result.hostname === 'string' ? result.hostname.toLowerCase() : '';
    return (
      result.success === true &&
      result.action === TURNSTILE_REGISTRATION_ACTION &&
      allowedHostnames.has(hostname)
    );
  } catch {
    return false;
  }
}
