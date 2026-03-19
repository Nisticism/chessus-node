-- Notifications System Migration
-- Stores all user notifications (friend requests, challenges, comments, game threads)

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(500),
  related_id INT UNSIGNED,
  action_url VARCHAR(300),
  is_read TINYINT(1) DEFAULT 0,
  is_actioned TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_user_unread (user_id, is_read)
);

-- Track weekly email digest scheduling
CREATE TABLE IF NOT EXISTS notification_email_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  notification_count INT UNSIGNED NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  week_start DATE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_week (user_id, week_start)
);
