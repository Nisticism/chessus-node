-- Migration: Add castling_distance column to game_type_pieces table
-- This allows configuring how many squares a castling piece moves toward its partner
-- Default is 2 (standard chess king castling distance)

ALTER TABLE game_type_pieces
ADD COLUMN castling_distance INT DEFAULT 2 AFTER castling_partner_right_key;
