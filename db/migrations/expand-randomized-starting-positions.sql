-- Migration: Expand randomized_starting_positions column to handle larger JSON data
-- This migration increases the column size from VARCHAR(1000) to TEXT
-- to accommodate larger starting position configurations without data loss

-- Expand the column in game_types table
ALTER TABLE game_types 
MODIFY COLUMN randomized_starting_positions TEXT;

-- Expand the column in games table  
ALTER TABLE games 
MODIFY COLUMN randomized_starting_positions TEXT;
