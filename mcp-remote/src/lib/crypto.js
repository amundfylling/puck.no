/**
 * Token crypto for the OAuth server: HMAC-SHA256 signed, self-contained
 * tokens (no KV/storage needed — Web Crypto only, Workers + Node ≥ 20).
 * Token format: b64url(json) . b64url(hmac) — payload carries `exp`.
 */
const te = new TextEncoder();
const td = new TextDecoder();

export function b64url(data) {
  const bytes = typeof data === 'string' ? te.encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function b64urlDecode(s) {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Sign a JSON-serializable payload → compact token. */
export async function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(body));
  return `${body}.${b64url(sig)}`;
}

/**
 * Verify a token → payload, or null when the signature is invalid or the
 * token is expired (`exp` in seconds, 60 s leeway).
 */
export async function verify(token, secret) {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let sigBytes;
  try {
    sigBytes = b64urlDecode(sig);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, te.encode(body));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(td.decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (payload.exp != null && Date.now() > payload.exp * 1000 + 60_000) return null;
  return payload;
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export async function s256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(verifier));
  return b64url(digest);
}
