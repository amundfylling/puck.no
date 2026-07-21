-- Phase 3b: deduplicate ranked players on their ITHF player id.
-- A player can register with any number of email addresses, but has exactly
-- one ranking id. player_id is NULL for teams and unranked (new) players —
-- those keep the email-based guard (registrations_unique_entry).

ALTER TABLE registrations ADD COLUMN player_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_unique_ranked_player
  ON registrations (tournament_slug, player_id) WHERE player_id IS NOT NULL;
