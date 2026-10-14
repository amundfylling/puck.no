-- Puck Awards nominations from the public /puck-awards page. One row per
-- submitted category; rows sharing submission_id came from the same form.
-- Nominations are admin-only (never exposed publicly); the nominator's name
-- is optional and no contact details are stored.
CREATE TABLE IF NOT EXISTS award_nominations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  award_year INTEGER NOT NULL CHECK (award_year >= 2000 AND award_year <= 2100),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  nominee TEXT NOT NULL CHECK (length(nominee) BETWEEN 1 AND 120),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
  nominator TEXT CHECK (nominator IS NULL OR length(nominator) <= 120),
  submission_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_award_nominations_year_category
  ON award_nominations (award_year, category);
