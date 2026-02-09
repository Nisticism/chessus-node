-- Migration: Add Friend Challenge System
-- Adds columns to support private challenges between friends

-- Add is_challenge flag to mark challenge games
ALTER TABLE games ADD COLUMN is_challenge TINYINT(1) DEFAULT 0;

-- Add challenged_user_id to store who was challenged
ALTER TABLE games ADD COLUMN challenged_user_id INT NULL;

-- Add index for faster lookups
CREATE INDEX idx_games_challenge ON games(is_challenge, challenged_user_id);

-- Note: Challenge games will be:
-- 1. Not shown in open games list (is_challenge = 1)
-- 2. Only joinable by the challenged_user_id
-- 3. Still visible for spectating if allow_spectators = 1
