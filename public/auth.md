# puck.no auth.md

This document describes authentication for the protected NBHF administration
MCP server. Public website pages, tournament listings, and public participant
lists do not require authentication.

## Protected resource

- MCP endpoint: `https://www.puck.no/mcp`
- Protected Resource Metadata:
  `https://www.puck.no/.well-known/oauth-protected-resource`
- Required scope: `admin`
- Bearer tokens are sent in the `Authorization` header.

## Authorization server

The resource delegates OAuth authorization to:

`https://puck-no-mcp.amund-fylling.workers.dev`

Discover its current endpoints at:

`https://puck-no-mcp.amund-fylling.workers.dev/.well-known/oauth-authorization-server`

The server supports the OAuth authorization-code grant for public clients,
requires PKCE with `S256`, and supports dynamic client registration at
`https://puck-no-mcp.amund-fylling.workers.dev/register`.

Access tokens use a private HMAC-authenticated format consumed only by the
same Worker, not JWT access tokens intended for third-party validation.
Consequently the authorization metadata does not advertise a `jwks_uri`.

Register a client by sending JSON with one to five exact `redirect_uris` to
that endpoint. The returned `client_id` is then used for the standard
authorization-code flow.

## Human authorization is required

Authorization requires an interactive GitHub sign-in, an explicit consent
step, and current collaborator access to the private administration surface.
There is no anonymous, verified-email, ID-JAG, client-credentials, or
unattended agent-registration flow. Do not claim support for those methods or
attempt to bypass the human authorization step.

Access tokens expire after one hour. Collaborator access is rechecked on every
MCP request, so removing repository access revokes effective access
immediately.
