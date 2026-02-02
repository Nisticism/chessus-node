-- Migration: Add castling ability column to pieces table
-- Date: 2024

-- Add can_castle column
ALTER TABLE pieces 
ADD COLUMN can_castle BOOLEAN DEFAULT FALSE AFTER has_lose_on_capture_rule;
