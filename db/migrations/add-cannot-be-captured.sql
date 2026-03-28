-- Add cannot_be_captured column to pieces table
-- When enabled, the piece cannot be captured by any means (acts as a wall)
-- Useful for custom games like duck chess

ALTER TABLE pieces ADD COLUMN cannot_be_captured TINYINT(1) DEFAULT 0;
