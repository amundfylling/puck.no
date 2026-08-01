-- Exact Player_Value input required by the ITHF WR 2020 placement algorithm.
-- This is distinct from ranking_points, which is the player's total WR score.

ALTER TABLE registrations ADD COLUMN ranking_value REAL;
