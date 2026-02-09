-- Fix player_number corruption in game_type_pieces junction table
-- This script updates player_number based on Y position for standard board layouts
-- Top half of board (y < board_height/2) = Player 2
-- Bottom half of board (y >= board_height/2) = Player 1

-- For 8x8 boards (standard chess):
-- Rows 0-3 = Player 2 (black)
-- Rows 4-7 = Player 1 (white)

-- First, let's see what needs to be fixed (run this SELECT first to verify)
-- SELECT gtp.id, gtp.game_type_id, gtp.piece_id, gtp.x, gtp.y, gtp.player_number,
--        gt.board_height,
--        CASE WHEN gtp.y < (gt.board_height / 2) THEN 2 ELSE 1 END as should_be
-- FROM game_type_pieces gtp
-- JOIN game_types gt ON gtp.game_type_id = gt.id
-- WHERE gtp.player_number != CASE WHEN gtp.y < (gt.board_height / 2) THEN 2 ELSE 1 END;

-- Fix the player_number based on Y position
UPDATE game_type_pieces gtp
JOIN game_types gt ON gtp.game_type_id = gt.id
SET gtp.player_number = CASE 
    WHEN gtp.y < (gt.board_height / 2) THEN 2 
    ELSE 1 
END
WHERE gtp.player_number = 1;  -- Only update pieces that are incorrectly set to player 1

-- Note: This assumes standard board orientation where:
-- - Player 2 (black) starts at the top (lower Y values)
-- - Player 1 (white) starts at the bottom (higher Y values)
-- 
-- If you have non-standard games with different layouts, you may need to
-- manually review and fix those games.
