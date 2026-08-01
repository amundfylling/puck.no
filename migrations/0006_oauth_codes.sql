-- One-use OAuth authorization codes for the remote MCP server.
-- The signed code carries no PII beyond the GitHub login; this table stores
-- only a random identifier and its short expiration time.
CREATE TABLE IF NOT EXISTS oauth_codes (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at
  ON oauth_codes (expires_at);
