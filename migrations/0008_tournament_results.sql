-- SportScorpion stage snapshots synced from the admin portal. The public
-- tournament page reads only these non-personal result links at runtime, so
-- one tournament can be refreshed without rebuilding the static site.
CREATE TABLE IF NOT EXISTS tournament_results (
  tournament_slug TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'sportscorpion'),
  provider_tournament_id INTEGER NOT NULL CHECK (provider_tournament_id > 0),
  stages_json TEXT NOT NULL CHECK (json_valid(stages_json)),
  stage_count INTEGER NOT NULL CHECK (stage_count >= 0 AND stage_count <= 100),
  synced_at TEXT NOT NULL
);
