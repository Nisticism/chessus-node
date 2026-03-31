-- Migration: Add Hit Points (HP), Attack Damage (AD), HP Regen, and related columns to game_type_pieces
-- Also adds max_chain_hops to pieces table and cannot_be_captured to game_type_pieces

-- Per-placement HP and AD (defaults to 1 so pieces work like normal chess by default)
ALTER TABLE game_type_pieces
  ADD COLUMN hit_points INT DEFAULT 1,
  ADD COLUMN attack_damage INT DEFAULT 1;

-- Per-placement visibility toggle for HP/AD display
ALTER TABLE game_type_pieces
  ADD COLUMN show_hp_ad BOOLEAN DEFAULT 0;

-- Per-placement HP regeneration (0 = no regen, N = regen N HP per turn)
ALTER TABLE game_type_pieces
  ADD COLUMN hp_regen INT DEFAULT 0;

-- Per-placement cannot_be_captured override (moved from pieces table to per-placement)
ALTER TABLE game_type_pieces
  ADD COLUMN cannot_be_captured BOOLEAN DEFAULT 0;

-- Max chain hops per turn for pieces with chain_capture_enabled
ALTER TABLE pieces
  ADD COLUMN max_chain_hops INT DEFAULT NULL;
