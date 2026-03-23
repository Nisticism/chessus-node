-- Add exact_ratio_hop_only column to pieces table
-- When enabled, exact directional movement/capture and ratio movement/capture
-- only work when the piece is hopping over another piece in its path.
-- This is essential for checkers-style pieces (e.g., a Man that moves 1 diagonal
-- normally but can move 2 diagonals only when jumping over a piece).

ALTER TABLE pieces ADD COLUMN exact_ratio_hop_only TINYINT(1) DEFAULT 0;
