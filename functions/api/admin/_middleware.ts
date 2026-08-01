/// <reference types="@cloudflare/workers-types" />

/**
 * Defence-in-depth for every /api/admin/* endpoint.
 *
 * Cloudflare Access still sits in front of this route, but the function also
 * verifies the signed assertion itself. A plain user-supplied identity header
 * is never accepted.
 */
import {
  accessIssuer,
  adminMutationProblem,
  verifyAccessToken,
  type AdminAuthData,
  type AdminAuthEnv,
} from '../../lib/admin-auth.ts';

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export const onRequest: PagesFunction<AdminAuthEnv, string, AdminAuthData> = async (context) => {
  const issuer = accessIssuer(context.env.ACCESS_TEAM_NAME);
  const audience = context.env.ACCESS_POLICY_AUD?.trim();
  if (!issuer || !audience) {
    console.error('Cloudflare Access verification is not configured');
    return json({ error: 'Admin-tilgang er ikke konfigurert.' }, 503);
  }

  const assertion = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) return json({ error: 'Ikke tilgang.' }, 403);

  try {
    context.data.adminIdentity = await verifyAccessToken(assertion, issuer, audience);
  } catch (error) {
    console.error('Cloudflare Access assertion rejected', error instanceof Error ? error.name : 'Error');
    return json({ error: 'Ikke tilgang.' }, 403);
  }

  const mutationProblem = adminMutationProblem(context.request);
  if (mutationProblem) return json({ error: mutationProblem.message }, mutationProblem.status);

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
