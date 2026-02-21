CREATE TABLE IF NOT EXISTS tournament_participants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tournament_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_tournament_participant (tournament_id, user_id),
  INDEX idx_tournament_participants_tournament_id (tournament_id),
  INDEX idx_tournament_participants_user_id (user_id)
);
