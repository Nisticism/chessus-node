-- Migration: Add featured games support
-- Adds featured_order column to game_types table to allow admins to select which games appear on homepage

-- Add featured_order column (NULL means not featured, 1-3 means position)
ALTER TABLE game_types ADD COLUMN featured_order INT NULL DEFAULT NULL;

-- Add index for faster lookups
CREATE INDEX idx_game_types_featured ON game_types(featured_order);
