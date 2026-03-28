-- Add directional_hop_disabled column to pieces table
-- When enabled, hopping over pieces is disabled for directional (sliding) movements.
-- Hopping still works for ratio (L-shape) movements.
-- Example: a knight-bishop hybrid can hop with knight movement but not bishop movement.

ALTER TABLE pieces ADD COLUMN directional_hop_disabled TINYINT(1) DEFAULT 0;
