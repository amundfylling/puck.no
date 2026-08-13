/// <reference types="@cloudflare/workers-types" />

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export interface AdminAuthEnv extends CloudflareEnv {
  /** Cloudflare Zero Trust team name, hostname or issuer URL. */
  ACCESS_TEAM_NAME?: string;
  /** Application Audience (AUD) tag from the Access application overview. */
  ACCESS_POLICY_AUD?: string;
}

export interface AdminIdentity {
  email: string;
  subject: string;
}

export interface AdminAuthData extends Record<string, unknown> {
  adminIdentity?: AdminIdentity;
}

const TEAM_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const ACCESS_HOST_SUFFIX = '.cloudflareaccess.com';
const remoteKeys = new Map<string, JWTVerifyGetKey>();

/**
 * Return the exact issuer Cloudflare Access places in `iss`.
 *
 * The environment value may be `nbhf`, `nbhf.cloudflareaccess.com`, or the
 * complete HTTPS issuer. Anything else is rejected instead of producing a
 * user-controlled JWKS URL.
 */
export function accessIssuer(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  if (TEAM_RE.test(raw)) return `https://${raw.toLowerCase()}${ACCESS_HOST_SUFFIX}`;

  const candidate = raw.includes('://') ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const team = url.hostname.toLowerCase().endsWith(ACCESS_HOST_SUFFIX)
      ? url.hostname.slice(0, -ACCESS_HOST_SUFFIX.length)
      : '';
    if (
      url.protocol !== 'https:' ||
      !TEAM_RE.test(team) ||
      url.port ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `https://${team.toLowerCase()}${ACCESS_HOST_SUFFIX}`;
  } catch {
    return null;
  }
}

function keySetFor(issuer: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    remoteKeys.set(issuer, keys);
  }
  return keys;
}

/** Verify signature and all security-relevant Access claims. */
export async function verifyAccessToken(
  token: string,
  issuer: string,
  audience: string,
  keys: JWTVerifyGetKey = keySetFor(issuer),
): Promise<AdminIdentity> {
  const { payload } = await jwtVerify<JWTPayload>(token, keys, {
    algorithms: ['RS256'],
    issuer,
    audience,
    clockTolerance: 5,
    requiredClaims: ['exp', 'iat', 'nbf', 'email', 'sub', 'type'],
  });
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const subject = typeof payload.sub === 'string' ? payload.sub : '';
  if (payload.type !== 'app' || !email || !subject) {
    throw new Error('Access-tokenet mangler identitet.');
  }
  return Object.freeze({ email, subject });
}

/** Downstream handlers only trust the identity installed by verified middleware. */
export function adminIdentity(data: unknown): AdminIdentity | null {
  if (!data || typeof data !== 'object') return null;
  const identity = (data as AdminAuthData).adminIdentity;
  if (
    !identity ||
    typeof identity !== 'object' ||
    typeof identity.email !== 'string' ||
    !identity.email ||
    typeof identity.subject !== 'string' ||
    !identity.subject
  ) {
    return null;
  }
  return identity;
}

/**
 * Browser mutations must be same-origin JSON. Access authenticates the user;
 * this check prevents an authenticated browser from being driven by another
 * site and rejects simple cross-origin form submissions.
 */
export function adminMutationProblem(request: Request): { status: number; message: string } | null {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return null;

  const mediaType = (request.headers.get('Content-Type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    return { status: 415, message: 'Forespørselen må være JSON.' };
  }

  const originHeader = request.headers.get('Origin');
  if (!originHeader) return { status: 403, message: 'Ugyldig forespørselsopprinnelse.' };
  try {
    if (new URL(originHeader).origin !== new URL(request.url).origin) {
      return { status: 403, message: 'Ugyldig forespørselsopprinnelse.' };
    }
  } catch {
    return { status: 403, message: 'Ugyldig forespørselsopprinnelse.' };
  }

  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return { status: 403, message: 'Ugyldig forespørselsopprinnelse.' };
  }
  return null;
}
