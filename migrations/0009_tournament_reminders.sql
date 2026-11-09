-- Tournament reminder emails (sent by the mcp-remote Worker's daily cron).
-- email_key is always lower(trim(email)). A row in reminder_recipients is
-- created the first time an address is mailed; its random token is the only
-- thing the public unsubscribe link carries, so no email ever appears in URLs.
CREATE TABLE IF NOT EXISTS reminder_recipients (
  email_key TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  unsubscribed_at TEXT
);

-- One row per (tournament, address) that has been sent a reminder, so a
-- re-run or retry never mails the same person twice for one tournament.
CREATE TABLE IF NOT EXISTS reminder_sends (
  tournament_slug TEXT NOT NULL,
  email_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (tournament_slug, email_key)
);
