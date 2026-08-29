const db_pool = require("../configs/db");

/**
 * Check if a table exists
 */
const tableExists = async (tableName) => {
  const sql = `
    SELECT COUNT(*) as count 
    FROM information_schema.TABLES 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ?
  `;
  const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode', tableName]);
  return results[0].count > 0;
};

/**
 * Check if a column exists in a table
 */
const columnExists = async (tableName, columnName) => {
  const sql = `
    SELECT COUNT(*) as count 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ? 
    AND COLUMN_NAME = ?
  `;
  const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode', tableName, columnName]);
  return results[0].count > 0;
};

/**
 * Get column type
 */
const getColumnType = async (tableName, columnName) => {
  const sql = `
    SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ? 
    AND COLUMN_NAME = ?
  `;
  const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode', tableName, columnName]);
  return results[0] || null;
};

/**
 * Run a migration SQL statement
 */
const runMigration = async (sql, description) => {
  try {
    await db_pool.query(sql);
    console.log(`[OK] ${description}`);
  } catch (err) {
    console.error(`Migration failed: ${description}`, err.message);
    throw err;
  }
};

/**
 * Define all migrations here
 */
const tableMigrations = [
  {
    table: 'pieces',
    sql: `CREATE TABLE IF NOT EXISTS pieces (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      piece_name VARCHAR(50) NOT NULL,
      piece_description VARCHAR(1000),
      piece_width INT DEFAULT 1,
      piece_height INT DEFAULT 1,
      image_location TEXT,
      creator_id INT UNSIGNED,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )`,
    description: "Create pieces table"
  },
  {
    table: 'game_type_pieces',
    sql: `CREATE TABLE IF NOT EXISTS game_type_pieces (
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
    )`,
    description: "Create game_type_pieces junction table"
  },
  {
    table: 'tournaments',
    sql: `CREATE TABLE IF NOT EXISTS tournaments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      format VARCHAR(40) NOT NULL,
      game_type_id INT UNSIGNED NOT NULL,
      time_control INT UNSIGNED NOT NULL,
      increment_seconds INT UNSIGNED NOT NULL DEFAULT 0,
      min_players INT UNSIGNED NOT NULL,
      max_players INT UNSIGNED NOT NULL,
      is_private TINYINT(1) NOT NULL DEFAULT 0,
      start_datetime DATETIME NOT NULL,
      number_of_rounds INT UNSIGNED NOT NULL,
      expected_length_minutes INT UNSIGNED NOT NULL,
      status ENUM('open', 'full', 'started', 'completed', 'cancelled') DEFAULT 'open',
      created_by_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (game_type_id) REFERENCES game_types(id),
      FOREIGN KEY (created_by_id) REFERENCES users(id),
      INDEX idx_tournaments_game_type_id (game_type_id),
      INDEX idx_tournaments_created_by_id (created_by_id),
      INDEX idx_tournaments_status (status),
      INDEX idx_tournaments_start_datetime (start_datetime)
    )`,
    description: "Create tournaments table"
  },
  {
    table: 'tournament_participants',
    sql: `CREATE TABLE IF NOT EXISTS tournament_participants (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      tournament_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_tournament_participant (tournament_id, user_id),
      INDEX idx_tournament_participants_tournament_id (tournament_id),
      INDEX idx_tournament_participants_user_id (user_id)
    )`,
    description: "Create tournament_participants table"
  },
  {
    table: 'donations',
    sql: `CREATE TABLE IF NOT EXISTS donations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NULL,
      email VARCHAR(255) NULL,
      username VARCHAR(255) NULL,
      amount DECIMAL(10,2) NOT NULL,
      method VARCHAR(32) NOT NULL,
      transaction_id VARCHAR(255) NOT NULL,
      is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_method_txn (method, transaction_id),
      INDEX idx_donations_user_id (user_id),
      INDEX idx_donations_email (email)
    )`,
    description: "Create donations ledger table for idempotent payment tracking (Stripe/PayPal webhooks)"
  },
  // ============================================
  // LEGACY TABLE DEFINITIONS (HISTORICAL ONLY)
  // These definitions are kept for reference but are no longer used.
  // The piece_movement and piece_capture tables have been consolidated
  // into the pieces table (see consolidation migration at lines 1105-1356).
  // These old table definitions will not be created if they don't exist.
  // ============================================
  {
    table: 'piece_movement',
    sql: `CREATE TABLE IF NOT EXISTS piece_movement (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      piece_id INT UNSIGNED NOT NULL,
      directional_movement_style TINYINT(1) DEFAULT NULL,
      repeating_movement TINYINT(1) DEFAULT NULL,
      max_directional_movement_iterations INT DEFAULT NULL,
      min_directional_movement_iterations INT DEFAULT NULL,
      up_left_movement INT DEFAULT 0,
      up_movement INT DEFAULT 0,
      up_right_movement INT DEFAULT 0,
      right_movement INT DEFAULT 0,
      down_right_movement INT DEFAULT 0,
      down_movement INT DEFAULT 0,
      down_left_movement INT DEFAULT 0,
      left_movement INT DEFAULT 0,
      ratio_movement_style TINYINT(1) DEFAULT NULL,
      ratio_one_movement INT DEFAULT NULL,
      ratio_two_movement INT DEFAULT NULL,
      repeating_ratio TINYINT(1) DEFAULT NULL,
      max_ratio_iterations INT DEFAULT NULL,
      min_ratio_iterations INT DEFAULT NULL,
      step_by_step_movement_style TINYINT(1) DEFAULT NULL,
      step_by_step_movement_value INT DEFAULT NULL,
      can_hop_over_allies TINYINT(1) DEFAULT NULL,
      can_hop_over_enemies TINYINT(1) DEFAULT NULL,
      min_turns_per_move INT DEFAULT NULL,
      max_turns_per_move INT DEFAULT NULL,
      special_scenario_moves VARCHAR(1000) DEFAULT NULL,
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    )`,
    description: "Create piece_movement table"
  },
  {
    table: 'piece_capture',
    sql: `CREATE TABLE IF NOT EXISTS piece_capture (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      piece_id INT UNSIGNED NOT NULL,
      can_capture_enemy_via_range TINYINT(1) DEFAULT NULL,
      can_capture_ally_via_range TINYINT(1) DEFAULT NULL,
      can_capture_enemy_on_move TINYINT(1) DEFAULT NULL,
      can_capture_ally_on_range TINYINT(1) DEFAULT NULL,
      can_attack_on_iteration TINYINT(1) DEFAULT NULL,
      up_left_capture INT DEFAULT 0,
      up_capture INT DEFAULT 0,
      up_right_capture INT DEFAULT 0,
      right_capture INT DEFAULT 0,
      down_right_capture INT DEFAULT 0,
      down_capture INT DEFAULT 0,
      down_left_capture INT DEFAULT 0,
      left_capture INT DEFAULT 0,
      ratio_one_capture INT DEFAULT NULL,
      ratio_two_capture INT DEFAULT NULL,
      step_by_step_capture INT DEFAULT NULL,
      up_left_attack_range INT DEFAULT NULL,
      up_attack_range INT DEFAULT NULL,
      up_right_attack_range INT DEFAULT NULL,
      right_attack_range INT DEFAULT NULL,
      down_right_attack_range INT DEFAULT NULL,
      down_attack_range INT DEFAULT NULL,
      down_left_attack_range INT DEFAULT NULL,
      left_attack_range INT DEFAULT NULL,
      repeating_directional_ranged_attack TINYINT(1) DEFAULT NULL,
      max_directional_ranged_attack_iterations INT DEFAULT NULL,
      min_directional_ranged_attack_iterations INT DEFAULT NULL,
      ratio_one_attack_range INT DEFAULT NULL,
      ratio_two_attack_range INT DEFAULT NULL,
      repeating_ratio_ranged_attack TINYINT(1) DEFAULT NULL,
      max_ratio_ranged_attack_iterations INT DEFAULT NULL,
      min_ratio_ranged_attack_iterations INT DEFAULT NULL,
      step_by_step_attack_style TINYINT(1) DEFAULT NULL,
      step_by_step_attack_value TINYINT(1) DEFAULT NULL,
      max_piece_captures_per_move INT DEFAULT NULL,
      max_piece_captures_per_ranged_attack INT DEFAULT NULL,
      special_scenario_captures VARCHAR(1000) DEFAULT NULL,
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    )`,
    description: "Create piece_capture table"
  },
  {
    table: 'streams',
    sql: `CREATE TABLE IF NOT EXISTS streams (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      streamer_name VARCHAR(100) NOT NULL,
      description TEXT,
      stream_url VARCHAR(500) NOT NULL,
      thumbnail_url VARCHAR(500),
      category ENUM('tournament', 'tutorial', 'casual', 'community', 'other') DEFAULT 'other',
      platform ENUM('twitch', 'youtube', 'kick', 'other') DEFAULT 'other',
      is_live BOOLEAN DEFAULT FALSE,
      is_featured BOOLEAN DEFAULT FALSE,
      viewer_count INT DEFAULT 0,
      game_name VARCHAR(100),
      created_by INT UNSIGNED,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      scheduled_start DATETIME,
      scheduled_end DATETIME,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_streams_is_live (is_live),
      INDEX idx_streams_category (category),
      INDEX idx_streams_featured (is_featured)
    )`,
    description: "Create streams table"
  },
  {
    table: 'image_moderation_queue',
    sql: `CREATE TABLE IF NOT EXISTS image_moderation_queue (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      piece_id INT UNSIGNED,
      uploader_id INT UNSIGNED,
      image_path VARCHAR(500) NOT NULL,
      status ENUM('pending_review', 'approved', 'rejected') DEFAULT 'pending_review',
      nsfw_scores JSON,
      auto_reason VARCHAR(500),
      reviewer_id INT UNSIGNED,
      review_note VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
      FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_moderation_status (status),
      INDEX idx_moderation_piece (piece_id),
      INDEX idx_moderation_uploader (uploader_id)
    )`,
    description: "Create image moderation queue table"
  },
  {
    table: 'site_settings',
    sql: `CREATE TABLE IF NOT EXISTS site_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value VARCHAR(500) NOT NULL DEFAULT 'true',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    description: "Create site_settings table for admin-configurable site options"
  },
  {
    table: 'game_type_upvotes',
    sql: `CREATE TABLE IF NOT EXISTS game_type_upvotes (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      game_type_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_type_id) REFERENCES game_types(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_upvote (game_type_id, user_id),
      INDEX idx_upvotes_game_type_id (game_type_id),
      INDEX idx_upvotes_user_id (user_id)
    )`,
    description: "Create game_type_upvotes table for game upvote system"
  },
  {
    table: 'deleted_users',
    sql: `CREATE TABLE IF NOT EXISTS deleted_users (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      original_user_id INT UNSIGNED NOT NULL,
      previous_username VARCHAR(50),
      deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_by_user_id INT UNSIGNED,
      deletion_type VARCHAR(20),
      INDEX idx_deleted_users_user_id (original_user_id),
      INDEX idx_deleted_users_deleted_at (deleted_at)
    )`,
    description: "Create deleted_users audit table"
  },
  {
    table: 'name_review_queue',
    sql: `CREATE TABLE IF NOT EXISTS name_review_queue (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      item_type ENUM('game', 'piece') NOT NULL,
      item_id INT UNSIGNED NOT NULL,
      submitter_id INT UNSIGNED,
      flagged_name VARCHAR(200) NOT NULL,
      triggered_words VARCHAR(500),
      status ENUM('pending_review', 'approved', 'rejected') DEFAULT 'pending_review',
      reviewer_id INT UNSIGNED,
      review_note VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY (submitter_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_name_review_status (status),
      INDEX idx_name_review_item (item_type, item_id)
    )`,
    description: "Create name_review_queue table for flagging game/piece names that contain sensitive terms"
  },
  {
    table: 'ai_training_jobs',
    sql: `CREATE TABLE IF NOT EXISTS ai_training_jobs (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      game_type_id INT UNSIGNED NOT NULL,
      status ENUM('queued','running','completed','stopped','failed','aborted_oom','interrupted') NOT NULL DEFAULT 'queued',
      games_target INT UNSIGNED NOT NULL DEFAULT 100,
      games_played INT UNSIGNED NOT NULL DEFAULT 0,
      mcts_iters INT UNSIGNED NOT NULL DEFAULT 200,
      max_rss_mb INT UNSIGNED NOT NULL DEFAULT 1024,
      checkpoint_every INT UNSIGNED NOT NULL DEFAULT 25,
      seed BIGINT UNSIGNED NOT NULL DEFAULT 0,
      rules_path VARCHAR(500),
      created_by_user_id INT UNSIGNED,
      started_at DATETIME,
      ended_at DATETIME,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ai_jobs_game_type (game_type_id),
      INDEX idx_ai_jobs_status (status),
      FOREIGN KEY (game_type_id) REFERENCES game_types(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    description: "Create ai_training_jobs table for AI self-play training tracking"
  },
  {
    table: 'ai_models',
    sql: `CREATE TABLE IF NOT EXISTS ai_models (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      game_type_id INT UNSIGNED NOT NULL,
      job_id INT UNSIGNED,
      file_path VARCHAR(500) NOT NULL,
      games_trained INT UNSIGNED NOT NULL DEFAULT 0,
      is_current TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ai_models_game (game_type_id),
      INDEX idx_ai_models_current (game_type_id, is_current),
      FOREIGN KEY (game_type_id) REFERENCES game_types(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES ai_training_jobs(id) ON DELETE SET NULL
    )`,
    description: "Create ai_models table tracking trained AI model checkpoints"
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS polls (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      question VARCHAR(500) NOT NULL,
      options JSON NOT NULL COMMENT 'Array of option strings',
      is_visible TINYINT(1) NOT NULL DEFAULT 0,
      expires_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    description: "Create polls table for admin-controlled site polls"
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS poll_votes (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      poll_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      option_index SMALLINT UNSIGNED NOT NULL,
      voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_poll_user (poll_id, user_id),
      INDEX idx_poll_votes_poll (poll_id),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    description: "Create poll_votes table for user poll responses"
  },
  {
    table: 'comment_emotes',
    sql: `CREATE TABLE IF NOT EXISTS comment_emotes (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      comment_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      emote_type VARCHAR(20) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT NOW(),
      UNIQUE KEY uq_comment_user_emote (comment_id, user_id, emote_type),
      INDEX idx_ce_comment (comment_id),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    description: "Create comment_emotes table for emoji reactions on forum comments"
  },
  {
    table: 'trainer_user_events',
    sql: `CREATE TABLE IF NOT EXISTS trainer_user_events (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED,
      game_type_id INT UNSIGNED NULL,
      event_type ENUM('download','upload') NOT NULL,
      platform VARCHAR(20),
      trainer_version VARCHAR(20),
      ip_address VARCHAR(45),
      created_at DATETIME NOT NULL DEFAULT NOW(),
      INDEX idx_tue_user (user_id),
      INDEX idx_tue_game (game_type_id),
      INDEX idx_tue_created (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    description: "Create trainer_user_events table for standalone trainer download/upload audit log"
  },
  {
    table: 'trainer_api_keys',
    sql: `CREATE TABLE IF NOT EXISTS trainer_api_keys (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      key_hash VARCHAR(64) NOT NULL,
      key_prefix VARCHAR(20) NOT NULL,
      name VARCHAR(100) NOT NULL DEFAULT 'Default',
      created_at DATETIME NOT NULL DEFAULT NOW(),
      last_used_at DATETIME NULL,
      UNIQUE INDEX idx_tak_hash (key_hash),
      INDEX idx_tak_user (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    description: "Create trainer_api_keys table for standalone trainer CLI authentication"
  }
];

const migrations = [
  {
    table: 'users',
    column: 'username',
    sql: "ALTER TABLE users ADD COLUMN username VARCHAR(50) NOT NULL AFTER last_name",
    description: "Add username column to users table"
  },
  {
    table: 'users',
    column: 'password',
    sql: "ALTER TABLE users ADD COLUMN password VARCHAR(100) AFTER email",
    description: "Add password column to users table"
  },
  {
    table: 'users',
    column: 'role',
    sql: "ALTER TABLE users ADD COLUMN role VARCHAR(20) AFTER password",
    description: "Add role column to users table"
  },
  {
    table: 'users',
    column: 'timezone',
    sql: "ALTER TABLE users ADD COLUMN timezone VARCHAR(30) AFTER last_active_at",
    description: "Add timezone column to users table"
  },
  {
    table: 'users',
    column: 'lang',
    sql: "ALTER TABLE users ADD COLUMN lang VARCHAR(30) AFTER timezone",
    description: "Add lang column to users table"
  },
  {
    table: 'users',
    column: 'country',
    sql: "ALTER TABLE users ADD COLUMN country VARCHAR(30) AFTER lang",
    description: "Add country column to users table"
  },
  {
    table: 'users',
    column: 'bio',
    sql: "ALTER TABLE users ADD COLUMN bio VARCHAR(500) AFTER country",
    description: "Add bio column to users table"
  },
  {
    table: 'users',
    column: 'light_square_color',
    sql: "ALTER TABLE users ADD COLUMN light_square_color VARCHAR(20) DEFAULT '#cad5e8' AFTER bio",
    description: "Add light_square_color column to users table"
  },
  {
    table: 'users',
    column: 'dark_square_color',
    sql: "ALTER TABLE users ADD COLUMN dark_square_color VARCHAR(20) DEFAULT '#08234d' AFTER light_square_color",
    description: "Add dark_square_color column to users table"
  },
  {
    table: 'users',
    column: 'elo',
    sql: "ALTER TABLE users ADD COLUMN elo INT DEFAULT 1000 AFTER dark_square_color",
    description: "Add elo column to users table"
  },
  {
    table: 'users',
    column: 'profile_picture',
    sql: "ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) AFTER elo",
    description: "Add profile_picture column to users table"
  },
  {
    table: 'users',
    column: 'refresh_token',
    sql: "ALTER TABLE users ADD COLUMN refresh_token TEXT AFTER profile_picture",
    description: "Add refresh_token column to users table"
  },
  {
    table: 'users',
    column: 'total_donations',
    sql: "ALTER TABLE users ADD COLUMN total_donations DECIMAL(10, 2) DEFAULT 0.00 AFTER refresh_token",
    description: "Add total_donations column to users table for donor badge system"
  },
  {
    table: 'game_type_pieces',
    column: 'ends_game_on_checkmate',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN ends_game_on_checkmate BOOLEAN DEFAULT FALSE",
    description: "Add ends_game_on_checkmate column to game_type_pieces junction table"
  },
  {
    table: 'game_type_pieces',
    column: 'ends_game_on_capture',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN ends_game_on_capture BOOLEAN DEFAULT FALSE",
    description: "Add ends_game_on_capture column to game_type_pieces junction table"
  },
  {
    table: 'game_type_pieces',
    column: 'manual_castling_partners',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN manual_castling_partners BOOLEAN DEFAULT FALSE",
    description: "Add manual_castling_partners column to game_type_pieces for castling override"
  },
  {
    table: 'game_type_pieces',
    column: 'castling_partner_left_key',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN castling_partner_left_key VARCHAR(20) DEFAULT NULL",
    description: "Add castling_partner_left_key column to game_type_pieces for manual left partner"
  },
  {
    table: 'game_type_pieces',
    column: 'castling_partner_right_key',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN castling_partner_right_key VARCHAR(20) DEFAULT NULL",
    description: "Add castling_partner_right_key column to game_type_pieces for manual right partner"
  },
  {
    table: 'game_type_pieces',
    column: 'castling_distance',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN castling_distance INT DEFAULT 2",
    description: "Add castling_distance column to game_type_pieces for configurable castling distance"
  },
  {
    table: 'pieces',
    column: 'can_fire_over_allies',
    sql: "ALTER TABLE pieces ADD COLUMN can_fire_over_allies TINYINT(1) DEFAULT 0",
    description: "Add can_fire_over_allies column to pieces for ranged attack firing over allies"
  },
  {
    table: 'pieces',
    column: 'can_fire_over_enemies',
    sql: "ALTER TABLE pieces ADD COLUMN can_fire_over_enemies TINYINT(1) DEFAULT 0",
    description: "Add can_fire_over_enemies column to pieces for ranged attack firing over enemies"
  },
  {
    table: 'pieces',
    column: 'can_en_passant',
    sql: "ALTER TABLE pieces ADD COLUMN can_en_passant TINYINT(1) DEFAULT 0",
    description: "Add can_en_passant column to pieces for en passant capture ability"
  },
  {
    table: 'game_type_pieces',
    column: 'can_fire_over_allies',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN can_fire_over_allies TINYINT(1) DEFAULT NULL",
    description: "Add can_fire_over_allies column to game_type_pieces junction for game-specific overrides"
  },
  {
    table: 'game_type_pieces',
    column: 'can_fire_over_enemies',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN can_fire_over_enemies TINYINT(1) DEFAULT NULL",
    description: "Add can_fire_over_enemies column to game_type_pieces junction for game-specific overrides"
  },
  {
    table: 'game_type_pieces',
    column: 'can_en_passant',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN can_en_passant TINYINT(1) DEFAULT NULL",
    description: "Add can_en_passant column to game_type_pieces junction for game-specific overrides"
  },
  {
    table: 'game_types',
    column: 'control_squares_string',
    sql: "ALTER TABLE game_types ADD COLUMN control_squares_string TEXT DEFAULT NULL",
    description: "Add control_squares_string column to game_types for control square win condition configuration"
  },
  {
    table: 'game_type_pieces',
    column: 'can_control_squares',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN can_control_squares TINYINT(1) DEFAULT 0",
    description: "Add can_control_squares column to game_type_pieces for pieces that can control squares"
  },
  {
    table: 'pieces',
    column: 'exact_ratio_hop_only',
    sql: "ALTER TABLE pieces ADD COLUMN exact_ratio_hop_only TINYINT(1) DEFAULT 0",
    description: "Add exact_ratio_hop_only column - when enabled, exact and ratio movement/attacks only work when hopping"
  },
  {
    table: 'pieces',
    column: 'directional_hop_disabled',
    sql: "ALTER TABLE pieces ADD COLUMN directional_hop_disabled TINYINT(1) DEFAULT 0",
    description: "Add directional_hop_disabled column - when enabled, hopping is disabled for directional (sliding) movements but still works for ratio (L-shape) movements"
  },
  {
    table: 'pieces',
    column: 'repeating_capture',
    sql: "ALTER TABLE pieces ADD COLUMN repeating_capture TINYINT(1) DEFAULT 0",
    description: "Add repeating_capture column - when enabled with exact captures, the piece can repeat its exact capture distance infinitely"
  },
  {
    table: 'pieces',
    column: 'repeating_ratio_capture',
    sql: "ALTER TABLE pieces ADD COLUMN repeating_ratio_capture TINYINT(1) DEFAULT 0",
    description: "Add repeating_ratio_capture column - when enabled, ratio captures can repeat for multiple iterations"
  },
  {
    table: 'pieces',
    column: 'max_ratio_capture_iterations',
    sql: "ALTER TABLE pieces ADD COLUMN max_ratio_capture_iterations INT DEFAULT NULL",
    description: "Add max_ratio_capture_iterations column - max iterations for ratio capture (-1 for infinite)"
  },
  {
    table: 'pieces',
    column: 'can_capture_allies',
    sql: "ALTER TABLE pieces ADD COLUMN can_capture_allies TINYINT(1) DEFAULT 0",
    description: "Add can_capture_allies column - when enabled, the piece can capture allied pieces with any attack method"
  },
  {
    table: 'pieces',
    column: 'cannot_be_captured',
    sql: "ALTER TABLE pieces ADD COLUMN cannot_be_captured TINYINT(1) DEFAULT 0",
    description: "Add cannot_be_captured column - when enabled, the piece cannot be captured by any means (acts as a wall)"
  },
  // HP/AD system migrations
  {
    table: 'game_type_pieces',
    column: 'hit_points',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN hit_points INT DEFAULT 1",
    description: "Add hit_points column to game_type_pieces - HP per piece placement (default 1 = normal capture)"
  },
  {
    table: 'game_type_pieces',
    column: 'attack_damage',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN attack_damage INT DEFAULT 1",
    description: "Add attack_damage column to game_type_pieces - AD per piece placement (default 1 = normal capture)"
  },
  {
    table: 'game_type_pieces',
    column: 'show_hp_ad',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN show_hp_ad TINYINT(1) DEFAULT 0",
    description: "Add show_hp_ad column to game_type_pieces - per-piece toggle to show HP/AD on board"
  },
  {
    table: 'game_type_pieces',
    column: 'hp_regen',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN hp_regen INT DEFAULT 0",
    description: "Add hp_regen column to game_type_pieces - HP regenerated per turn (0 = none)"
  },
  {
    table: 'game_type_pieces',
    column: 'cannot_be_captured',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN cannot_be_captured TINYINT(1) DEFAULT 0",
    description: "Add cannot_be_captured column to game_type_pieces - per-placement override for damage immunity"
  },
  {
    table: 'game_type_pieces',
    column: 'show_regen',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN show_regen TINYINT(1) DEFAULT 0",
    description: "Add show_regen column to game_type_pieces - toggle visibility of regen badge (default visible)"
  },
  {
    table: 'pieces',
    column: 'max_chain_hops',
    sql: "ALTER TABLE pieces ADD COLUMN max_chain_hops INT DEFAULT NULL",
    description: "Add max_chain_hops column to pieces - limits chain capture hops per turn (NULL = unlimited)"
  },
  // Burn damage (DOT) system migrations
  {
    table: 'game_type_pieces',
    column: 'burn_damage',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN burn_damage INT DEFAULT 0",
    description: "Add burn_damage column to game_type_pieces - DOT damage inflicted per turn on attacked targets (0 = none)"
  },
  {
    table: 'game_type_pieces',
    column: 'burn_duration',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN burn_duration INT DEFAULT 0",
    description: "Add burn_duration column to game_type_pieces - number of turns burn damage lasts (0 = none)"
  },
  {
    table: 'game_type_pieces',
    column: 'show_burn',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN show_burn TINYINT(1) DEFAULT 0",
    description: "Add show_burn column to game_type_pieces - whether to display burn badge on this piece during gameplay"
  },
  {
    table: 'pieces',
    column: 'moderation_status',
    sql: "ALTER TABLE pieces ADD COLUMN moderation_status ENUM('approved', 'pending_review', 'rejected') DEFAULT 'approved'",
    description: "Add moderation_status column to pieces for image moderation tracking"
  },
  {
    table: 'game_type_pieces',
    column: 'image_index',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN image_index INT NULL DEFAULT NULL",
    description: "Add image_index to game_type_pieces - per-placement override of which image (from pieces.image_location array) to display, NULL = use default (player_id-1)"
  },
  {
    table: 'game_type_pieces',
    column: 'promotion_pieces_override',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN promotion_pieces_override TEXT NULL",
    description: "Per-placement override for promotion target piece IDs (JSON array). NULL = use default behavior (any non-promotable, non-checkmate, non-capture piece in starting set)."
  },
  {
    table: 'game_type_pieces',
    column: 'can_promote_to_checkmate',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN can_promote_to_checkmate TINYINT(1) DEFAULT 0",
    description: "When 1, this placement may include checkmate (game-ending) pieces in its promotion targets."
  },
  {
    table: 'game_type_pieces',
    column: 'limit_promote_checkmate_to_original',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN limit_promote_checkmate_to_original TINYINT(1) DEFAULT 0",
    description: "When 1 and can_promote_to_checkmate is set, hide checkmate targets from this player's promotion modal once they own >= the original starting count of those checkmate pieces."
  },
  {
    table: 'game_type_pieces',
    column: 'can_promote_to_capture',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN can_promote_to_capture TINYINT(1) DEFAULT 0",
    description: "When 1, this placement may include capture-loss (lose-on-capture) pieces in its promotion targets."
  },
  {
    table: 'game_type_pieces',
    column: 'limit_promote_capture_to_original',
    sql: "ALTER TABLE game_type_pieces ADD COLUMN limit_promote_capture_to_original TINYINT(1) DEFAULT 0",
    description: "When 1 and can_promote_to_capture is set, hide capture-loss targets from this player's promotion modal once they own >= the original starting count of those pieces."
  },
  {
    table: 'pieces',
    column: 'must_move_if_able',
    sql: "ALTER TABLE pieces ADD COLUMN must_move_if_able TINYINT(1) DEFAULT 0",
    description: "Add must_move_if_able column - when enabled, the piece is forced to move on its owner's turn if it has any legal move (e.g., the duck in Duck Chess)."
  },
  {
    table: 'pieces',
    column: 'must_move_uses_action',
    sql: "ALTER TABLE pieces ADD COLUMN must_move_uses_action TINYINT(1) DEFAULT 0",
    description: "Add must_move_uses_action column - when enabled (and must_move_if_able is set), the forced move consumes one of the player's actions per turn instead of being free."
  },
  {
    table: 'game_types',
    column: 'name_review_status',
    sql: "ALTER TABLE game_types ADD COLUMN name_review_status ENUM('approved', 'pending_review', 'rejected') DEFAULT 'approved'",
    description: "Add name_review_status to game_types - tracks whether the game name passed the professional name review"
  },
  {
    table: 'pieces',
    column: 'name_review_status',
    sql: "ALTER TABLE pieces ADD COLUMN name_review_status ENUM('approved', 'pending_review', 'rejected') DEFAULT 'approved'",
    description: "Add name_review_status to pieces - tracks whether the piece name passed the professional name review"
  },
  {
    table: 'pieces',
    column: 'max_directional_hop_pieces',
    sql: "ALTER TABLE pieces ADD COLUMN max_directional_hop_pieces TINYINT DEFAULT NULL",
    description: "Add max_directional_hop_pieces column - when set (1-4), limits the maximum number of pieces this piece may hop over in a single directional move. Works alongside directional_hop_only."
  },
  {
    table: 'pieces',
    column: 'max_directional_hop_pieces_attack',
    sql: "ALTER TABLE pieces ADD COLUMN max_directional_hop_pieces_attack TINYINT DEFAULT NULL",
    description: "Add max_directional_hop_pieces_attack column - when set (1-4), limits the maximum number of pieces this piece may hop over in a single directional attack. Works alongside directional_hop_only_attack."
  },
  // --- Direction Change (Movement) ---
  { table: 'pieces', column: 'directional_movement_change', sql: "ALTER TABLE pieces ADD COLUMN directional_movement_change TINYINT(1) DEFAULT 0", description: "Master toggle: when 1, piece can change direction mid-move (second leg after first directional leg)." },
  { table: 'pieces', column: 'up_left_movement_change', sql: "ALTER TABLE pieces ADD COLUMN up_left_movement_change INT DEFAULT 0", description: "Direction change: up-left second-leg distance for movement." },
  { table: 'pieces', column: 'up_movement_change', sql: "ALTER TABLE pieces ADD COLUMN up_movement_change INT DEFAULT 0", description: "Direction change: up second-leg distance for movement." },
  { table: 'pieces', column: 'up_right_movement_change', sql: "ALTER TABLE pieces ADD COLUMN up_right_movement_change INT DEFAULT 0", description: "Direction change: up-right second-leg distance for movement." },
  { table: 'pieces', column: 'right_movement_change', sql: "ALTER TABLE pieces ADD COLUMN right_movement_change INT DEFAULT 0", description: "Direction change: right second-leg distance for movement." },
  { table: 'pieces', column: 'down_right_movement_change', sql: "ALTER TABLE pieces ADD COLUMN down_right_movement_change INT DEFAULT 0", description: "Direction change: down-right second-leg distance for movement." },
  { table: 'pieces', column: 'down_movement_change', sql: "ALTER TABLE pieces ADD COLUMN down_movement_change INT DEFAULT 0", description: "Direction change: down second-leg distance for movement." },
  { table: 'pieces', column: 'down_left_movement_change', sql: "ALTER TABLE pieces ADD COLUMN down_left_movement_change INT DEFAULT 0", description: "Direction change: down-left second-leg distance for movement." },
  { table: 'pieces', column: 'left_movement_change', sql: "ALTER TABLE pieces ADD COLUMN left_movement_change INT DEFAULT 0", description: "Direction change: left second-leg distance for movement." },
  { table: 'pieces', column: 'up_left_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN up_left_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: up-left second leg (movement)." },
  { table: 'pieces', column: 'up_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN up_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: up second leg (movement)." },
  { table: 'pieces', column: 'up_right_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN up_right_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: up-right second leg (movement)." },
  { table: 'pieces', column: 'right_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN right_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: right second leg (movement)." },
  { table: 'pieces', column: 'down_right_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN down_right_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: down-right second leg (movement)." },
  { table: 'pieces', column: 'down_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN down_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: down second leg (movement)." },
  { table: 'pieces', column: 'down_left_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN down_left_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: down-left second leg (movement)." },
  { table: 'pieces', column: 'left_movement_change_exact', sql: "ALTER TABLE pieces ADD COLUMN left_movement_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: left second leg (movement)." },
  { table: 'pieces', column: 'up_left_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN up_left_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: up-left second leg (movement)." },
  { table: 'pieces', column: 'up_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN up_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: up second leg (movement)." },
  { table: 'pieces', column: 'up_right_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN up_right_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: up-right second leg (movement)." },
  { table: 'pieces', column: 'right_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN right_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: right second leg (movement)." },
  { table: 'pieces', column: 'down_right_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN down_right_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: down-right second leg (movement)." },
  { table: 'pieces', column: 'down_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN down_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: down second leg (movement)." },
  { table: 'pieces', column: 'down_left_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN down_left_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: down-left second leg (movement)." },
  { table: 'pieces', column: 'left_movement_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN left_movement_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: left second leg (movement)." },
  { table: 'pieces', column: 'repeating_movement_change', sql: "ALTER TABLE pieces ADD COLUMN repeating_movement_change TINYINT(1) DEFAULT 0", description: "When 1, exact direction-change second-leg distances repeat infinitely (movement)." },
  { table: 'pieces', column: 'require_empty_via_movement', sql: "ALTER TABLE pieces ADD COLUMN require_empty_via_movement TINYINT(1) DEFAULT 0", description: "When 1, forces the direction-change turn square to be empty even if the piece has hopping abilities (movement)." },
  // --- Direction Change (Capture) ---
  { table: 'pieces', column: 'directional_capture_change', sql: "ALTER TABLE pieces ADD COLUMN directional_capture_change TINYINT(1) DEFAULT 0", description: "Master toggle: direction change for capture moves." },
  { table: 'pieces', column: 'up_left_capture_change', sql: "ALTER TABLE pieces ADD COLUMN up_left_capture_change INT DEFAULT 0", description: "Direction change: up-left second-leg distance for capture." },
  { table: 'pieces', column: 'up_capture_change', sql: "ALTER TABLE pieces ADD COLUMN up_capture_change INT DEFAULT 0", description: "Direction change: up second-leg distance for capture." },
  { table: 'pieces', column: 'up_right_capture_change', sql: "ALTER TABLE pieces ADD COLUMN up_right_capture_change INT DEFAULT 0", description: "Direction change: up-right second-leg distance for capture." },
  { table: 'pieces', column: 'right_capture_change', sql: "ALTER TABLE pieces ADD COLUMN right_capture_change INT DEFAULT 0", description: "Direction change: right second-leg distance for capture." },
  { table: 'pieces', column: 'down_right_capture_change', sql: "ALTER TABLE pieces ADD COLUMN down_right_capture_change INT DEFAULT 0", description: "Direction change: down-right second-leg distance for capture." },
  { table: 'pieces', column: 'down_capture_change', sql: "ALTER TABLE pieces ADD COLUMN down_capture_change INT DEFAULT 0", description: "Direction change: down second-leg distance for capture." },
  { table: 'pieces', column: 'down_left_capture_change', sql: "ALTER TABLE pieces ADD COLUMN down_left_capture_change INT DEFAULT 0", description: "Direction change: down-left second-leg distance for capture." },
  { table: 'pieces', column: 'left_capture_change', sql: "ALTER TABLE pieces ADD COLUMN left_capture_change INT DEFAULT 0", description: "Direction change: left second-leg distance for capture." },
  { table: 'pieces', column: 'up_left_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN up_left_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: up-left second leg (capture)." },
  { table: 'pieces', column: 'up_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN up_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: up second leg (capture)." },
  { table: 'pieces', column: 'up_right_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN up_right_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: up-right second leg (capture)." },
  { table: 'pieces', column: 'right_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN right_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: right second leg (capture)." },
  { table: 'pieces', column: 'down_right_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN down_right_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: down-right second leg (capture)." },
  { table: 'pieces', column: 'down_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN down_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: down second leg (capture)." },
  { table: 'pieces', column: 'down_left_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN down_left_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: down-left second leg (capture)." },
  { table: 'pieces', column: 'left_capture_change_exact', sql: "ALTER TABLE pieces ADD COLUMN left_capture_change_exact TINYINT(1) DEFAULT 0", description: "Direction change exact flag: left second leg (capture)." },
  { table: 'pieces', column: 'up_left_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN up_left_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: up-left second leg (capture)." },
  { table: 'pieces', column: 'up_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN up_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: up second leg (capture)." },
  { table: 'pieces', column: 'up_right_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN up_right_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: up-right second leg (capture)." },
  { table: 'pieces', column: 'right_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN right_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: right second leg (capture)." },
  { table: 'pieces', column: 'down_right_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN down_right_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: down-right second leg (capture)." },
  { table: 'pieces', column: 'down_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN down_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: down second leg (capture)." },
  { table: 'pieces', column: 'down_left_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN down_left_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: down-left second leg (capture)." },
  { table: 'pieces', column: 'left_capture_change_available_for', sql: "ALTER TABLE pieces ADD COLUMN left_capture_change_available_for INT DEFAULT NULL", description: "Direction change first-N-moves-only: left second leg (capture)." },
  { table: 'pieces', column: 'repeating_capture_change', sql: "ALTER TABLE pieces ADD COLUMN repeating_capture_change TINYINT(1) DEFAULT 0", description: "When 1, exact direction-change second-leg distances repeat infinitely (capture)." },
  { table: 'pieces', column: 'require_empty_via_capture', sql: "ALTER TABLE pieces ADD COLUMN require_empty_via_capture TINYINT(1) DEFAULT 0", description: "When 1, forces the direction-change turn square to be empty even if the piece has hopping abilities (capture)." },
  { table: 'pieces', column: 'require_direction_change', sql: "ALTER TABLE pieces ADD COLUMN require_direction_change TINYINT(1) DEFAULT 0", description: "When 1, the piece MUST use direction-change movement; straight-line moves to squares not reachable via DC are forbidden." },
  { table: 'pieces', column: 'require_direction_change_capture', sql: "ALTER TABLE pieces ADD COLUMN require_direction_change_capture TINYINT(1) DEFAULT 0", description: "When 1, the piece MUST use direction-change captures; straight-line captures to squares not reachable via DC are forbidden." },
  // --- Fairy-Stockfish integration ---
  { table: 'game_types', column: 'fairy_stockfish_deep_analysis', sql: "ALTER TABLE game_types ADD COLUMN fairy_stockfish_deep_analysis TINYINT(1) NOT NULL DEFAULT 0", description: "When 1, the Fairy-Stockfish computer player uses the server-side deep analysis queue for this game type instead of the client-side browser engine." },
  // --- Hidden enemy pieces (fog of war) + illegal-move-limit win condition ---
  { table: 'game_types', column: 'hide_enemy_pieces', sql: "ALTER TABLE game_types ADD COLUMN hide_enemy_pieces TINYINT(1) NOT NULL DEFAULT 0", description: "When 1, enemy pieces are hidden from each player during live play (fog of war)." },
  { table: 'game_types', column: 'illegal_move_limit', sql: "ALTER TABLE game_types ADD COLUMN illegal_move_limit INT NOT NULL DEFAULT 0", description: "When > 0, a player who attempts this many illegal moves loses the game (1-100)." },
  { table: 'game_types', column: 'illegal_move_label', sql: "ALTER TABLE game_types ADD COLUMN illegal_move_label VARCHAR(50) DEFAULT NULL", description: "Optional custom label for the illegal-move counter in live games (max 50 chars). NULL means the default 'Illegal moves' label is used." },
  { table: 'games', column: 'illegal_move_counts', sql: "ALTER TABLE games ADD COLUMN illegal_move_counts VARCHAR(255) DEFAULT NULL", description: "JSON map of playerPosition -> illegal-move attempt count for the live game." },
  { table: 'games', column: 'spectator_visibility', sql: "ALTER TABLE games ADD COLUMN spectator_visibility VARCHAR(16) NOT NULL DEFAULT 'all'", description: "Spectator visibility mode for hidden-piece games: 'all' | 'player1' | 'player2'." }
];

// Ensure physical_board_requests table exists (may have been created after tableMigrations ran)
const ensurePhysicalBoardRequestsTable = async () => {
  if (!(await tableExists('physical_board_requests'))) {
    await runMigration(
      `CREATE TABLE IF NOT EXISTS physical_board_requests (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        game_id INT NULL,
        game_name VARCHAR(255) NULL,
        board_grid_width INT NULL,
        board_grid_height INT NULL,
        border_wood VARCHAR(100) NULL,
        light_square_wood VARCHAR(100) NULL,
        dark_square_wood VARCHAR(100) NULL,
        dimension_unit VARCHAR(10) NULL,
        board_length_dim VARCHAR(20) NULL,
        board_width_dim VARCHAR(20) NULL,
        message TEXT NULL,
        status ENUM('pending', 'fulfilled', 'dismissed') DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pbr_status (status),
        INDEX idx_pbr_created (created_at)
      )`,
      "Create physical_board_requests table"
    );
  }
};

/**
 * Run all pending migrations
 */
const runMigrations = async () => {
  console.log('\n[DB] Checking for pending migrations...\n');
  
  let migrationsRun = 0;
  
  // First, check and create tables
  for (const migration of tableMigrations) {
    try {
      const exists = await tableExists(migration.table);
      
      if (!exists) {
        await runMigration(migration.sql, migration.description);
        migrationsRun++;
      }
    } catch (err) {
      console.error(`Error with table migration: ${migration.description}`, err.message);
    }
  }
  
  // Then, check and add columns
  for (const migration of migrations) {
    try {
      const exists = await columnExists(migration.table, migration.column);
      
      if (!exists) {
        await runMigration(migration.sql, migration.description);
        migrationsRun++;
      }
    } catch (err) {
      // Continue with other migrations even if one fails
      console.error(`Error with migration: ${migration.description}`, err.message);
    }
  }
  
  // One-time migrations (modify columns to be nullable)
  try {
    // Check if descript is still NOT NULL
    const sql = `
      SELECT IS_NULLABLE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'game_types' 
      AND COLUMN_NAME = 'descript'
    `;
    const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode']);
    
    if (results[0] && results[0].IS_NULLABLE === 'NO') {
      await runMigration(
        "ALTER TABLE game_types MODIFY COLUMN descript TEXT NULL, MODIFY COLUMN rules TEXT NULL, MODIFY COLUMN pieces_string TEXT NOT NULL",
        "Make description and rules optional, and convert large VARCHAR columns to TEXT"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error checking/modifying nullable columns:', err.message);
  }

  // Fix trainer_user_events.game_type_id — originally created NOT NULL, needs to be nullable
  // so global-pack downloads (not tied to a specific game) can be logged.
  try {
    const [tueRows] = await db_pool.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'trainer_user_events' AND COLUMN_NAME = 'game_type_id'`,
      [process.env.DB_NAME || 'chessusnode']
    );
    if (tueRows[0] && tueRows[0].IS_NULLABLE === 'NO') {
      await runMigration(
        "ALTER TABLE trainer_user_events MODIFY COLUMN game_type_id INT UNSIGNED NULL",
        "Make trainer_user_events.game_type_id nullable for global-pack downloads"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error making trainer_user_events.game_type_id nullable:', err.message);
  }

  // Ensure pieces.image_location is TEXT type
  try {
    const sql = `
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'pieces' 
      AND COLUMN_NAME = 'image_location'
    `;
    const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode']);
    
    // If column exists and is VARCHAR (not TEXT), convert it
    if (results[0] && results[0].DATA_TYPE === 'varchar') {
      await runMigration(
        "ALTER TABLE pieces MODIFY COLUMN image_location TEXT NULL",
        "Convert pieces.image_location from VARCHAR to TEXT for multiple images"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error checking/modifying pieces.image_location:', err.message);
  }

  // Allow fractional points: convert integer point columns to DECIMAL so games can
  // use non-integer scores (e.g. a 6.5 starting-point handicap / komi, half-point
  // capture rewards). Runs once — only fires while the columns are still integers.
  try {
    const fractionalPointCols = [
      { table: 'game_types', column: 'points_to_win', type: 'DECIMAL(8,1) NULL' },
      { table: 'game_types', column: 'starting_points_p1', type: 'DECIMAL(8,1) NOT NULL DEFAULT 0' },
      { table: 'game_types', column: 'starting_points_p2', type: 'DECIMAL(8,1) NOT NULL DEFAULT 0' },
      { table: 'game_type_pieces', column: 'capture_points_gain', type: 'DECIMAL(8,1) NOT NULL DEFAULT 0' },
      { table: 'game_type_pieces', column: 'capture_points_loss', type: 'DECIMAL(8,1) NOT NULL DEFAULT 0' },
    ];
    for (const col of fractionalPointCols) {
      const info = await getColumnType(col.table, col.column);
      if (info && String(info.DATA_TYPE).toLowerCase() === 'int') {
        await runMigration(
          `ALTER TABLE ${col.table} MODIFY COLUMN ${col.column} ${col.type}`,
          `Convert ${col.table}.${col.column} to DECIMAL for fractional points`
        );
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error converting point columns to DECIMAL:', err.message);
  }

  // ============================================
  // LEGACY MIGRATIONS FOR OLD TABLE STRUCTURE (HISTORICAL ONLY)
  // The following migrations modify piece_movement and piece_capture tables.
  // These tables are no longer used - data has been consolidated into the pieces table.
  // These migrations are kept for historical reference and won't run if tables don't exist.
  // See consolidation migration below (lines 1105-1356).
  // ============================================

  // Ensure piece_movement.piece_id has UNIQUE constraint for upserts
  try {
    const sql = `
      SELECT COUNT(*) as count
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'piece_movement'
      AND INDEX_NAME = 'piece_id'
      AND NON_UNIQUE = 0
    `;
    const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode']);
    
    if (results[0].count === 0) {
      await runMigration(
        "ALTER TABLE piece_movement ADD UNIQUE KEY piece_id (piece_id)",
        "Add UNIQUE constraint to piece_movement.piece_id for upserts"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding UNIQUE constraint to piece_movement.piece_id:', err.message);
  }

  // Ensure piece_capture.piece_id has UNIQUE constraint for upserts
  try {
    const sql = `
      SELECT COUNT(*) as count
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'piece_capture'
      AND INDEX_NAME = 'piece_id'
      AND NON_UNIQUE = 0
    `;
    const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode']);
    
    if (results[0].count === 0) {
      await runMigration(
        "ALTER TABLE piece_capture ADD UNIQUE KEY piece_id (piece_id)",
        "Add UNIQUE constraint to piece_capture.piece_id for upserts"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding UNIQUE constraint to piece_capture.piece_id:', err.message);
  }

  // Add status column to games table for live multiplayer
  try {
    if (!(await columnExists('games', 'status'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN status ENUM('waiting', 'ready', 'active', 'completed', 'cancelled') DEFAULT 'waiting'",
        "Add status column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding status column to games:', err.message);
  }

  // Add host_id column to games table
  try {
    if (!(await columnExists('games', 'host_id'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN host_id INT UNSIGNED, ADD FOREIGN KEY (host_id) REFERENCES users(id)",
        "Add host_id column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding host_id column to games:', err.message);
  }

  // Add winner_id column to games table
  try {
    if (!(await columnExists('games', 'winner_id'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN winner_id INT UNSIGNED, ADD FOREIGN KEY (winner_id) REFERENCES users(id)",
        "Add winner_id column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding winner_id column to games:', err.message);
  }

  // Increase size of other_data column in games table for move history
  try {
    const [columns] = await db_pool.query(
      `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'games' AND COLUMN_NAME = 'other_data'`,
      [process.env.DB_NAME || 'chessusnode']
    );
    
    if (columns.length > 0 && columns[0].DATA_TYPE !== 'mediumtext') {
      await runMigration(
        "ALTER TABLE games MODIFY COLUMN other_data MEDIUMTEXT",
        "Increase games.other_data to MEDIUMTEXT for move history"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error modifying games.other_data:', err.message);
  }

  // Increase size of pieces column in games table
  try {
    const [columns] = await db_pool.query(
      `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'games' AND COLUMN_NAME = 'pieces'`,
      [process.env.DB_NAME || 'chessusnode']
    );
    
    if (columns.length > 0 && columns[0].DATA_TYPE !== 'mediumtext') {
      await runMigration(
        "ALTER TABLE games MODIFY COLUMN pieces MEDIUMTEXT",
        "Increase games.pieces to MEDIUMTEXT"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error modifying games.pieces:', err.message);
  }

  // Increase size of special-square JSON columns on game_types — these can grow
  // large on big boards (every cell may be a custom square with nested config).
  // VARCHAR(1000) overflows easily; bump to MEDIUMTEXT (16MB).
  for (const col of ['special_squares_string', 'range_squares_string', 'promotion_squares_string', 'control_squares_string']) {
    try {
      const [columns] = await db_pool.query(
        `SELECT DATA_TYPE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'game_types' AND COLUMN_NAME = ?`,
        [process.env.DB_NAME || 'chessusnode', col]
      );
      if (columns.length > 0 && columns[0].DATA_TYPE !== 'mediumtext') {
        await runMigration(
          `ALTER TABLE game_types MODIFY COLUMN ${col} MEDIUMTEXT`,
          `Increase game_types.${col} to MEDIUMTEXT for large boards`
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error(`Error modifying game_types.${col}:`, err.message);
    }
  }

  // Add allow_spectators column to games table
  try {
    if (!(await columnExists('games', 'allow_spectators'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN allow_spectators TINYINT(1) DEFAULT 1",
        "Add allow_spectators column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding allow_spectators column to games:', err.message);
  }

  // Add show_piece_helpers column to games table
  try {
    if (!(await columnExists('games', 'show_piece_helpers'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN show_piece_helpers TINYINT(1) DEFAULT 0",
        "Add show_piece_helpers column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding show_piece_helpers column to games:', err.message);
  }

  // Add is_news column to articles table
  try {
    if (!(await columnExists('articles', 'is_news'))) {
      await runMigration(
        "ALTER TABLE articles ADD COLUMN is_news TINYINT(1) DEFAULT 0 AFTER public",
        "Add is_news column to articles table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_news column to articles:', err.message);
  }



  // Add first_move_only columns to piece_movement and piece_capture tables
  try {
    const [movementCols] = await db_pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'piece_movement' 
        AND COLUMN_NAME = 'first_move_only'
    `);
    
    if (movementCols.length === 0) {
      await db_pool.query(
        `ALTER TABLE piece_movement ADD COLUMN first_move_only TINYINT(1) DEFAULT 0 AFTER repeating_movement`
      );
      console.log('✓ Added first_move_only column to piece_movement table');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding first_move_only to piece_movement:', err.message);
  }

  try {
    const [captureCols] = await db_pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'piece_capture' 
        AND COLUMN_NAME = 'first_move_only_capture'
    `);
    
    if (captureCols.length === 0) {
      await db_pool.query(
        `ALTER TABLE piece_capture ADD COLUMN first_move_only_capture TINYINT(1) DEFAULT 0 AFTER can_attack_on_iteration`
      );
      console.log('✓ Added first_move_only_capture column to piece_capture table');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding first_move_only_capture to piece_capture:', err.message);
  }

  // Add exact movement columns
  const exactMovementColumns = [
    'up_left_movement_exact',
    'up_movement_exact',
    'up_right_movement_exact',
    'right_movement_exact',
    'down_right_movement_exact',
    'down_movement_exact',
    'down_left_movement_exact',
    'left_movement_exact'
  ];

  for (const colName of exactMovementColumns) {
    try {
      const [cols] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'piece_movement' 
          AND COLUMN_NAME = ?
      `, [colName]);
      
      if (cols.length === 0) {
        await db_pool.query(
          `ALTER TABLE piece_movement ADD COLUMN ${colName} TINYINT(1) DEFAULT 0`
        );
        console.log(`✓ Added ${colName} column to piece_movement table`);
        migrationsRun++;
      }
    } catch (err) {
      console.error(`Error adding ${colName} to piece_movement:`, err.message);
    }
  }

  // Add available_for_moves columns
  const availableForColumns = [
    'up_left_movement_available_for',
    'up_movement_available_for',
    'up_right_movement_available_for',
    'right_movement_available_for',
    'down_right_movement_available_for',
    'down_movement_available_for',
    'down_left_movement_available_for',
    'left_movement_available_for'
  ];

  for (const colName of availableForColumns) {
    try {
      const [cols] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'piece_movement' 
          AND COLUMN_NAME = ?
      `, [colName]);
      
      if (cols.length === 0) {
        await db_pool.query(
          `ALTER TABLE piece_movement ADD COLUMN ${colName} INT UNSIGNED NULL`
        );
        console.log(`✓ Added ${colName} column to piece_movement table`);
        migrationsRun++;
      }
    } catch (err) {
      console.error(`Error adding ${colName} to piece_movement:`, err.message);
    }
  }

  // Add exact capture columns
  const exactCaptureColumns = [
    'up_left_capture_exact',
    'up_capture_exact',
    'up_right_capture_exact',
    'right_capture_exact',
    'down_right_capture_exact',
    'down_capture_exact',
    'down_left_capture_exact',
    'left_capture_exact'
  ];

  for (const colName of exactCaptureColumns) {
    try {
      const [cols] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'piece_capture' 
          AND COLUMN_NAME = ?
      `, [colName]);
      
      if (cols.length === 0) {
        await db_pool.query(
          `ALTER TABLE piece_capture ADD COLUMN ${colName} TINYINT(1) DEFAULT 0`
        );
        console.log(`✓ Added ${colName} column to piece_capture table`);
        migrationsRun++;
      }
    } catch (err) {
      console.error(`Error adding ${colName} to piece_capture:`, err.message);
    }
  }

  // Add available_for_capture columns
  const availableForCaptureColumns = [
    'up_left_capture_available_for',
    'up_capture_available_for',
    'up_right_capture_available_for',
    'right_capture_available_for',
    'down_right_capture_available_for',
    'down_capture_available_for',
    'down_left_capture_available_for',
    'left_capture_available_for'
  ];

  for (const colName of availableForCaptureColumns) {
    try {
      const [cols] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'piece_capture' 
          AND COLUMN_NAME = ?
      `, [colName]);
      
      if (cols.length === 0) {
        await db_pool.query(
          `ALTER TABLE piece_capture ADD COLUMN ${colName} INT UNSIGNED NULL`
        );
        console.log(`✓ Added ${colName} column to piece_capture table`);
        migrationsRun++;
      }
    } catch (err) {
      console.error(`Error adding ${colName} to piece_capture:`, err.message);
    }
  }

  // Add can_castle column to pieces table
  try {
    const [cols] = await db_pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'pieces' 
        AND COLUMN_NAME = 'can_castle'
    `);
    
    if (cols.length === 0) {
      await db_pool.query(
        `ALTER TABLE pieces ADD COLUMN can_castle TINYINT(1) DEFAULT 0`
      );
      console.log('✓ Added can_castle column to pieces table');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding can_castle to pieces:', err.message);
  }

  // Add available_for_moves column to piece_movement table
  try {
    if (!(await columnExists('piece_movement', 'available_for_moves'))) {
      await runMigration(
        "ALTER TABLE piece_movement ADD COLUMN available_for_moves TINYINT(1) DEFAULT 1 COMMENT 'Whether movement is available for regular moves (vs captures only)'",
        "Add available_for_moves column to piece_movement table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding available_for_moves to piece_movement:', err.message);
  }

  // Add can_promote column to pieces table
  try {
    if (!(await columnExists('pieces', 'can_promote'))) {
      await runMigration(
        "ALTER TABLE pieces ADD COLUMN can_promote TINYINT(1) DEFAULT 0 COMMENT 'Whether piece can promote to other pieces'",
        "Add can_promote column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding can_promote to pieces:', err.message);
  }

  // Add promotion_options column to pieces table
  try {
    if (!(await columnExists('pieces', 'promotion_options'))) {
      await runMigration(
        "ALTER TABLE pieces ADD COLUMN promotion_options TEXT NULL COMMENT 'JSON array of piece IDs that this piece can promote to'",
        "Add promotion_options column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding promotion_options to pieces:', err.message);
  }

  // Add draw_move_limit column to game_types table
  try {
    if (!(await columnExists('game_types', 'draw_move_limit'))) {
      await runMigration(
        "ALTER TABLE game_types ADD COLUMN draw_move_limit INT NULL DEFAULT NULL COMMENT 'Number of moves without captures before game is drawn (NULL = disabled)'",
        "Add draw_move_limit column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding draw_move_limit column to game_types:', err.message);
  }

  // Add repetition_draw_count column to game_types table (N-fold repetition rule)
  try {
    if (!(await columnExists('game_types', 'repetition_draw_count'))) {
      await runMigration(
        "ALTER TABLE game_types ADD COLUMN repetition_draw_count INT NULL DEFAULT NULL COMMENT 'Number of times same position must repeat for draw (NULL = disabled, min 2, max 9)'",
        "Add repetition_draw_count column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding repetition_draw_count column to game_types:', err.message);
  }

  // Add is_career column to articles table
  try {
    if (!(await columnExists('articles', 'is_career'))) {
      await runMigration(
        "ALTER TABLE articles ADD COLUMN is_career TINYINT(1) DEFAULT 0 COMMENT 'Flag to indicate if article is a job posting' AFTER is_news",
        "Add is_career column to articles table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_career column to articles:', err.message);
  }



  // Add ban system columns to users table
  try {
    if (!(await columnExists('users', 'banned'))) {
      await runMigration(
        `ALTER TABLE users
         ADD COLUMN banned TINYINT(1) DEFAULT 0 COMMENT 'Whether user is banned',
         ADD COLUMN ban_reason TEXT DEFAULT NULL COMMENT 'Reason for ban',
         ADD COLUMN banned_at DATETIME DEFAULT NULL COMMENT 'When user was banned',
         ADD COLUMN banned_by INT DEFAULT NULL COMMENT 'User ID of admin/owner who banned',
         ADD COLUMN ban_expires_at DATETIME DEFAULT NULL COMMENT 'When ban expires (NULL for permanent)',
         ADD INDEX idx_banned (banned),
         ADD INDEX idx_ban_expires (ban_expires_at)`,
        "Add ban system columns to users table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding ban system columns:', err.message);
  }

  // Add owner role and set Nisticism as owner
  try {
    const [roleCheck] = await db_pool.query(
      "SHOW COLUMNS FROM users WHERE Field = 'role'"
    );
    
    if (roleCheck.length > 0 && !roleCheck[0].Type.includes('owner')) {
      await runMigration(
        `ALTER TABLE users MODIFY COLUMN role ENUM('user', 'admin', 'owner') DEFAULT 'user'`,
        "Add owner role to users table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding owner role:', err.message);
  }

  // Always ensure Nisticism is set as owner (separate from role ENUM migration)
  try {
    const [nisticismUser] = await db_pool.query(
      "SELECT id, username, role FROM users WHERE username = 'Nisticism'"
    );
    
    if (nisticismUser.length > 0 && nisticismUser[0].role !== 'owner') {
      await db_pool.query("UPDATE users SET role = 'owner' WHERE username = 'Nisticism'");
      console.log(`✓ Set Nisticism (ID: ${nisticismUser[0].id}) as owner`);
      migrationsRun++;
    }
    // Silent if already owner - no need to log every startup
  } catch (err) {
    console.error('Error setting Nisticism as owner:', err.message);
  }

  // Expand randomized_starting_positions column from VARCHAR(1000) to TEXT
  try {
    const gameTypesColType = await getColumnType('game_types', 'randomized_starting_positions');
    if (gameTypesColType && gameTypesColType.DATA_TYPE === 'varchar' && gameTypesColType.CHARACTER_MAXIMUM_LENGTH <= 1000) {
      await runMigration(
        `ALTER TABLE game_types MODIFY COLUMN randomized_starting_positions TEXT`,
        "Expand game_types.randomized_starting_positions to TEXT"
      );
      migrationsRun++;
    }
    
    const gamesColType = await getColumnType('games', 'randomized_starting_positions');
    if (gamesColType && gamesColType.DATA_TYPE === 'varchar' && gamesColType.CHARACTER_MAXIMUM_LENGTH <= 1000) {
      await runMigration(
        `ALTER TABLE games MODIFY COLUMN randomized_starting_positions TEXT`,
        "Expand games.randomized_starting_positions to TEXT"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error expanding randomized_starting_positions column:', err.message);
  }

  // Create friends table for user friendships
  try {
    const friendsTableExists = await tableExists('friends');
    if (!friendsTableExists) {
      await runMigration(
        `CREATE TABLE friends (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id INT UNSIGNED NOT NULL,
          friend_id INT UNSIGNED NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_friendship (user_id, friend_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_user_id (user_id),
          INDEX idx_friend_id (friend_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        "Create friends table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating friends table:', err.message);
  }

  // Migrate pieces_string data to game_type_pieces junction table
  try {
    // Check if junction table exists and has data
    const junctionTableExists = await tableExists('game_type_pieces');
    if (junctionTableExists) {
      const [junctionCount] = await db_pool.query('SELECT COUNT(*) as count FROM game_type_pieces');
      
      // Only migrate if junction table is empty
      if (junctionCount[0].count === 0) {
        console.log('Migrating pieces_string data to junction table...');
        
        const [gameTypes] = await db_pool.query(
          'SELECT id, pieces_string FROM game_types WHERE pieces_string IS NOT NULL AND pieces_string != ""'
        );
        
        let totalPiecesInserted = 0;
        
        for (const gameType of gameTypes) {
          try {
            const piecesData = JSON.parse(gameType.pieces_string);
            let piecesToInsert = [];
            
            // Handle both array and object formats
            if (Array.isArray(piecesData)) {
              piecesToInsert = piecesData;
            } else if (typeof piecesData === 'object') {
              // Convert object format {"row,col": {...}} to array
              piecesToInsert = Object.entries(piecesData).map(([key, piece]) => {
                const [row, col] = key.split(',').map(Number);
                return {
                  ...piece,
                  x: col || piece.x || 0,
                  y: row || piece.y || 0
                };
              });
            }
            
            // Insert each piece
            for (const piece of piecesToInsert) {
              if (piece.piece_id) {
                await db_pool.query(
                  `INSERT INTO game_type_pieces (game_type_id, piece_id, x, y, player_number)
                   VALUES (?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE piece_id = piece_id`,
                  [
                    gameType.id,
                    piece.piece_id,
                    piece.x || 0,
                    piece.y || 0,
                    piece.player_number || piece.player || 1
                  ]
                );
                totalPiecesInserted++;
              }
            }
          } catch (parseError) {
            console.error(`Error migrating pieces for game_type ${gameType.id}:`, parseError.message);
          }
        }
        
        if (totalPiecesInserted > 0) {
          console.log(`✓ Migrated ${totalPiecesInserted} pieces from ${gameTypes.length} game types`);
          migrationsRun++;
        }
      }
    }
  } catch (err) {
    console.error('Error migrating pieces_string to junction table:', err.message);
  }

  // Populate special_scenario_moves for pawns (skip - pawns already have this data)
  // The existing pawn data uses availableForMoves field which is already correct
  try {
    // Check if any pawns are missing special_scenario_moves
    const [pawnsWithoutSpecialMoves] = await db_pool.query(
      `SELECT COUNT(*) as count FROM pieces 
       WHERE piece_name = 'Pawn'
       AND (special_scenario_moves IS NULL OR special_scenario_moves = '')`
    );
    
    // Only populate if some pawns are missing the data (don't overwrite existing data)
    if (pawnsWithoutSpecialMoves[0].count > 0) {
      const [result] = await db_pool.query(
        `UPDATE pieces 
         SET special_scenario_moves = '{"additionalMovements":{"up":[{"value":2,"exact":false,"infinite":false,"firstMoveOnly":false,"availableForMoves":1}],"down":[{"value":2,"exact":false,"infinite":false,"firstMoveOnly":false,"availableForMoves":1}]}}'
         WHERE piece_name = 'Pawn'
         AND (special_scenario_moves IS NULL OR special_scenario_moves = '')`
      );
      
      if (result.affectedRows > 0) {
        console.log(`✓ Populated special_scenario_moves for ${result.affectedRows} pawns`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error populating pawn special moves:', err.message);
  }

  // Add missing piece columns that were never in the migration system
  try {
    const missingPieceColumns = [
      ['piece_category', 'VARCHAR(50) DEFAULT NULL'],
      ['has_checkmate_rule', 'TINYINT(1) DEFAULT 0'],
      ['has_check_rule', 'TINYINT(1) DEFAULT 0'],
      ['has_lose_on_capture_rule', 'TINYINT(1) DEFAULT 0'],
      ['available_for_captures', 'INT UNSIGNED NULL']
    ];

    for (const [colName, colDef] of missingPieceColumns) {
      const exists = await columnExists('pieces', colName);
      if (!exists) {
        await db_pool.query(`ALTER TABLE pieces ADD COLUMN ${colName} ${colDef}`);
        console.log(`✓ Added ${colName} column to pieces table`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('❌ Error adding missing piece columns:', err.message);
  }

  // Add attack range exact columns to pieces table (these were missing from initial consolidation)
  try {
    const attackRangeExactColumns = [
      'up_left_attack_range_exact',
      'up_attack_range_exact',
      'up_right_attack_range_exact',
      'right_attack_range_exact',
      'down_right_attack_range_exact',
      'down_attack_range_exact',
      'down_left_attack_range_exact',
      'left_attack_range_exact'
    ];

    for (const colName of attackRangeExactColumns) {
      const exists = await columnExists('pieces', colName);
      if (!exists) {
        await db_pool.query(`ALTER TABLE pieces ADD COLUMN ${colName} TINYINT(1) DEFAULT 0`);
        console.log(`✓ Added ${colName} column to pieces table`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('❌ Error adding attack_range exact columns:', err.message);
  }

  // Add attack range available_for columns to pieces table
  try {
    const attackRangeAvailableForColumns = [
      'up_left_attack_range_available_for',
      'up_attack_range_available_for',
      'up_right_attack_range_available_for',
      'right_attack_range_available_for',
      'down_right_attack_range_available_for',
      'down_attack_range_available_for',
      'down_left_attack_range_available_for',
      'left_attack_range_available_for'
    ];

    for (const colName of attackRangeAvailableForColumns) {
      const exists = await columnExists('pieces', colName);
      if (!exists) {
        await db_pool.query(`ALTER TABLE pieces ADD COLUMN ${colName} INT UNSIGNED NULL`);
        console.log(`✓ Added ${colName} column to pieces table`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('❌ Error adding attack_range available_for columns:', err.message);
  }

  // Consolidate piece_movement and piece_capture tables into pieces table
  try {
    // Check if pieces table already has movement columns (check for one of the _exact columns to ensure full migration)
    const movementColumnExists = await columnExists('pieces', 'directional_movement_style');
    const captureColumnExists = await columnExists('pieces', 'can_capture_enemy_via_range');
    
    if (!movementColumnExists || !captureColumnExists) {
      console.log('Consolidating piece_movement and piece_capture tables into pieces...');
      
      // Add all movement columns to pieces table
      const movementColumns = [
        ['directional_movement_style', 'TINYINT(1) DEFAULT NULL'],
        ['repeating_movement', 'TINYINT(1) DEFAULT NULL'],
        ['max_directional_movement_iterations', 'INT DEFAULT NULL'],
        ['min_directional_movement_iterations', 'INT DEFAULT NULL'],
        ['up_left_movement', 'INT DEFAULT 0'],
        ['up_movement', 'INT DEFAULT 0'],
        ['up_right_movement', 'INT DEFAULT 0'],
        ['right_movement', 'INT DEFAULT 0'],
        ['down_right_movement', 'INT DEFAULT 0'],
        ['down_movement', 'INT DEFAULT 0'],
        ['down_left_movement', 'INT DEFAULT 0'],
        ['left_movement', 'INT DEFAULT 0'],
        ['ratio_movement_style', 'TINYINT(1) DEFAULT NULL'],
        ['ratio_one_movement', 'INT DEFAULT NULL'],
        ['ratio_two_movement', 'INT DEFAULT NULL'],
        ['repeating_ratio', 'TINYINT(1) DEFAULT NULL'],
        ['max_ratio_iterations', 'INT DEFAULT NULL'],
        ['min_ratio_iterations', 'INT DEFAULT NULL'],
        ['step_by_step_movement_style', 'TINYINT(1) DEFAULT NULL'],
        ['step_by_step_movement_value', 'INT DEFAULT NULL'],
        ['can_hop_over_allies', 'TINYINT(1) DEFAULT NULL'],
        ['can_hop_over_enemies', 'TINYINT(1) DEFAULT NULL'],
        ['min_turns_per_move', 'INT DEFAULT NULL'],
        ['max_turns_per_move', 'INT DEFAULT NULL'],
        ['first_move_only', 'TINYINT(1) DEFAULT 0'],
        ['available_for_moves', 'INT UNSIGNED NULL'],
        ['special_scenario_moves', 'VARCHAR(1000) DEFAULT NULL'],
        ['up_left_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['up_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['up_right_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['right_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['down_right_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['down_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['down_left_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['left_movement_exact', 'TINYINT(1) DEFAULT 0'],
        ['up_left_movement_available_for', 'INT UNSIGNED NULL'],
        ['up_movement_available_for', 'INT UNSIGNED NULL'],
        ['up_right_movement_available_for', 'INT UNSIGNED NULL'],
        ['right_movement_available_for', 'INT UNSIGNED NULL'],
        ['down_right_movement_available_for', 'INT UNSIGNED NULL'],
        ['down_movement_available_for', 'INT UNSIGNED NULL'],
        ['down_left_movement_available_for', 'INT UNSIGNED NULL'],
        ['left_movement_available_for', 'INT UNSIGNED NULL']
      ];
      
      for (const [colName, colDef] of movementColumns) {
        if (!(await columnExists('pieces', colName))) {
          await db_pool.query(`ALTER TABLE pieces ADD COLUMN ${colName} ${colDef}`);
        }
      }
      
      // Add all capture columns to pieces table
      const captureColumns = [
        ['can_capture_enemy_via_range', 'TINYINT(1) DEFAULT NULL'],
        ['can_capture_ally_via_range', 'TINYINT(1) DEFAULT NULL'],
        ['can_capture_enemy_on_move', 'TINYINT(1) DEFAULT NULL'],
        ['can_capture_ally_on_range', 'TINYINT(1) DEFAULT NULL'],
        ['can_attack_on_iteration', 'TINYINT(1) DEFAULT NULL'],
        ['first_move_only_capture', 'TINYINT(1) DEFAULT 0'],
        ['available_for_captures', 'INT UNSIGNED NULL'],
        ['up_left_capture', 'INT DEFAULT 0'],
        ['up_capture', 'INT DEFAULT 0'],
        ['up_right_capture', 'INT DEFAULT 0'],
        ['right_capture', 'INT DEFAULT 0'],
        ['down_right_capture', 'INT DEFAULT 0'],
        ['down_capture', 'INT DEFAULT 0'],
        ['down_left_capture', 'INT DEFAULT 0'],
        ['left_capture', 'INT DEFAULT 0'],
        ['ratio_one_capture', 'INT DEFAULT NULL'],
        ['ratio_two_capture', 'INT DEFAULT NULL'],
        ['step_by_step_capture', 'INT DEFAULT NULL'],
        ['up_left_attack_range', 'INT DEFAULT NULL'],
        ['up_attack_range', 'INT DEFAULT NULL'],
        ['up_right_attack_range', 'INT DEFAULT NULL'],
        ['right_attack_range', 'INT DEFAULT NULL'],
        ['down_right_attack_range', 'INT DEFAULT NULL'],
        ['down_attack_range', 'INT DEFAULT NULL'],
        ['down_left_attack_range', 'INT DEFAULT NULL'],
        ['left_attack_range', 'INT DEFAULT NULL'],
        ['repeating_directional_ranged_attack', 'TINYINT(1) DEFAULT NULL'],
        ['max_directional_ranged_attack_iterations', 'INT DEFAULT NULL'],
        ['min_directional_ranged_attack_iterations', 'INT DEFAULT NULL'],
        ['ratio_one_attack_range', 'INT DEFAULT NULL'],
        ['ratio_two_attack_range', 'INT DEFAULT NULL'],
        ['repeating_ratio_ranged_attack', 'TINYINT(1) DEFAULT NULL'],
        ['max_ratio_ranged_attack_iterations', 'INT DEFAULT NULL'],
        ['min_ratio_ranged_attack_iterations', 'INT DEFAULT NULL'],
        ['step_by_step_attack_style', 'TINYINT(1) DEFAULT NULL'],
        ['step_by_step_attack_value', 'TINYINT(1) DEFAULT NULL'],
        ['capture_actions_per_turn', 'INT DEFAULT NULL'],
        ['ranged_capture_actions_per_turn', 'INT DEFAULT NULL'],
        ['special_scenario_captures', 'TEXT DEFAULT NULL'],
        ['up_left_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['up_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['up_right_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['right_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['down_right_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['down_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['down_left_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['left_capture_exact', 'TINYINT(1) DEFAULT 0'],
        ['up_left_capture_available_for', 'INT UNSIGNED NULL'],
        ['up_capture_available_for', 'INT UNSIGNED NULL'],
        ['up_right_capture_available_for', 'INT UNSIGNED NULL'],
        ['right_capture_available_for', 'INT UNSIGNED NULL'],
        ['down_right_capture_available_for', 'INT UNSIGNED NULL'],
        ['down_capture_available_for', 'INT UNSIGNED NULL'],
        ['down_left_capture_available_for', 'INT UNSIGNED NULL'],
        ['left_capture_available_for', 'INT UNSIGNED NULL'],
        ['can_fire_over_allies', 'TINYINT(1) DEFAULT 0'],
        ['can_fire_over_enemies', 'TINYINT(1) DEFAULT 0'],
        ['can_en_passant', 'TINYINT(1) DEFAULT 0']
      ];
      
      for (const [colName, colDef] of captureColumns) {
        if (!(await columnExists('pieces', colName))) {
          await db_pool.query(`ALTER TABLE pieces ADD COLUMN ${colName} ${colDef}`);
        }
      }
      
      // Check if legacy tables exist before trying to copy data
      const pieceMovementExists = await tableExists('piece_movement');
      const pieceCaptureExists = await tableExists('piece_capture');
      
      // Copy data from piece_movement to pieces (dynamically check which columns exist)
      if (pieceMovementExists) {
        // Get columns that actually exist in piece_movement table
        const [pmColumns] = await db_pool.query(`
          SELECT COLUMN_NAME 
          FROM information_schema.COLUMNS 
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'piece_movement'
        `, [process.env.DB_NAME || 'chessusnode']);
        const pmColumnNames = pmColumns.map(c => c.COLUMN_NAME);
        
        // Build dynamic SET clause based on columns that exist in source table
        const movementMappings = [
          'directional_movement_style',
          'repeating_movement',
          'max_directional_movement_iterations',
          'min_directional_movement_iterations',
          'up_left_movement',
          'up_movement',
          'up_right_movement',
          'right_movement',
          'down_right_movement',
          'down_movement',
          'down_left_movement',
          'left_movement',
          'ratio_movement_style',
          'ratio_one_movement',
          'ratio_two_movement',
          'repeating_ratio',
          'max_ratio_iterations',
          'min_ratio_iterations',
          'step_by_step_movement_style',
          'step_by_step_movement_value',
          'can_hop_over_allies',
          'can_hop_over_enemies',
          'min_turns_per_move',
          'max_turns_per_move',
          'special_scenario_moves'
        ];
        
        // Optional columns that may not exist in legacy table
        const optionalMovementMappings = [
          'first_move_only',
          'available_for_moves',
          'up_left_movement_exact',
          'up_movement_exact',
          'up_right_movement_exact',
          'right_movement_exact',
          'down_right_movement_exact',
          'down_movement_exact',
          'down_left_movement_exact',
          'left_movement_exact',
          'up_left_movement_available_for',
          'up_movement_available_for',
          'up_right_movement_available_for',
          'right_movement_available_for',
          'down_right_movement_available_for',
          'down_movement_available_for',
          'down_left_movement_available_for',
          'left_movement_available_for'
        ];
        
        // Build SET clause
        const setClauses = [];
        for (const col of movementMappings) {
          if (pmColumnNames.includes(col)) {
            setClauses.push(`p.${col} = pm.${col}`);
          }
        }
        for (const col of optionalMovementMappings) {
          if (pmColumnNames.includes(col)) {
            setClauses.push(`p.${col} = COALESCE(pm.${col}, p.${col})`);
          }
        }
        
        if (setClauses.length > 0) {
          const updateSql = `
            UPDATE pieces p
            INNER JOIN piece_movement pm ON p.id = pm.piece_id
            SET ${setClauses.join(',\n                ')}
          `;
          await db_pool.query(updateSql);
          console.log(`  ✓ Copied ${setClauses.length} columns from piece_movement`);
        }
      } else {
        console.log('  ℹ piece_movement table not found, skipping data copy');
      }
      
      // Copy data from piece_capture to pieces (dynamically check which columns exist)
      if (pieceCaptureExists) {
        // Get columns that actually exist in piece_capture table
        const [pcColumns] = await db_pool.query(`
          SELECT COLUMN_NAME 
          FROM information_schema.COLUMNS 
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'piece_capture'
        `, [process.env.DB_NAME || 'chessusnode']);
        const pcColumnNames = pcColumns.map(c => c.COLUMN_NAME);
        
        // Build dynamic SET clause based on columns that exist in source table
        const captureMappings = [
          'can_capture_enemy_via_range',
          'can_capture_ally_via_range',
          'can_capture_enemy_on_move',
          'can_capture_ally_on_range',
          'can_attack_on_iteration',
          'up_left_capture',
          'up_capture',
          'up_right_capture',
          'right_capture',
          'down_right_capture',
          'down_capture',
          'down_left_capture',
          'left_capture',
          'ratio_one_capture',
          'ratio_two_capture',
          'step_by_step_capture',
          'up_left_attack_range',
          'up_attack_range',
          'up_right_attack_range',
          'right_attack_range',
          'down_right_attack_range',
          'down_attack_range',
          'down_left_attack_range',
          'left_attack_range',
          'repeating_directional_ranged_attack',
          'max_directional_ranged_attack_iterations',
          'min_directional_ranged_attack_iterations',
          'ratio_one_attack_range',
          'ratio_two_attack_range',
          'repeating_ratio_ranged_attack',
          'max_ratio_ranged_attack_iterations',
          'min_ratio_ranged_attack_iterations',
          'step_by_step_attack_style',
          'step_by_step_attack_value',
          'max_piece_captures_per_move',
          'max_piece_captures_per_ranged_attack',
          'special_scenario_captures'
        ];
        
        // Optional columns that may not exist in legacy table
        const optionalCaptureMappings = [
          'first_move_only_capture',
          'up_left_capture_exact',
          'up_capture_exact',
          'up_right_capture_exact',
          'right_capture_exact',
          'down_right_capture_exact',
          'down_capture_exact',
          'down_left_capture_exact',
          'left_capture_exact',
          'up_left_capture_available_for',
          'up_capture_available_for',
          'up_right_capture_available_for',
          'right_capture_available_for',
          'down_right_capture_available_for',
          'down_capture_available_for',
          'down_left_capture_available_for',
          'left_capture_available_for'
        ];
        
        // Build SET clause
        const setClauses = [];
        for (const col of captureMappings) {
          if (pcColumnNames.includes(col)) {
            setClauses.push(`p.${col} = pc.${col}`);
          }
        }
        for (const col of optionalCaptureMappings) {
          if (pcColumnNames.includes(col)) {
            setClauses.push(`p.${col} = COALESCE(pc.${col}, p.${col})`);
          }
        }
        
        if (setClauses.length > 0) {
          const updateSql = `
            UPDATE pieces p
            INNER JOIN piece_capture pc ON p.id = pc.piece_id
            SET ${setClauses.join(',\n                ')}
          `;
          await db_pool.query(updateSql);
          console.log(`  ✓ Copied ${setClauses.length} columns from piece_capture`);
        }
      } else {
        console.log('  ℹ piece_capture table not found, skipping data copy');
      }
      
      console.log('✓ Consolidated piece tables into single pieces table');
      migrationsRun++;
    }
  } catch (err) {
    console.error('❌ Error consolidating piece tables:', err.message);
  }

  // Convert special_scenario_moves and special_scenario_captures to TEXT type for larger JSON storage
  try {
    const specialMovesColType = await getColumnType('pieces', 'special_scenario_moves');
    if (specialMovesColType && specialMovesColType.DATA_TYPE === 'varchar') {
      await runMigration(
        `ALTER TABLE pieces MODIFY COLUMN special_scenario_moves TEXT DEFAULT NULL`,
        "Convert pieces.special_scenario_moves from VARCHAR to TEXT"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error converting special_scenario_moves to TEXT:', err.message);
  }

  try {
    const specialCapturesColType = await getColumnType('pieces', 'special_scenario_captures');
    if (specialCapturesColType && specialCapturesColType.DATA_TYPE === 'varchar') {
      await runMigration(
        `ALTER TABLE pieces MODIFY COLUMN special_scenario_captures TEXT DEFAULT NULL`,
        "Convert pieces.special_scenario_captures from VARCHAR to TEXT"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error converting special_scenario_captures to TEXT:', err.message);
  }

  // Add status column to friends table for friend request approval system
  try {
    const friendsStatusCol = await columnExists('friends', 'status');
    if (!friendsStatusCol) {
      await runMigration(
        `ALTER TABLE friends ADD COLUMN status ENUM('pending', 'accepted', 'declined') DEFAULT 'accepted' AFTER friend_id`,
        "Add status column to friends table for request approval"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding status column to friends table:', err.message);
  }

  // Drop the unique constraint and add a new one that allows duplicate pending requests to be declined then re-sent
  // This is handled by the application logic - we'll keep the unique constraint but use status appropriately

  // Add friend challenge columns to games table
  try {
    const isChallengeCol = await columnExists('games', 'is_challenge');
    if (!isChallengeCol) {
      await runMigration(
        `ALTER TABLE games ADD COLUMN is_challenge TINYINT(1) DEFAULT 0 AFTER other_data`,
        "Add is_challenge column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_challenge column to games table:', err.message);
  }

  try {
    const challengedUserIdCol = await columnExists('games', 'challenged_user_id');
    if (!challengedUserIdCol) {
      await runMigration(
        `ALTER TABLE games ADD COLUMN challenged_user_id INT NULL AFTER is_challenge`,
        "Add challenged_user_id column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding challenged_user_id column to games table:', err.message);
  }

  // Add password reset columns to users table
  try {
    const resetTokenCol = await columnExists('users', 'password_reset_token');
    if (!resetTokenCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(100) DEFAULT NULL`,
        "Add password_reset_token column to users table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding password_reset_token column:', err.message);
  }

  try {
    const resetExpiresCol = await columnExists('users', 'password_reset_expires');
    if (!resetExpiresCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN password_reset_expires DATETIME DEFAULT NULL`,
        "Add password_reset_expires column to users table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding password_reset_expires column:', err.message);
  }

  // Add featured_order column to game_types for admin-selected featured games on homepage
  try {
    const featuredOrderCol = await columnExists('game_types', 'featured_order');
    if (!featuredOrderCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN featured_order INT DEFAULT NULL`,
        "Add featured_order column to game_types table for homepage featured games"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding featured_order column:', err.message);
  }

  // Add no_moves_condition column to game_types for "no legal moves = loss" win condition (like checkers)
  try {
    const noMovesConditionCol = await columnExists('game_types', 'no_moves_condition');
    if (!noMovesConditionCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN no_moves_condition BOOLEAN DEFAULT FALSE COMMENT 'If true, player with no legal moves loses (checkers-style). If false with mate_condition, no moves = stalemate (draw)'`,
        "Add no_moves_condition column to game_types table for checkers-style win condition"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding no_moves_condition column:', err.message);
  }

  // Add promotion_pieces_ids column to pieces for customizing which pieces a piece can promote to
  try {
    const promotionPiecesCol = await columnExists('pieces', 'promotion_pieces_ids');
    if (!promotionPiecesCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN promotion_pieces_ids TEXT DEFAULT NULL COMMENT 'JSON array of piece IDs this piece can promote to. If NULL, uses default promotion logic (all non-checkmate pieces)'`,
        "Add promotion_pieces_ids column to pieces table for custom promotion options"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding promotion_pieces_ids column:', err.message);
  }

  // Add capture_on_hop column to pieces for checkers-style captures (capture all pieces hopped over)
  try {
    const captureOnHopCol = await columnExists('pieces', 'capture_on_hop');
    if (!captureOnHopCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN capture_on_hop TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece captures all enemy pieces it hops over during a move (like checkers)'`,
        "Add capture_on_hop column to pieces table for checkers-style jump captures"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding capture_on_hop column:', err.message);
  }

  // Add chain_capture_enabled column to pieces for checkers-style multi-captures (can continue capturing after a capture)
  try {
    const chainCaptureCol = await columnExists('pieces', 'chain_capture_enabled');
    if (!chainCaptureCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN chain_capture_enabled TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece can make additional captures after capturing (like checkers multi-jump)'`,
        "Add chain_capture_enabled column to pieces table for checkers-style chain captures"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding chain_capture_enabled column:', err.message);
  }

  // Add free_move_after_promotion column to pieces for allowing promoted piece one free move (like checkers king)
  try {
    const freeMoveCol = await columnExists('pieces', 'free_move_after_promotion');
    if (!freeMoveCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN free_move_after_promotion TINYINT(1) DEFAULT 0 COMMENT 'If true, after promoting the piece can make one additional move (like checkers king promotion)'`,
        "Add free_move_after_promotion column to pieces table for post-promotion free move"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding free_move_after_promotion column:', err.message);
  }

  // Add can_hop_attack_over_allies column to pieces for attack-specific hopping (separate from movement hopping)
  try {
    const hopAttackAlliesCol = await columnExists('pieces', 'can_hop_attack_over_allies');
    if (!hopAttackAlliesCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN can_hop_attack_over_allies TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece can hop over allied pieces when attacking (separate from movement hopping)'`,
        "Add can_hop_attack_over_allies column to pieces table for attack-specific hopping"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding can_hop_attack_over_allies column:', err.message);
  }

  // Add can_hop_attack_over_enemies column to pieces for attack-specific hopping
  try {
    const hopAttackEnemiesCol = await columnExists('pieces', 'can_hop_attack_over_enemies');
    if (!hopAttackEnemiesCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN can_hop_attack_over_enemies TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece can hop over enemy pieces when attacking (for checkers-style captures)'`,
        "Add can_hop_attack_over_enemies column to pieces table for attack-specific hopping"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding can_hop_attack_over_enemies column:', err.message);
  }
  
  // Add chain_hop_allies column to pieces for allowing chain hops over allied pieces
  try {
    const chainHopAlliesCol = await columnExists('pieces', 'chain_hop_allies');
    if (!chainHopAlliesCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN chain_hop_allies TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece can chain hop over allied pieces during multi-jump sequences'`,
        "Add chain_hop_allies column to pieces table for chain hopping over allies"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding chain_hop_allies column:', err.message);
  }
  
  // Add is_correspondence column to games table
  try {
    if (!(await columnExists('games', 'is_correspondence'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN is_correspondence TINYINT(1) NOT NULL DEFAULT 0",
        "Add is_correspondence column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_correspondence column to games:', err.message);
  }

  // Add correspondence_days column to games table
  try {
    if (!(await columnExists('games', 'correspondence_days'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN correspondence_days INT DEFAULT NULL",
        "Add correspondence_days column to games table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding correspondence_days column to games:', err.message);
  }

  // Add chat_is_public column to games table.
  // Controls whether in-game chat is visible in match history.
  // Defaults to 0 (private). Set to 1 only when both players explicitly opted
  // into public spectator chat during the game. Existing games default to 0
  // (private) since the original preference was never stored on the game record.
  try {
    if (!(await columnExists('games', 'chat_is_public'))) {
      await runMigration(
        "ALTER TABLE games ADD COLUMN chat_is_public TINYINT(1) NOT NULL DEFAULT 0",
        "Add chat_is_public column to games table — controls match-history chat visibility"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding chat_is_public column to games:', err.message);
  }

  // Create notifications table
  try {
    const notificationsExists = await tableExists('notifications');
    if (!notificationsExists) {
      await runMigration(
        `CREATE TABLE IF NOT EXISTS notifications (
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
        )`,
        "Create notifications table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating notifications table:', err.message);
  }

  // Create notification_email_log table
  try {
    const emailLogExists = await tableExists('notification_email_log');
    if (!emailLogExists) {
      await runMigration(
        `CREATE TABLE IF NOT EXISTS notification_email_log (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id INT UNSIGNED NOT NULL,
          notification_count INT UNSIGNED NOT NULL,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          week_start DATE NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_user_week (user_id, week_start)
        )`,
        "Create notification_email_log table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating notification_email_log table:', err.message);
  }

  // Add hide_donation_badge column to users for anonymous donation preference
  try {
    const hideBadgeCol = await columnExists('users', 'hide_donation_badge');
    if (!hideBadgeCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN hide_donation_badge TINYINT(1) DEFAULT 0 COMMENT 'If true, donation badge is hidden on profile'`,
        "Add hide_donation_badge column to users table for anonymous donation preference"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding hide_donation_badge column:', err.message);
  }

  // Add google_id column to users for Google Sign-In
  try {
    const googleIdCol = await columnExists('users', 'google_id');
    if (!googleIdCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN google_id VARCHAR(255) DEFAULT NULL COMMENT 'Google account ID for Google Sign-In'`,
        "Add google_id column to users table for Google Sign-In"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding google_id column:', err.message);
  }

  // Add anonymous game support columns to games table
  try {
    const isAnonymousCol = await columnExists('games', 'is_anonymous');
    if (!isAnonymousCol) {
      await runMigration(
        `ALTER TABLE games ADD COLUMN is_anonymous TINYINT(1) DEFAULT 0`,
        "Add is_anonymous column to games table for anonymous play"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_anonymous column:', err.message);
  }

  try {
    const inviteCodeCol = await columnExists('games', 'invite_code');
    if (!inviteCodeCol) {
      await runMigration(
        `ALTER TABLE games ADD COLUMN invite_code VARCHAR(8) DEFAULT NULL`,
        "Add invite_code column to games table for anonymous play"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding invite_code column:', err.message);
  }

  // Add show_display_name column to users table
  try {
    const showDisplayNameCol = await columnExists('users', 'show_display_name');
    if (!showDisplayNameCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN show_display_name TINYINT(1) NOT NULL DEFAULT 0`,
        "Add show_display_name column to users table for public name display preference"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding show_display_name column:', err.message);
  }

  // Add chess_com_username column to users table (for displaying chess.com profile link)
  try {
    const chessComCol = await columnExists('users', 'chess_com_username');
    if (!chessComCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN chess_com_username VARCHAR(50) DEFAULT NULL`,
        "Add chess_com_username column to users table for linking chess.com profile"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding chess_com_username column:', err.message);
  }

  // Add lichess_username column to users table (for displaying lichess.org profile link;
  // distinct from lichess_id which is OAuth-only)
  try {
    const lichessUsernameCol = await columnExists('users', 'lichess_username');
    if (!lichessUsernameCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN lichess_username VARCHAR(50) DEFAULT NULL`,
        "Add lichess_username column to users table for linking lichess.org profile"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding lichess_username column:', err.message);
  }

  // Add twitch_channel column to users table (for displaying Twitch stream on streams page)
  try {
    const twitchChannelCol = await columnExists('users', 'twitch_channel');
    if (!twitchChannelCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN twitch_channel VARCHAR(50) DEFAULT NULL`,
        "Add twitch_channel column to users table for linking Twitch stream"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding twitch_channel column:', err.message);
  }

  // Add created_at column to pieces table
  try {
    const piecesCreatedAt = await columnExists('pieces', 'created_at');
    if (!piecesCreatedAt) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
        "Add created_at column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding created_at to pieces:', err.message);
  }

  // Add created_at column to game_types table
  try {
    const gameTypesCreatedAt = await columnExists('game_types', 'created_at');
    if (!gameTypesCreatedAt) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
        "Add created_at column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding created_at to game_types:', err.message);
  }

  // Add is_anonymous_creator column to pieces table
  try {
    const piecesAnonCreator = await columnExists('pieces', 'is_anonymous_creator');
    if (!piecesAnonCreator) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN is_anonymous_creator TINYINT(1) DEFAULT 0`,
        "Add is_anonymous_creator column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_anonymous_creator to pieces:', err.message);
  }

  // Add is_anonymous_creator column to game_types table
  try {
    const gameTypesAnonCreator = await columnExists('game_types', 'is_anonymous_creator');
    if (!gameTypesAnonCreator) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN is_anonymous_creator TINYINT(1) DEFAULT 0`,
        "Add is_anonymous_creator column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_anonymous_creator to game_types:', err.message);
  }

  // Add piece_count_condition column to game_types for Othello-style "most pieces wins" condition
  try {
    const pieceCountConditionCol = await columnExists('game_types', 'piece_count_condition');
    if (!pieceCountConditionCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN piece_count_condition BOOLEAN DEFAULT FALSE COMMENT 'If true, player with the most pieces on the board wins when no more valid moves can be made or the board is full (Othello-style)'`,
        "Add piece_count_condition column to game_types table for Othello-style win condition"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding piece_count_condition column:', err.message);
  }

  // Add trample column to pieces table for trample ability (damages all pieces in path)
  try {
    const trampleCol = await columnExists('pieces', 'trample');
    if (!trampleCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN trample TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece damages every piece in its straight-line path during movement'`,
        "Add trample column to pieces table for trample ability"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding trample column:', err.message);
  }

  // Add trample_radius column to pieces table for trample area of effect
  try {
    const trampleRadiusCol = await columnExists('pieces', 'trample_radius');
    if (!trampleRadiusCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN trample_radius INT DEFAULT 0 COMMENT 'Radius of trample effect (0-4). 0 = only path squares, 1+ = also affects surrounding squares at each step'`,
        "Add trample_radius column to pieces table for trample area of effect"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding trample_radius column:', err.message);
  }

  // Add ghostwalk column to pieces table for passing through pieces
  try {
    const ghostwalkCol = await columnExists('pieces', 'ghostwalk');
    if (!ghostwalkCol) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN ghostwalk TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece can pass through any piece during movement'`,
        "Add ghostwalk column to pieces table for ghostwalk ability"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding ghostwalk column:', err.message);
  }

  // Add trample, ghostwalk, trample_radius columns to game_type_pieces for per-placement overrides
  try {
    const gtpTrample = await columnExists('game_type_pieces', 'trample');
    if (!gtpTrample) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN trample TINYINT(1) DEFAULT 0 COMMENT 'Per-placement trample override'`,
        "Add trample column to game_type_pieces for per-placement override"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding trample to game_type_pieces:', err.message);
  }

  try {
    const gtpTrampleRadius = await columnExists('game_type_pieces', 'trample_radius');
    if (!gtpTrampleRadius) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN trample_radius INT DEFAULT 0 COMMENT 'Per-placement trample radius override'`,
        "Add trample_radius column to game_type_pieces for per-placement override"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding trample_radius to game_type_pieces:', err.message);
  }

  try {
    const gtpGhostwalk = await columnExists('game_type_pieces', 'ghostwalk');
    if (!gtpGhostwalk) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN ghostwalk TINYINT(1) DEFAULT 0 COMMENT 'Per-placement ghostwalk override'`,
        "Add ghostwalk column to game_type_pieces for per-placement override"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding ghostwalk to game_type_pieces:', err.message);
  }

  
  // Add die_on_capture column to pieces table
  try {
    const piecesDieOnCapture = await columnExists('pieces', 'die_on_capture');
    if (!piecesDieOnCapture) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN die_on_capture TINYINT(1) DEFAULT 0 COMMENT 'If true, this piece is also removed when it captures another piece'`,
        "Add die_on_capture column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding die_on_capture to pieces:', err.message);
  }

  // Add attack_radius column to pieces table
  try {
    const piecesAttackRadius = await columnExists('pieces', 'attack_radius');
    if (!piecesAttackRadius) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN attack_radius INT DEFAULT 0 COMMENT 'Radius of area-of-effect damage around landing square on capture (like trample radius but independent of trample)'`,
        "Add attack_radius column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding attack_radius to pieces:', err.message);
  }

  // Add die_on_capture column to game_type_pieces for per-placement overrides
  try {
    const gtpDieOnCapture = await columnExists('game_type_pieces', 'die_on_capture');
    if (!gtpDieOnCapture) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN die_on_capture TINYINT(1) DEFAULT 0 COMMENT 'Per-placement die_on_capture override'`,
        "Add die_on_capture column to game_type_pieces for per-placement override"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding die_on_capture to game_type_pieces:', err.message);
  }

  // Add attack_radius column to game_type_pieces for per-placement overrides
  try {
    const gtpAttackRadius = await columnExists('game_type_pieces', 'attack_radius');
    if (!gtpAttackRadius) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN attack_radius INT DEFAULT 0 COMMENT 'Per-placement attack_radius override'`,
        "Add attack_radius column to game_type_pieces for per-placement override"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding attack_radius to game_type_pieces:', err.message);
  }

  // Add die_on_capture_grants_win to pieces and game_type_pieces
  try {
    const piecesDocgw = await columnExists('pieces', 'die_on_capture_grants_win');
    if (!piecesDocgw) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN die_on_capture_grants_win TINYINT(1) DEFAULT 0 COMMENT 'If true, attacker wins (instead of draw) when its die_on_capture kill removes the opponent last ends_game_on_capture piece'`,
        "Add die_on_capture_grants_win column to pieces"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding die_on_capture_grants_win to pieces:', err.message);
  }
  try {
    const gtpDocgw = await columnExists('game_type_pieces', 'die_on_capture_grants_win');
    if (!gtpDocgw) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN die_on_capture_grants_win TINYINT(1) DEFAULT 0 COMMENT 'Per-placement die_on_capture_grants_win override'`,
        "Add die_on_capture_grants_win column to game_type_pieces"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding die_on_capture_grants_win to game_type_pieces:', err.message);
  }

  // ===================== MESSAGING SYSTEM MIGRATIONS =====================
  
    // Create direct_messages table for private messaging
    try {
      const messagesExists = await tableExists('direct_messages');
      if (!messagesExists) {
        await runMigration(
          `CREATE TABLE direct_messages (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            sender_id INT UNSIGNED NOT NULL,
            recipient_id INT UNSIGNED NOT NULL,
            content TEXT NOT NULL,
            is_read TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_dm_sender (sender_id),
            INDEX idx_dm_recipient (recipient_id),
            INDEX idx_dm_conversation (sender_id, recipient_id, created_at),
            INDEX idx_dm_unread (recipient_id, is_read)
          )`,
          "Create direct_messages table for private messaging"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error creating direct_messages table:', err.message);
    }
  
    // Create game_chat_messages table for persisting in-game chat
    try {
      const gameChatExists = await tableExists('game_chat_messages');
      if (!gameChatExists) {
        await runMigration(
          `CREATE TABLE game_chat_messages (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            game_id BIGINT UNSIGNED NOT NULL,
            sender_id INT UNSIGNED,
            sender_username VARCHAR(100) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_gc_game (game_id),
            INDEX idx_gc_game_time (game_id, created_at)
          )`,
          "Create game_chat_messages table for persisting in-game chat"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error creating game_chat_messages table:', err.message);
    }
  
    // Add allow_non_friend_dms column to users (default 1 = open DMs)
    try {
      const allowDmsCol = await columnExists('users', 'allow_non_friend_dms');
      if (!allowDmsCol) {
        await runMigration(
          "ALTER TABLE users ADD COLUMN allow_non_friend_dms TINYINT(1) DEFAULT 1 COMMENT 'If true, allows DMs from non-friends'",
          "Add allow_non_friend_dms column to users table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding allow_non_friend_dms column:', err.message);
    }
  
    // Add disable_game_chat column to users (default 0 = chat enabled)
    try {
      const disableChatCol = await columnExists('users', 'disable_game_chat');
      if (!disableChatCol) {
        await runMigration(
          "ALTER TABLE users ADD COLUMN disable_game_chat TINYINT(1) DEFAULT 0 COMMENT 'If true, game chat is disabled for this user'",
          "Add disable_game_chat column to users table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding disable_game_chat column:', err.message);
    }

    // Add sound_enabled column to users (default 1 = sound on)
    try {
      const soundCol = await columnExists('users', 'sound_enabled');
      if (!soundCol) {
        await runMigration(
          "ALTER TABLE users ADD COLUMN sound_enabled TINYINT(1) DEFAULT 1 COMMENT 'If true, sound effects are enabled in games'",
          "Add sound_enabled column to users table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding sound_enabled column:', err.message);
    }

    // Add chat_public_for_spectators column to users (default 0 = private)
    try {
      const chatPublicCol = await columnExists('users', 'chat_public_for_spectators');
      if (!chatPublicCol) {
        await runMigration(
          "ALTER TABLE users ADD COLUMN chat_public_for_spectators TINYINT(1) DEFAULT 0 COMMENT 'If true, game chat is visible to spectators by default'",
          "Add chat_public_for_spectators column to users table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding chat_public_for_spectators column:', err.message);
    }

    // Add show_computer_games_publicly column to users (default 0 = private)
    try {
      const showBotCol = await columnExists('users', 'show_computer_games_publicly');
      if (!showBotCol) {
        await runMigration(
          "ALTER TABLE users ADD COLUMN show_computer_games_publicly TINYINT(1) DEFAULT 0 COMMENT 'If true, the user\\'s ongoing games against the computer appear in the public ongoing games list'",
          "Add show_computer_games_publicly column to users table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding show_computer_games_publicly column:', err.message);
    }

    // Add disallow_guest_opponents column to users (default 0 = guests allowed)
    try {
      const disallowGuestCol = await columnExists('users', 'disallow_guest_opponents');
      if (!disallowGuestCol) {
        await runMigration(
          "ALTER TABLE users ADD COLUMN disallow_guest_opponents TINYINT(1) DEFAULT 0 COMMENT 'If true, guest (non-logged-in) players cannot join this user\\'s unrated open games'",
          "Add disallow_guest_opponents column to users table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding disallow_guest_opponents column:', err.message);
    }

    // Add custom_movement_squares column to pieces (JSON for click-to-select custom movement)
    try {
      const customMoveCol = await columnExists('pieces', 'custom_movement_squares');
      if (!customMoveCol) {
        await runMigration(
          "ALTER TABLE pieces ADD COLUMN custom_movement_squares TEXT DEFAULT NULL COMMENT 'JSON array of custom movement square offsets [{row,col}]'",
          "Add custom_movement_squares column to pieces table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding custom_movement_squares column:', err.message);
    }

    // Add custom_attack_squares column to pieces (JSON for click-to-select custom attack)
    try {
      const customAttackCol = await columnExists('pieces', 'custom_attack_squares');
      if (!customAttackCol) {
        await runMigration(
          "ALTER TABLE pieces ADD COLUMN custom_attack_squares TEXT DEFAULT NULL COMMENT 'JSON array of custom attack square offsets [{row,col}]'",
          "Add custom_attack_squares column to pieces table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding custom_attack_squares column:', err.message);
    }

    // Add parent_id column to comments for threaded replies
    try {
      const parentIdCol = await columnExists('comments', 'parent_id');
      if (!parentIdCol) {
        await runMigration(
          "ALTER TABLE comments ADD COLUMN parent_id INT DEFAULT NULL",
          "Add parent_id column to comments for threaded replies"
        );
        // Add foreign key separately so it doesn't fail if constraint already exists
        try {
          await runMigration(
            "ALTER TABLE comments ADD CONSTRAINT fk_comment_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE",
            "Add foreign key for comment parent_id"
          );
        } catch (fkErr) {
          console.error('FK constraint may already exist:', fkErr.message);
        }
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding parent_id column to comments:', err.message);
    }

    // Update default preferences: allow_non_friend_dms and sound_enabled should default to 1
    // This migrates existing users who still have the old default (0) and changes the column default
    try {
      const checkDefault = async (colName) => {
        const sql = `SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`;
        const [rows] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode', colName]);
        return rows[0]?.COLUMN_DEFAULT;
      };
      const dmDefault = await checkDefault('allow_non_friend_dms');
      if (dmDefault === '0') {
        await runMigration(
          "ALTER TABLE users ALTER COLUMN allow_non_friend_dms SET DEFAULT 1",
          "Change allow_non_friend_dms default to 1"
        );
        await runMigration(
          "UPDATE users SET allow_non_friend_dms = 1 WHERE allow_non_friend_dms = 0",
          "Enable DMs for existing users"
        );
        migrationsRun++;
      }
      const soundDefault = await checkDefault('sound_enabled');
      if (soundDefault === '0') {
        await runMigration(
          "ALTER TABLE users ALTER COLUMN sound_enabled SET DEFAULT 1",
          "Change sound_enabled default to 1"
        );
        await runMigration(
          "UPDATE users SET sound_enabled = 1 WHERE sound_enabled = 0",
          "Enable sound for existing users"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error updating default preferences:', err.message);
    }

    // Backfill: set player_position = 1 for bot game hosts that still have NULL position
    try {
      const [nullPositions] = await db_pool.query(
        `SELECT COUNT(*) as cnt FROM players p
         INNER JOIN games g ON p.game_id = g.id
         WHERE p.player_position IS NULL AND g.other_data LIKE '%"isBotGame":true%'`
      );
      if (nullPositions[0].cnt > 0) {
        await runMigration(
          `UPDATE players p
           INNER JOIN games g ON p.game_id = g.id
           SET p.player_position = 1
           WHERE p.player_position IS NULL AND g.other_data LIKE '%"isBotGame":true%'`,
          `Backfill player_position=1 for ${nullPositions[0].cnt} bot game hosts`
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error backfilling bot game positions:', err.message);
    }

    // Add simultaneous_turns column to game_types
    try {
      const simTurnsCol = await columnExists('game_types', 'simultaneous_turns');
      if (!simTurnsCol) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simultaneous_turns TINYINT(1) DEFAULT 0 COMMENT 'If true, both players submit moves secretly and they resolve simultaneously'",
          "Add simultaneous_turns column to game_types table"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding simultaneous_turns column:', err.message);
    }

    // Add simul-turns sub-setting columns to game_types
    try {
      if (!(await columnExists('game_types', 'simul_turns_clock_pause'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_clock_pause TINYINT(1) DEFAULT 0 COMMENT 'If true, clocks appear paused during a round and only update displayed time after both players submit (visibility-only)'",
          "Add simul_turns_clock_pause column to game_types"
        );
        migrationsRun++;
      }
      if (!(await columnExists('game_types', 'simul_turns_draw_after_cancellations'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_draw_after_cancellations SMALLINT DEFAULT 3 COMMENT 'Draw the game after this many same-square cancellations occur (0 = never)'",
          "Add simul_turns_draw_after_cancellations column to game_types"
        );
        migrationsRun++;
      }
      if (!(await columnExists('game_types', 'simul_turns_submit_mode'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_submit_mode ENUM('immediate','stage') DEFAULT 'immediate' COMMENT 'immediate = clicking a destination submits and locks; stage = pick a move then press Submit'",
          "Add simul_turns_submit_mode column to game_types"
        );
        migrationsRun++;
      }
      if (!(await columnExists('game_types', 'simul_turns_place_conflict'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_place_conflict ENUM('cancel','allow') DEFAULT 'cancel' COMMENT 'How to resolve a piece-placement conflicting with the opponent moving onto that square: cancel both, or allow the placement and cancel the move'",
          "Add simul_turns_place_conflict column to game_types"
        );
        migrationsRun++;
      }
      if (!(await columnExists('game_types', 'simul_turns_free_move_after_capture'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_free_move_after_capture ENUM('disable','restage','allow') DEFAULT 'disable' COMMENT 'How free-move-after-capture/promotion behaves under simul-turns: disable it, give both players a fresh stage cycle, or allow it normally'",
          "Add simul_turns_free_move_after_capture column to game_types"
        );
        migrationsRun++;
      }
      if (!(await columnExists('game_types', 'simul_turns_simultaneous_capture_draw'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_simultaneous_capture_draw TINYINT(1) DEFAULT 1 COMMENT 'If true, a simultaneous capture of game-ending pieces results in a draw (default ON for simul-turns games with a capture/checkmate rule)'",
          "Add simul_turns_simultaneous_capture_draw column to game_types"
        );
        migrationsRun++;
      }
      if (!(await columnExists('game_types', 'simul_turns_simultaneous_checkmate_draw'))) {
        await runMigration(
          "ALTER TABLE game_types ADD COLUMN simul_turns_simultaneous_checkmate_draw TINYINT(1) DEFAULT 1 COMMENT 'If true, both players reaching checkmate in the same simul-turns round results in a draw (default ON for simul-turns games with a checkmate rule)'",
          "Add simul_turns_simultaneous_checkmate_draw column to game_types"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding simul-turns sub-setting columns:', err.message);
    }

    // Add promotion_condition column to game_types (win when a promotable piece reaches a promotion square)
    try {
      const promotionConditionCol = await columnExists('game_types', 'promotion_condition');
      if (!promotionConditionCol) {
        await runMigration(
          `ALTER TABLE game_types ADD COLUMN promotion_condition BOOLEAN DEFAULT FALSE COMMENT 'If true, a player instantly wins when their promotable piece reaches a promotion square'`,
          "Add promotion_condition column to game_types table for win-on-promotion condition"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error adding promotion_condition column:', err.message);
    }

    // Upgrade pieces_string to MEDIUMTEXT for large game boards
    try {
      const [columns] = await db_pool.query(
        `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'game_types' AND COLUMN_NAME = 'pieces_string'`,
        [process.env.DB_NAME || 'chessusnode']
      );
      if (columns.length > 0 && columns[0].DATA_TYPE !== 'mediumtext') {
        await runMigration(
          "ALTER TABLE game_types MODIFY COLUMN pieces_string MEDIUMTEXT",
          "Increase game_types.pieces_string to MEDIUMTEXT for large boards"
        );
        migrationsRun++;
      }
    } catch (err) {
      console.error('Error upgrading pieces_string to MEDIUMTEXT:', err.message);
    }

  // Add lichess_id column to users for Lichess OAuth login
  try {
    const lichessIdCol = await columnExists('users', 'lichess_id');
    if (!lichessIdCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN lichess_id VARCHAR(255) DEFAULT NULL COMMENT 'Lichess username for Lichess OAuth login'`,
        "Add lichess_id column to users table for Lichess OAuth login"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding lichess_id column:', err.message);
  }

  // Expand articles.title from VARCHAR(50) to VARCHAR(200) to accommodate auto-generated forum titles
  try {
    const titleCol = await getColumnType('articles', 'title');
    if (titleCol && titleCol.CHARACTER_MAXIMUM_LENGTH < 200) {
      await runMigration(
        `ALTER TABLE articles MODIFY COLUMN title VARCHAR(200)`,
        "Expand articles.title to VARCHAR(200) for longer forum titles"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error expanding articles.title:', err.message);
  }

  // Expand comments.content from VARCHAR(1000) to TEXT to support longer comments
  try {
    const commentContentCol = await getColumnType('comments', 'content');
    if (commentContentCol && commentContentCol.DATA_TYPE === 'varchar') {
      await runMigration(
        `ALTER TABLE comments MODIFY COLUMN content TEXT`,
        "Expand comments.content from VARCHAR(1000) to TEXT for longer comments"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error expanding comments.content:', err.message);
  }

  // Add is_draft column to game_types for draft game support
  try {
    const isDraftCol = await columnExists('game_types', 'is_draft');
    if (!isDraftCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN is_draft TINYINT(1) DEFAULT 0 COMMENT 'If true, game is a draft and not publicly visible'`,
        "Add is_draft column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_draft column:', err.message);
  }

  // Add draft_saved_step column to game_types to remember which wizard step the draft was saved on
  try {
    const draftStepCol = await columnExists('game_types', 'draft_saved_step');
    if (!draftStepCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN draft_saved_step INT DEFAULT NULL COMMENT 'Wizard step number where draft was last saved'`,
        "Add draft_saved_step column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding draft_saved_step column:', err.message);
  }

  // Add updated_at column to game_types so admin draft listing can sort by last edit time
  try {
    const updatedAtCol = await columnExists('game_types', 'updated_at');
    if (!updatedAtCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last time the row was modified'`,
        "Add updated_at column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding updated_at column:', err.message);
  }

  // Add uniqueness checker columns to game_types
  try {
    const isUniqueCol = await columnExists('game_types', 'is_unique');
    if (!isUniqueCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN is_unique TINYINT(1) DEFAULT NULL COMMENT 'NULL=unchecked, 0=not unique, 1=certified unique'`,
        "Add is_unique column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_unique column:', err.message);
  }

  try {
    const uniqueBadgeDateCol = await columnExists('game_types', 'unique_badge_date');
    if (!uniqueBadgeDateCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN unique_badge_date DATETIME DEFAULT NULL COMMENT 'Date when unique badge was first awarded; only resets on game update'`,
        "Add unique_badge_date column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding unique_badge_date column:', err.message);
  }

  try {
    const uniquenessScoreCol = await columnExists('game_types', 'uniqueness_score');
    if (!uniquenessScoreCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN uniqueness_score FLOAT DEFAULT NULL COMMENT 'Uniqueness score 0-100'`,
        "Add uniqueness_score column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding uniqueness_score column:', err.message);
  }

  try {
    const similarGamesCol = await columnExists('game_types', 'similar_games');
    if (!similarGamesCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN similar_games TEXT DEFAULT NULL COMMENT 'JSON array of up to 3 similar game ids with similarity scores'`,
        "Add similar_games column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding similar_games column:', err.message);
  }

  try {
    const lastUniquenessCheckCol = await columnExists('game_types', 'last_uniqueness_check');
    if (!lastUniquenessCheckCol) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN last_uniqueness_check DATETIME DEFAULT NULL COMMENT 'When uniqueness check was last run (rate limited to once per day per game)'`,
        "Add last_uniqueness_check column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding last_uniqueness_check column:', err.message);
  }

  // Add capture_condition_requires_all column to game_types table
  // When TRUE, the capture win condition requires ALL pieces flagged with
  // ends_game_on_capture to be captured (instead of just one).
  try {
    if (!(await columnExists('game_types', 'capture_condition_requires_all'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN capture_condition_requires_all BOOLEAN DEFAULT FALSE COMMENT 'If true, all pieces with ends_game_on_capture must be captured to end the game'`,
        "Add capture_condition_requires_all column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding capture_condition_requires_all column:', err.message);
  }

  // Add mate_condition_requires_all column to game_types table
  // When TRUE, the checkmate win condition requires ALL pieces flagged with
  // ends_game_on_checkmate to be checkmated/captured (instead of just one).
  try {
    if (!(await columnExists('game_types', 'mate_condition_requires_all'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN mate_condition_requires_all BOOLEAN DEFAULT FALSE COMMENT 'If true, all pieces with ends_game_on_checkmate must be in a checkmated/captured state to end the game'`,
        "Add mate_condition_requires_all column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding mate_condition_requires_all column:', err.message);
  }

  // Add lose_all_pieces_condition column to game_types table (anti-chess style)
  // When TRUE, a player WINS as soon as they have lost all of their pieces.
  try {
    if (!(await columnExists('game_types', 'lose_all_pieces_condition'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN lose_all_pieces_condition BOOLEAN DEFAULT FALSE COMMENT 'Anti-chess: a player wins when they have lost all of their pieces'`,
        "Add lose_all_pieces_condition column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding lose_all_pieces_condition column:', err.message);
  }

  // Add stalemate_win_condition column to game_types table
  // When TRUE, a stalemated player (no legal moves and not in check) WINS instead of drawing.
  try {
    if (!(await columnExists('game_types', 'stalemate_win_condition'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN stalemate_win_condition BOOLEAN DEFAULT FALSE COMMENT 'If true, a stalemated player (no legal moves, not in check) wins instead of the game being a draw'`,
        "Add stalemate_win_condition column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding stalemate_win_condition column:', err.message);
  }

  // Add forced_capture_condition column to game_types table
  // When TRUE, if any of a player's pieces can capture, they MUST make a capture move.
  try {
    if (!(await columnExists('game_types', 'forced_capture_condition'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN forced_capture_condition BOOLEAN DEFAULT FALSE COMMENT 'If true, players are forced to capture when a capture is available (any capture)'`,
        "Add forced_capture_condition column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding forced_capture_condition column:', err.message);
  }

  // Add stalemate_draw_condition column to game_types table.
  // When TRUE (default for backward compatibility), reaching a stalemate position
  // (no legal moves, not in check) ends the game as a draw — unless a higher-priority
  // rule (stalemate_win_condition or no_moves_condition) overrides it.
  // When FALSE and no override is set, the stalemated player's turn is skipped and a
  // notice is broadcast; the game continues.
  try {
    if (!(await columnExists('game_types', 'stalemate_draw_condition'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN stalemate_draw_condition BOOLEAN DEFAULT TRUE COMMENT 'If true (default), a stalemate ends the game in a draw. If false and no other stalemate rule applies, the stalemated player skips their turn'`,
        "Add stalemate_draw_condition column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding stalemate_draw_condition column:', err.message);
  }

  // Email notification preferences columns on users table.
  // notification_email_enabled: global on/off for the weekly notification digest email.
  // notification_email_disabled_types: comma-separated list of notification 'type' values
  // the user has opted out of for the digest (those types are excluded from both the
  // threshold count AND the email body).
  try {
    if (!(await columnExists('users', 'notification_email_enabled'))) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN notification_email_enabled TINYINT(1) DEFAULT 1 COMMENT 'If 1 (default), user receives the weekly notification digest email. If 0, user has globally unsubscribed.'`,
        "Add notification_email_enabled column to users table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding notification_email_enabled column:', err.message);
  }
  try {
    if (!(await columnExists('users', 'notification_email_disabled_types'))) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN notification_email_disabled_types VARCHAR(500) DEFAULT '' COMMENT 'Comma-separated notification type strings the user has opted out of in the digest email.'`,
        "Add notification_email_disabled_types column to users table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding notification_email_disabled_types column:', err.message);
  }

  // Bump site_settings.setting_value to TEXT to support longer values (e.g. banner text)
  try {
    const sql = `
      SELECT DATA_TYPE
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_settings' AND COLUMN_NAME = 'setting_value'
    `;
    const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode']);
    if (results[0] && results[0].DATA_TYPE === 'varchar') {
      await runMigration(
        "ALTER TABLE site_settings MODIFY COLUMN setting_value TEXT NOT NULL",
        "Convert site_settings.setting_value from VARCHAR to TEXT for longer values"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error widening site_settings.setting_value:', err.message);
  }

  // Seed default site settings (only inserts if missing — never overwrites admin edits)
  try {
    const defaultSettings = [
      { key: 'forum_invite_enabled', value: 'true' },
      {
        key: 'forum_invite_text',
        value:
          "Welcome new players! 🌿 With so many of you joining recently, we'd love to hear from you. " +
          "Head over to our community forums to discuss bugs you've run into, ask questions, and share " +
          "what changes you'd like to see. Heads-up: while we're rolling out improvements, expect frequent " +
          "server restarts as new updates go live."
      },
      // Game session limits
      { key: 'game_limit_live', value: '8' },
      { key: 'game_limit_correspondence', value: '24' },
      { key: 'game_limit_open', value: '8' },
      { key: 'game_limit_live_anon', value: '4' },
      { key: 'game_limit_correspondence_anon', value: '12' },
      { key: 'game_limit_open_anon', value: '4' },
      // About Us page (admin-editable). The mission text supports
      // multi-paragraph plain text (\n\n separates paragraphs). The
      // team is a JSON array of { username, profile_link, role,
      // contribution, picture_url }, capped at 20 entries by the
      // admin UI. Default to empty so a fresh deploy ships with no
      // hard-coded names — admin populates them post-deploy.
      { key: 'about_mission_text', value: '' },
      { key: 'about_team_members', value: '[]' },
    ];
    for (const setting of defaultSettings) {
      const [rows] = await db_pool.query(
        "SELECT 1 FROM site_settings WHERE setting_key = ? LIMIT 1",
        [setting.key]
      );
      if (rows.length === 0) {
        await db_pool.query(
          "INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)",
          [setting.key, setting.value]
        );
        console.log(`  ✓ Seeded site_settings: ${setting.key}`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error seeding default site settings:', err.message);
  }

  // Add `source` column to ai_training_jobs so admins can tell apart
  // cloud-trained jobs from artifacts uploaded from a dev machine.
  try {
    if (await tableExists('ai_training_jobs')) {
      if (!(await columnExists('ai_training_jobs', 'source'))) {
        await runMigration(
          `ALTER TABLE ai_training_jobs
           ADD COLUMN source ENUM('cloud','uploaded') NOT NULL DEFAULT 'cloud'
             COMMENT 'cloud = run on this trainer; uploaded = artifacts imported from elsewhere'`,
          "Add source column to ai_training_jobs"
        );
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error adding source column to ai_training_jobs:', err.message);
  }

  // AI training analyses: persistent per-game-type summary of training
  // results (win-rate by side, draw-type breakdown, sample size, etc.)
  // with a visibility flag controlling who can see the published view.
  try {
    if (!(await tableExists('ai_training_analyses'))) {
      await runMigration(
        `CREATE TABLE ai_training_analyses (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          game_type_id INT UNSIGNED NOT NULL UNIQUE,
          summary_json LONGTEXT NOT NULL COMMENT 'JSON: totals, per-side win rates, draw breakdown, etc.',
          visibility ENUM('private','creator','public') NOT NULL DEFAULT 'private'
            COMMENT 'private = admins only; creator = game creator + admins; public = anyone',
          slug VARCHAR(40) UNIQUE COMMENT 'shareable link slug (set when published public)',
          generated_by_user_id INT UNSIGNED,
          generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_analysis_visibility (visibility),
          INDEX idx_analysis_slug (slug),
          FOREIGN KEY (game_type_id) REFERENCES game_types(id) ON DELETE CASCADE,
          FOREIGN KEY (generated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
        "Create ai_training_analyses table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating ai_training_analyses:', err.message);
  }

  // Rate-limit columns for creator-initiated analysis regeneration (5/day).
  try {
    if (await tableExists('ai_training_analyses')) {
      if (!(await columnExists('ai_training_analyses', 'creator_regen_count'))) {
        await runMigration(
          `ALTER TABLE ai_training_analyses
             ADD COLUMN creator_regen_count INT NOT NULL DEFAULT 0
               COMMENT 'Number of creator-initiated regenerations today',
             ADD COLUMN creator_regen_date DATE DEFAULT NULL
               COMMENT 'UTC date when creator_regen_count was last reset'`,
          "Add creator_regen_count and creator_regen_date to ai_training_analyses"
        );
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error adding creator regen columns:', err.message);
  }

  // Announcements: site-wide one-shot updates the team posts and that fan
  // out as `announcement`-type notifications to every user.
  try {
    if (!(await tableExists('announcements'))) {
      await runMigration(
        `CREATE TABLE announcements (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(200) NOT NULL,
          content TEXT NOT NULL,
          action_url VARCHAR(300),
          author_id INT UNSIGNED,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_announcements_created (created_at DESC),
          FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
        "Create announcements table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating announcements:', err.message);
  }

  // Add initial_state_warning column to game_types table.
  // Populated by the admin "Initial Position Scan" tool (and after edits).
  // When non-null, the game detail page shows a banner explaining that the
  // starting position is already in a decided state (win / loss / draw).
  try {
    if (!(await columnExists('game_types', 'initial_state_warning'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN initial_state_warning VARCHAR(300) DEFAULT NULL COMMENT 'If set, the starting position of this game type is already in a decided state (win/loss/draw).'`,
        "Add initial_state_warning column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding initial_state_warning column:', err.message);
  }

  // Add initial_state_checked_at column to game_types table.
  try {
    if (!(await columnExists('game_types', 'initial_state_checked_at'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN initial_state_checked_at DATETIME DEFAULT NULL COMMENT 'Last time the initial-position validator was run against this game type.'`,
        "Add initial_state_checked_at column to game_types table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding initial_state_checked_at column:', err.message);
  }

  // Add category column to articles table for forum categorization.
  // Game forums always have category='game'; general forums get a user-chosen
  // category (general / bug-report / social / misc / gameplay / feedback / etc.)
  try {
    if (!(await columnExists('articles', 'category'))) {
      await runMigration(
        `ALTER TABLE articles ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT 'general' COMMENT 'Forum category: general | bug-report | social | misc | gameplay | feedback | game (game-specific forum).'`,
        "Add category column to articles table"
      );
      // Backfill: every article that has a game_type_id is a 'game' forum;
      // everything else stays 'general' (the column default already covers
      // brand-new rows, but explicitly set existing rows so the data is
      // consistent for any later filtering).
      try {
        await runMigration(
          `UPDATE articles SET category = 'game' WHERE game_type_id IS NOT NULL`,
          "Backfill category='game' for existing game forums"
        );
      } catch (backfillErr) {
        console.error('Error backfilling article category:', backfillErr.message);
      }
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding category column to articles:', err.message);
  }

  // Widen notifications.content from VARCHAR(500) to TEXT so that full
  // announcement bodies (up to 5000 chars) can be stored without truncation.
  try {
    const notifContentType = await getColumnType('notifications', 'content');
    if (notifContentType && notifContentType.DATA_TYPE === 'varchar') {
      await runMigration(
        `ALTER TABLE notifications MODIFY COLUMN content TEXT`,
        "Widen notifications.content from VARCHAR(500) to TEXT"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error widening notifications.content:', err.message);
  }

  // Add external_blog_url column to articles table for news articles that
  // embed or link to an external blog post (e.g., a Lichess blog).
  try {
    if (!(await columnExists('articles', 'external_blog_url'))) {
      await runMigration(
        "ALTER TABLE articles ADD COLUMN external_blog_url TEXT NULL AFTER is_news",
        "Add external_blog_url column to articles table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding external_blog_url column to articles:', err.message);
  }

  // Add external_blog_label column to articles — lets admins customise the link-card label text.
  try {
    if (!(await columnExists('articles', 'external_blog_label'))) {
      await runMigration(
        "ALTER TABLE articles ADD COLUMN external_blog_label TEXT NULL AFTER external_blog_url",
        "Add external_blog_label column to articles table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding external_blog_label column to articles:', err.message);
  }

  // ai_analysis_requests: persistent log of every analysis request a creator
  // makes for one of their game types. The notifications table tracks unread
  // pings to the owner; this table is the durable record admins can review,
  // mark fulfilled, and delete on their own schedule.
  try {
    if (!(await tableExists('ai_analysis_requests'))) {
      await runMigration(
        `CREATE TABLE ai_analysis_requests (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          game_type_id INT UNSIGNED NOT NULL,
          requester_user_id INT UNSIGNED,
          requester_username VARCHAR(50),
          status ENUM('pending','fulfilled','dismissed') NOT NULL DEFAULT 'pending',
          notes TEXT NULL COMMENT 'Optional admin notes / context',
          request_count INT UNSIGNED NOT NULL DEFAULT 1
            COMMENT 'Incremented when the same user re-requests while still pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          fulfilled_at TIMESTAMP NULL,
          fulfilled_by_user_id INT UNSIGNED NULL,
          INDEX idx_aar_status_created (status, created_at),
          INDEX idx_aar_game_type (game_type_id),
          FOREIGN KEY (game_type_id) REFERENCES game_types(id) ON DELETE CASCADE,
          FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (fulfilled_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
        "Create ai_analysis_requests table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating ai_analysis_requests:', err.message);
  }

  // Expand game_types.game_name from VARCHAR(50) to VARCHAR(100)
  try {
    const gameNameCol = await getColumnType('game_types', 'game_name');
    if (gameNameCol && gameNameCol.CHARACTER_MAXIMUM_LENGTH < 100) {
      await runMigration(
        `ALTER TABLE game_types MODIFY COLUMN game_name VARCHAR(100) NOT NULL`,
        "Expand game_types.game_name to VARCHAR(100)"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error expanding game_types.game_name:', err.message);
  }

  // ── Points win condition ───────────────────────────────────────────────────
  // points_to_win: the score a player must reach to win (NULL = disabled).
  try {
    if (!(await columnExists('game_types', 'points_to_win'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN points_to_win INT NULL DEFAULT NULL COMMENT 'If set, the first player to reach this many points wins'`,
        "Add points_to_win column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding points_to_win column:', err.message);
  }

  // starting_points_p1 / starting_points_p2: optional head-start for balancing.
  try {
    if (!(await columnExists('game_types', 'starting_points_p1'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN starting_points_p1 INT NOT NULL DEFAULT 0 COMMENT 'Initial score for Player 1 at game start'`,
        "Add starting_points_p1 column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding starting_points_p1 column:', err.message);
  }
  try {
    if (!(await columnExists('game_types', 'starting_points_p2'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN starting_points_p2 INT NOT NULL DEFAULT 0 COMMENT 'Initial score for Player 2 at game start'`,
        "Add starting_points_p2 column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding starting_points_p2 column:', err.message);
  }

  // draw_equal_points_at_turn: draw fires at turn N if both players have equal scores.
  try {
    if (!(await columnExists('game_types', 'draw_equal_points_at_turn'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN draw_equal_points_at_turn INT NULL DEFAULT NULL COMMENT 'If set, the game is a draw when both players have equal points at exactly turn N'`,
        "Add draw_equal_points_at_turn column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding draw_equal_points_at_turn column:', err.message);
  }

  // draw_equal_points_consecutive: draw fires after N consecutive turns of tied scores.
  try {
    if (!(await columnExists('game_types', 'draw_equal_points_consecutive'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN draw_equal_points_consecutive INT NULL DEFAULT NULL COMMENT 'If set, the game is a draw after N consecutive half-moves where both players have equal scores'`,
        "Add draw_equal_points_consecutive column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding draw_equal_points_consecutive column:', err.message);
  }

  // capture_points_gain on game_type_pieces: points the CAPTURER gains when taking this piece.
  try {
    if (!(await columnExists('game_type_pieces', 'capture_points_gain'))) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN capture_points_gain INT NOT NULL DEFAULT 0 COMMENT 'Points awarded to the player who captures this piece'`,
        "Add capture_points_gain column to game_type_pieces"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding capture_points_gain column:', err.message);
  }

  // capture_points_loss on game_type_pieces: points DEDUCTED from the piece owner when captured.
  try {
    if (!(await columnExists('game_type_pieces', 'capture_points_loss'))) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN capture_points_loss INT NOT NULL DEFAULT 0 COMMENT 'Points deducted from the piece owner when this piece is captured'`,
        "Add capture_points_loss column to game_type_pieces"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding capture_points_loss column:', err.message);
  }

  // cannot_move_outside_zone on game_type_pieces: restricts piece to restriction-zone custom squares.
  try {
    if (!(await columnExists('game_type_pieces', 'cannot_move_outside_zone'))) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN cannot_move_outside_zone TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'If true, this piece may only move to squares marked as restriction zones'`,
        "Add cannot_move_outside_zone column to game_type_pieces"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding cannot_move_outside_zone column:', err.message);
  }

  // is_neutral on game_type_pieces: marks a piece as belonging to no player (neutral).
  try {
    if (!(await columnExists('game_type_pieces', 'is_neutral'))) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN is_neutral TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'If true, this piece can be moved and captured by any player'`,
        "Add is_neutral column to game_type_pieces"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_neutral column:', err.message);
  }

  // created_at on users: tracks account registration date for user-growth admin stats.
  try {
    if (!(await columnExists('users', 'created_at'))) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT NULL COMMENT 'Account registration timestamp'`,
        "Add created_at column to users"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding created_at column to users:', err.message);
  }

  // admin_level: distinguishes Admin 1 (full) from Admin 2 (restricted). NULL = not admin / owner.
  try {
    if (!(await columnExists('users', 'admin_level'))) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN admin_level TINYINT NULL DEFAULT NULL COMMENT '1 = Admin 1 (full), 2 = Admin 2 (restricted). NULL for non-admins and owner.'`,
        "Add admin_level column to users"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding admin_level column to users:', err.message);
  }

  // is_training_only: game types created by uploading rules.json for local AI
  // training; they are hidden from all public-facing listings.
  try {
    if (!(await columnExists('game_types', 'is_training_only'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN is_training_only TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'If true, game type is for AI training only and hidden from public listings'`,
        "Add is_training_only column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_training_only column to game_types:', err.message);
  }

  // default_starting_mode: which starting position mode is pre-selected when
  // a player opens the Host Game modal for this game type.
  try {
    if (!(await columnExists('game_types', 'default_starting_mode'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN default_starting_mode VARCHAR(30) DEFAULT NULL COMMENT 'Default starting position mode shown in the host game modal (none/backrow/mirrored/independent/shared/full)'`,
        "Add default_starting_mode column to game_types"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding default_starting_mode column to game_types:', err.message);
  }

  if (migrationsRun === 0) {
    console.log('[DB] All migrations up to date\n');
  } else {
    console.log(`\n[DB] Applied ${migrationsRun} migration(s)\n`);
  }

  // Add image_sources_json column to pieces so the community-images browser can exclude
  // pieces whose primary image was chosen from the built-in library (source = 'library').
  try {
    if (!(await columnExists('pieces', 'image_sources_json'))) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN image_sources_json TEXT DEFAULT NULL COMMENT 'JSON array of image source strings (library|community|upload) matching image_location order'`,
        "Add image_sources_json column to pieces table"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding image_sources_json column to pieces:', err.message);
  }

  // Add composite index on games(status, start_time) for the ongoing-games query
  // (WHERE status IN ('active','ready') ORDER BY start_time DESC)
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND INDEX_NAME = 'idx_games_status_start_time'
       LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query('CREATE INDEX idx_games_status_start_time ON games (status, start_time DESC)');
      console.log('✓ Created index idx_games_status_start_time on games');
    }
  } catch (err) {
    console.error('Error creating idx_games_status_start_time:', err.message);
  }

  // Add composite index on games(is_correspondence, status) so the hourly
  // correspondence expiry/low-time pollers can filter to just correspondence
  // games BEFORE reading the large other_data MEDIUMTEXT blobs (those pollers
  // run JSON_EXTRACT over other_data, which forces MySQL to read every blob it
  // visits — limiting the visited rows first avoids scanning all games).
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND INDEX_NAME = 'idx_games_correspondence_status'
       LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query('CREATE INDEX idx_games_correspondence_status ON games (is_correspondence, status)');
      console.log('✓ Created index idx_games_correspondence_status on games');
    }
  } catch (err) {
    console.error('Error creating idx_games_correspondence_status:', err.message);
  }

  // Add composite indexes for the anonymous-game cleanup jobs:
  //   DELETE FROM games WHERE is_anonymous = 1 AND created_at < NOW() - INTERVAL 30 DAY
  //   UPDATE games SET status='completed' WHERE is_anonymous=1 AND status IN (...)
  // Without an index MySQL full-scans the games table (~681MB of fat blob rows
  // that don't fit the 128MB buffer pool), which showed up as 1-7s
  // [slow-query] DELETE/UPDATE entries in the pm2 logs.
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND INDEX_NAME = 'idx_games_anon_created'
       LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query('CREATE INDEX idx_games_anon_created ON games (is_anonymous, created_at)');
      console.log('✓ Created index idx_games_anon_created on games');
    }
  } catch (err) {
    console.error('Error creating idx_games_anon_created:', err.message);
  }
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND INDEX_NAME = 'idx_games_anon_status'
       LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query('CREATE INDEX idx_games_anon_status ON games (is_anonymous, status)');
      console.log('✓ Created index idx_games_anon_status on games');
    }
  } catch (err) {
    console.error('Error creating idx_games_anon_status:', err.message);
  }

  // ── Option A: split move history out of the fat games.other_data blob ──────
  // games.other_data stores the full move history (`moves`) + initialPieces per
  // game, bloating every row to 100s of KB and making the table far larger than
  // the DB buffer pool (root cause of the slow lobby / match-history queries).
  // game_moves holds that heavy data keyed by game_id so the hot `games` rows
  // stay thin; move_count is denormalized onto games so the lobby can show a
  // move count without reading the blob.
  //
  // NOTE: this migration only creates the schema. The write-path (persist to
  // game_moves + move_count) and read-path (load moves from game_moves) wiring,
  // plus the one-time backfill from existing other_data, are separate staged
  // steps — until those land, these stay empty/0 and nothing reads them.
  try {
    if (!(await tableExists('game_moves'))) {
      // No FK to games(id): avoids integer type-compat coupling; orphan rows are harmless (never read for a nonexistent game).
      await runMigration(
        `CREATE TABLE game_moves (
           game_id INT UNSIGNED NOT NULL PRIMARY KEY,
           moves_json LONGTEXT,
           initial_pieces_json LONGTEXT,
           updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
         )`,
        'Create game_moves table (Option A: move-history storage)'
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating game_moves table:', err.message);
  }
  try {
    if (!(await columnExists('games', 'move_count'))) {
      await runMigration(
        `ALTER TABLE games ADD COLUMN move_count INT NOT NULL DEFAULT 0 COMMENT 'Denormalized move count (Option A: lobby avoids reading other_data.moves)'`,
        'Add move_count column to games'
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding move_count column to games:', err.message);
  }

  // Add has_game_log column to ai_training_jobs so REMOTE_MODE servers can
  // determine whether a job's games.txt exists (without checking the remote
  // filesystem) and enable the Board Replay button accordingly.
  try {
    if (await tableExists('ai_training_jobs')) {
      if (!(await columnExists('ai_training_jobs', 'has_game_log'))) {
        await runMigration(
          `ALTER TABLE ai_training_jobs
           ADD COLUMN has_game_log TINYINT(1) NOT NULL DEFAULT 0
             COMMENT '1 if a games.txt game log was written for this job'`,
          'Add has_game_log column to ai_training_jobs'
        );
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error adding has_game_log column to ai_training_jobs:', err.message);
  }

  // Add is_restricted / restriction_reason columns to game_types for admin moderation.
  try {
    if (!(await columnExists('game_types', 'is_restricted'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN is_restricted TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = restricted by admin; only creator can play against computer'`,
        'Add is_restricted column to game_types'
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding is_restricted column to game_types:', err.message);
  }
  try {
    if (!(await columnExists('game_types', 'restriction_reason'))) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN restriction_reason VARCHAR(500) DEFAULT NULL COMMENT 'Human-readable reason shown to players when game is restricted'`,
        'Add restriction_reason column to game_types'
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding restriction_reason column to game_types:', err.message);
  }

  // Add file_size_bytes column to ai_training_jobs so uploaded-artifact
  // sizes can be tracked and per-game per-user upload caps enforced.
  try {
    if (await tableExists('ai_training_jobs')) {
      if (!(await columnExists('ai_training_jobs', 'file_size_bytes'))) {
        await runMigration(
          `ALTER TABLE ai_training_jobs
           ADD COLUMN file_size_bytes BIGINT NULL DEFAULT NULL
             COMMENT 'Raw byte size of the uploaded file (NULL for cloud-trained jobs)'`,
          'Add file_size_bytes column to ai_training_jobs'
        );
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error adding file_size_bytes column to ai_training_jobs:', err.message);
  }
  // Rename max_piece_captures_per_move → capture_actions_per_turn (semantics changed to
  // "extra capture-only actions per turn" rather than a per-single-move cap).
  try {
    const hasOld = await columnExists('pieces', 'max_piece_captures_per_move');
    const hasNew = await columnExists('pieces', 'capture_actions_per_turn');
    if (hasOld && !hasNew) {
      await runMigration(
        `ALTER TABLE pieces CHANGE COLUMN max_piece_captures_per_move capture_actions_per_turn INT DEFAULT NULL`,
        'Rename pieces.max_piece_captures_per_move → capture_actions_per_turn'
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error renaming max_piece_captures_per_move:', err.message);
  }

  // Rename max_piece_captures_per_ranged_attack → ranged_capture_actions_per_turn
  try {
    const hasOld = await columnExists('pieces', 'max_piece_captures_per_ranged_attack');
    const hasNew = await columnExists('pieces', 'ranged_capture_actions_per_turn');
    if (hasOld && !hasNew) {
      await runMigration(
        `ALTER TABLE pieces CHANGE COLUMN max_piece_captures_per_ranged_attack ranged_capture_actions_per_turn INT DEFAULT NULL`,
        'Rename pieces.max_piece_captures_per_ranged_attack → ranged_capture_actions_per_turn'
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error renaming max_piece_captures_per_ranged_attack:', err.message);
  }

  // Clean up corrupted available_for_moves values from the legacy piece_movement table.
  // The old piece_movement table had: available_for_moves TINYINT(1) DEFAULT 1
  // (a boolean meaning "yes this movement type is available for regular moves").
  // When tables were consolidated, that boolean 1 was copied into the new
  // pieces.available_for_moves INT UNSIGNED NULL column, which in the new
  // schema means "restrict this piece to the first N game-turns."
  // The piece wizard never sets this field, so any non-null value is a data
  // artifact from the migration. NULL it out so old pieces like rooks are not
  // incorrectly restricted once the feature is implemented in game-socket.js.
  try {
    const [affected] = await db_pool.query(
      `UPDATE pieces SET available_for_moves = NULL WHERE available_for_moves IS NOT NULL`
    );
    if (affected.affectedRows > 0) {
      console.log(`[DB] Cleaned up available_for_moves: reset ${affected.affectedRows} pieces to NULL (legacy boolean artifact)`);
    }
  } catch (err) {
    console.error('Error cleaning up available_for_moves:', err.message);
  }

  // disable_promotion: per-placement flag to prevent a promotable piece from
  // being able to promote on this specific placement.
  {
    const exists = await columnExists('game_type_pieces', 'disable_promotion');
    if (!exists) {
      await runMigration(
        `ALTER TABLE game_type_pieces ADD COLUMN disable_promotion TINYINT(1) DEFAULT 0`,
        'Add game_type_pieces.disable_promotion'
      );
      migrationsRun++;
    }
  }

  // hop_stop_at_occupied: when a ratio-moving piece repeats its L-jump, stop before
  // an occupied intermediate multiple. Default 0 = off (piece hops over intermediates).
  {
    const exists = await columnExists('pieces', 'hop_stop_at_occupied');
    if (!exists) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN hop_stop_at_occupied TINYINT(1) DEFAULT 0`,
        'Add pieces.hop_stop_at_occupied'
      );
      migrationsRun++;
    }
  }

  // Physical board requests table (ad-hoc, outside the tableMigrations loop)
  await ensurePhysicalBoardRequestsTable();

  // ── Direct message image attachments ────────────────────────────────────
  // Stores metadata for image files sent in DMs.  Files are stored under
  // uploads/dm-images/ and auto-deleted 24 hours after upload.
  // user1_id / user2_id are the sorted pair of participant IDs so we can
  // quickly count and retrieve images for a given conversation.
  try {
    const dmImgExists = await tableExists('direct_message_images');
    if (!dmImgExists) {
      await db_pool.query(`
        CREATE TABLE direct_message_images (
          id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          sender_id   INT UNSIGNED NOT NULL,
          user1_id    INT UNSIGNED NOT NULL,
          user2_id    INT UNSIGNED NOT NULL,
          filename    VARCHAR(255) NOT NULL,
          created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at  DATETIME NOT NULL,
          INDEX idx_dmi_conv    (user1_id, user2_id),
          INDEX idx_dmi_expires (expires_at),
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[DB] Created table direct_message_images');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating direct_message_images table:', err.message);
  }

  // ── Performance indexes for forum queries ────────────────────────────────
  // The GET /api/forums endpoint runs two aggregate subqueries (comment counts
  // and like counts) plus a correlated per-row subquery for liked_by_user.
  // These indexes make those sub-queries index-only scans instead of full scans.

  // Composite (article_id, user_id) on likes — speeds up the correlated
  // liked_by_user subquery: SELECT COUNT(*) FROM likes WHERE article_id = ? AND user_id = ?
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'likes'
           AND INDEX_NAME = 'idx_likes_article_user'
         LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query(`CREATE INDEX idx_likes_article_user ON likes (article_id, user_id)`);
      console.log('[DB] Created index idx_likes_article_user on likes(article_id, user_id)');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating idx_likes_article_user:', err.message);
  }

  // Composite (article_id, created_at) on comments — speeds up the MAX(created_at)
  // subquery used to find the last commenter for each forum post.
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'comments'
           AND INDEX_NAME = 'idx_comments_article_created'
         LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query(`CREATE INDEX idx_comments_article_created ON comments (article_id, created_at)`);
      console.log('[DB] Created index idx_comments_article_created on comments(article_id, created_at)');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating idx_comments_article_created:', err.message);
  }

  // Index on articles(created_at) — supports ORDER BY created_at sort option.
  try {
    const [idxRows] = await db_pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'articles'
           AND INDEX_NAME = 'idx_articles_created_at'
         LIMIT 1`
    );
    if (idxRows.length === 0) {
      await db_pool.query(`CREATE INDEX idx_articles_created_at ON articles (created_at)`);
      console.log('[DB] Created index idx_articles_created_at on articles(created_at)');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating idx_articles_created_at:', err.message);
  }

  // Add twitch_id column to users for Twitch OAuth login
  try {
    const twitchIdCol = await columnExists('users', 'twitch_id');
    if (!twitchIdCol) {
      await runMigration(
        `ALTER TABLE users ADD COLUMN twitch_id VARCHAR(50) DEFAULT NULL COMMENT 'Twitch numeric user ID for Twitch OAuth login'`,
        "Add twitch_id column to users table for Twitch OAuth login"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error adding twitch_id column:', err.message);
  }

  // Attack-hopping modifier columns — allow separate configuration of
  // exact/ratio-hop-only, directional-hop-disabled, and stop-at-occupied
  // for attack (Step 3) independently from movement (Step 2).
  {
    const exists = await columnExists('pieces', 'exact_ratio_hop_only_attack');
    if (!exists) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN exact_ratio_hop_only_attack TINYINT(1) DEFAULT 0 COMMENT 'When enabled, exact and ratio attacks only work when the piece is actually hopping over another piece'`,
        'Add pieces.exact_ratio_hop_only_attack'
      );
      migrationsRun++;
    }
  }

  {
    const exists = await columnExists('pieces', 'directional_hop_disabled_attack');
    if (!exists) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN directional_hop_disabled_attack TINYINT(1) DEFAULT 0 COMMENT 'When enabled, hopping is disabled for non-exact directional attacks'`,
        'Add pieces.directional_hop_disabled_attack'
      );
      migrationsRun++;
    }
  }

  {
    const exists = await columnExists('pieces', 'hop_stop_at_occupied_attack');
    if (!exists) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN hop_stop_at_occupied_attack TINYINT(1) DEFAULT 0 COMMENT 'When making repeating ratio attacks, stop if an earlier multiple square is occupied'`,
        'Add pieces.hop_stop_at_occupied_attack'
      );
      migrationsRun++;
    }
  }

  {
    const exists = await columnExists('pieces', 'directional_hop_only');
    if (!exists) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN directional_hop_only TINYINT(1) DEFAULT 0 COMMENT 'When enabled, directional movement requires hopping over a piece in the path'`,
        'Add pieces.directional_hop_only'
      );
      migrationsRun++;
    }
  }

  {
    const exists = await columnExists('pieces', 'directional_hop_only_attack');
    if (!exists) {
      await runMigration(
        `ALTER TABLE pieces ADD COLUMN directional_hop_only_attack TINYINT(1) DEFAULT 0 COMMENT 'When enabled, directional attacks require hopping over a piece in the path'`,
        'Add pieces.directional_hop_only_attack'
      );
      migrationsRun++;
    }
  }

  // Backfill: copy movement-hop flags to attack-hop equivalents for all pieces
  // that have movement hopping enabled but no explicit attack-hop settings.
  // This is idempotent — only updates rows where src=1 AND dst=0.
  {
    try {
      const hopPairs = [
        ['can_hop_over_allies',      'can_hop_attack_over_allies'],
        ['can_hop_over_enemies',     'can_hop_attack_over_enemies'],
        ['exact_ratio_hop_only',     'exact_ratio_hop_only_attack'],
        ['directional_hop_disabled', 'directional_hop_disabled_attack'],
        ['hop_stop_at_occupied',     'hop_stop_at_occupied_attack'],
        ['directional_hop_only',     'directional_hop_only_attack'],
      ];
      let totalUpdated = 0;
      console.log('[backfill] Checking hop-flags-to-attack backfill...');
      for (const [src, dst] of hopPairs) {
        const srcExists = await columnExists('pieces', src);
        const dstExists = await columnExists('pieces', dst);
        if (!srcExists || !dstExists) {
          console.log(`[backfill] SKIP ${src} -> ${dst} (column missing)`);
          continue;
        }
        const [result] = await db_pool.query(
          `UPDATE pieces SET \`${dst}\` = 1 WHERE \`${src}\` = 1 AND (\`${dst}\` IS NULL OR \`${dst}\` = 0)`
        );
        if (result.affectedRows > 0) {
          console.log(`[backfill] ${src} -> ${dst}: updated ${result.affectedRows} piece(s)`);
          totalUpdated += result.affectedRows;
        }
      }
      if (totalUpdated === 0) {
        console.log('[backfill] hop-flags-to-attack: all pieces already up to date');
      } else {
        console.log(`[backfill] hop-flags-to-attack: backfilled ${totalUpdated} total piece row(s)`);
      }
    } catch (backfillErr) {
      console.error('[backfill] hop-flags-to-attack failed:', backfillErr.message);
    }
  }

  {
    const exists = await columnExists('game_types', 'start_repositions');
    if (!exists) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN start_repositions INT DEFAULT 0 COMMENT 'Number of pre-game repositions each player gets (0 = disabled, max 8)'`,
        'Add game_types.start_repositions'
      );
      migrationsRun++;
    }
  }

  {
    const exists = await columnExists('game_types', 'reposition_key_pieces_only');
    if (!exists) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN reposition_key_pieces_only TINYINT(1) DEFAULT 0 COMMENT 'When true, only ends_game_on_capture / ends_game_on_checkmate pieces may be repositioned'`,
        'Add game_types.reposition_key_pieces_only'
      );
      migrationsRun++;
    }
  }

  // ── Feature TODO list ────────────────────────────────────────────────────
  {
    const exists = await columnExists('game_types', 'fog_of_war');
    if (!exists) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN fog_of_war TINYINT(1) DEFAULT 0 COMMENT 'If true, squares not reachable by any of a player''s pieces are hidden (fog of war)'`,
        'Add game_types.fog_of_war'
      );
      migrationsRun++;
    }
  }
  {
    const exists = await columnExists('game_types', 'permanent_fog_reveal');
    if (!exists) {
      await runMigration(
        `ALTER TABLE game_types ADD COLUMN permanent_fog_reveal TINYINT(1) DEFAULT 0 COMMENT 'If true (and fog_of_war is on), squares a player reveals stay visible for the rest of the game'`,
        'Add game_types.permanent_fog_reveal'
      );
      migrationsRun++;
    }
  }

  // Internal admin tool to track potential features (unstarted -> in_progress
  // -> completed | abandoned).
  try {
    const featureTodoExists = await tableExists('feature_todo_items');
    if (!featureTodoExists) {
      await db_pool.query(`
        CREATE TABLE feature_todo_items (
          id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title       VARCHAR(255) NOT NULL,
          description TEXT NULL,
          status      ENUM('unstarted', 'in_progress', 'completed', 'abandoned') NOT NULL DEFAULT 'unstarted',
          created_by  INT UNSIGNED NULL,
          sort_order  INT NOT NULL DEFAULT 0,
          created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_fti_status (status),
          INDEX idx_fti_sort   (sort_order),
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[DB] Created table feature_todo_items');
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating feature_todo_items table:', err.message);
  }
};

module.exports = { runMigrations };
