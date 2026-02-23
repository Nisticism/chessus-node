-- Add ranged attack firing over pieces columns to pieces table
-- Similar to can_hop_over_allies and can_hop_over_enemies for movement,
-- these control whether ranged attacks can fire over other pieces

ALTER TABLE pieces
ADD COLUMN can_fire_over_allies TINYINT(1) DEFAULT 0 COMMENT 'Whether ranged attacks can fire over allied pieces',
ADD COLUMN can_fire_over_enemies TINYINT(1) DEFAULT 0 COMMENT 'Whether ranged attacks can fire over enemy pieces';

-- Also add to game_type_pieces_junction for game-specific overrides
ALTER TABLE game_type_pieces_junction
ADD COLUMN can_fire_over_allies TINYINT(1) DEFAULT NULL COMMENT 'Override: whether ranged attacks can fire over allied pieces',
ADD COLUMN can_fire_over_enemies TINYINT(1) DEFAULT NULL COMMENT 'Override: whether ranged attacks can fire over enemy pieces';
