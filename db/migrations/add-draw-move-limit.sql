-- Add draw condition for X moves without captures
-- This implements a generalized "50-move rule" that can be configured per game

ALTER TABLE game_types 
ADD COLUMN draw_move_limit INT NULL DEFAULT NULL
COMMENT 'Number of moves without captures before game is drawn (NULL = disabled)';
