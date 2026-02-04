-- ============================================
-- LEGACY MIGRATION FILE (NOT USED)
-- This migration is no longer needed - the consolidation migration in server/migrations.js
-- handles adding all movement and capture columns directly to the pieces table.
-- The piece_capture table has been deprecated and consolidated into pieces.
-- This file is kept for historical reference only.
-- ============================================

-- Migration: Add available_for_moves columns to pieces table
-- This replaces the boolean "first move only" concept with numeric "available for first X moves"

-- Add columns for directional movements (how many moves each direction is available for)
ALTER TABLE pieces 
ADD COLUMN up_left_movement_available_for INT UNSIGNED NULL AFTER up_left_movement,
ADD COLUMN up_movement_available_for INT UNSIGNED NULL AFTER up_movement,
ADD COLUMN up_right_movement_available_for INT UNSIGNED NULL AFTER up_right_movement,
ADD COLUMN right_movement_available_for INT UNSIGNED NULL AFTER right_movement,
ADD COLUMN down_right_movement_available_for INT UNSIGNED NULL AFTER down_right_movement,
ADD COLUMN down_movement_available_for INT UNSIGNED NULL AFTER down_movement,
ADD COLUMN down_left_movement_available_for INT UNSIGNED NULL AFTER down_left_movement,
ADD COLUMN left_movement_available_for INT UNSIGNED NULL AFTER left_movement;

-- Check if piece_capture table exists and add columns for directional captures
-- (These match the capture directions in PieceStep3Attack.js)
ALTER TABLE piece_capture
ADD COLUMN up_left_capture_available_for INT UNSIGNED NULL,
ADD COLUMN up_capture_available_for INT UNSIGNED NULL,
ADD COLUMN up_right_capture_available_for INT UNSIGNED NULL,
ADD COLUMN right_capture_available_for INT UNSIGNED NULL,
ADD COLUMN down_right_capture_available_for INT UNSIGNED NULL,
ADD COLUMN down_capture_available_for INT UNSIGNED NULL,
ADD COLUMN down_left_capture_available_for INT UNSIGNED NULL,
ADD COLUMN left_capture_available_for INT UNSIGNED NULL;

-- Note: The special_scenario_moves and special_scenario_captures JSON fields 
-- will need to be updated to use "availableForMoves" instead of "firstMoveOnly"
-- This should be handled in the application code during save/load operations
