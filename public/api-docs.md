# puck.no API documentation

The puck.no API supports public tournament registration and public participant
lists for Norges Bordhockeyforbund (NBHF). Its machine-readable description is
available at [openapi.json](https://www.puck.no/openapi.json).

## Public endpoints

- `GET /api/health` returns service health.
- `GET /api/tournaments/{slug}/players` returns public participant and ranking
  data. It never returns email addresses, phone numbers, or registration
  answers.
- `POST /api/registrations` submits a player or team registration. Use the
  user-facing form on the canonical tournament page: the request requires a
  fresh Cloudflare Turnstile token and strict server-side validation.

Tournament slugs use decoded Nordic characters where applicable. Responses
are JSON and error messages are normally in Norwegian.

## Protected administration

The `/api/admin/*` endpoints are for board members and are protected by
Cloudflare Access. They are deliberately omitted from the public OpenAPI
description because the browser portal is their supported client.

Authorized agents can instead use the administration MCP endpoint described
by the [MCP Server Card](https://www.puck.no/.well-known/mcp/server-card.json)
and [auth.md](https://www.puck.no/auth.md).
