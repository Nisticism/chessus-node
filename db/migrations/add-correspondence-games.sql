-- Migration: Add correspondence game support to games table
-- Correspondence games use days-per-move instead of minutes-per-player

ALTER TABLE chessusnode.games
  ADD COLUMN IF NOT EXISTS is_correspondence TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correspondence_days INT DEFAULT NULL;

-- is_correspondence: 1 = daily/correspondence game, 0 = live game
-- correspondence_days: number of days per move (1, 2, 3, 5, 7, 14)
-- When is_correspondence = 1, turn_length is NULL (not used)
