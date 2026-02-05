-- Add checkmate and capture flags to game_type_pieces junction table
-- This allows each piece placement to specify if losing it ends the game

ALTER TABLE game_type_pieces 
ADD COLUMN ends_game_on_checkmate BOOLEAN DEFAULT FALSE,
ADD COLUMN ends_game_on_capture BOOLEAN DEFAULT FALSE;

-- Migrate existing data from pieces_string JSON to junction table columns
-- This will be handled by the application on next save/edit
