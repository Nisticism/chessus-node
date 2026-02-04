-- Create junction table for game type and piece relationship
CREATE TABLE IF NOT EXISTS game_type_pieces (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_type_id INT UNSIGNED NOT NULL,
  piece_id INT UNSIGNED NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  player_number INT DEFAULT 1,
  FOREIGN KEY (game_type_id) REFERENCES game_types(id) ON DELETE CASCADE,
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  INDEX idx_game_type_id (game_type_id),
  INDEX idx_piece_id (piece_id),
  UNIQUE KEY unique_piece_position (game_type_id, x, y, player_number)
);
