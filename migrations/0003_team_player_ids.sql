-- Phase 3c: deduplicate team tournaments by player IDs rather than email.
-- Allow duplicate contact emails for team tournaments, and store player_ids
-- JSON array for team deduplication.

DROP INDEX IF EXISTS registrations_unique_entry;

-- Unique email index for unranked individual players only
CREATE UNIQUE INDEX IF NOT EXISTS registrations_unique_individual_email
  ON registrations (tournament_slug, lower(email))
  WHERE type = 'player' AND player_id IS NULL;

ALTER TABLE registrations ADD COLUMN player_ids TEXT;
