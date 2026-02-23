-- Add en passant ability column to pieces table
-- En passant allows pieces to capture an enemy piece that has just used a first-move
-- movement to end up directly horizontal from this piece, by moving diagonally forward
-- past that piece. This mimics the pawn en passant rule from chess.

ALTER TABLE pieces
ADD COLUMN can_en_passant TINYINT(1) DEFAULT 0 COMMENT 'Whether this piece can capture via en passant';

-- Also add to game_type_pieces_junction for game-specific overrides
ALTER TABLE game_type_pieces_junction
ADD COLUMN can_en_passant TINYINT(1) DEFAULT NULL COMMENT 'Override: whether this piece can capture via en passant';
