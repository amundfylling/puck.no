-- Variable team rosters, current ITHF points and tournament-specific answers.
-- roster/answers are JSON text because D1/SQLite has no native JSON column.

ALTER TABLE registrations ADD COLUMN club TEXT;
ALTER TABLE registrations ADD COLUMN ranking_points INTEGER;
ALTER TABLE registrations ADD COLUMN roster TEXT;
ALTER TABLE registrations ADD COLUMN answers TEXT;

CREATE TABLE IF NOT EXISTS ranking_refreshes (
  tournament_slug TEXT PRIMARY KEY,
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS registrations_tournament_seed
  ON registrations (tournament_slug, ranking_points DESC, world_ranking ASC);
