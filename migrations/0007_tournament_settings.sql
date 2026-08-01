-- Runtime registration controls. Admin changes take effect immediately while
-- the matching frontmatter commit rebuilds the static form in the background.
CREATE TABLE IF NOT EXISTS tournament_settings (
  tournament_slug TEXT PRIMARY KEY,
  -- Only a closed veto is stored. Opening deletes the row, so D1 can never
  -- override a frontmatter/CMS closure in the permissive direction.
  registration_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_open = 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
