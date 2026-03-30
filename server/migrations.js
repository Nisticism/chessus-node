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
    console.log(`âœ“ ${description}`);
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
  }
];

/**
 * Run all pending migrations
 */
const runMigrations = async () => {
  console.log('\nðŸ” Checking for pending migrations...\n');
  
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

  // Create welcome news article if no news articles exist
  try {
    const [newsCount] = await db_pool.query(
      "SELECT COUNT(*) as count FROM articles WHERE is_news = 1"
    );
    
    if (newsCount[0].count === 0) {
      // Get owner user ID (or admin as fallback)
      const [ownerUsers] = await db_pool.query(
        "SELECT id FROM users WHERE role = 'owner' LIMIT 1"
      );
      const [adminUsers] = await db_pool.query(
        "SELECT id FROM users WHERE role = 'admin' OR role = 'Admin' LIMIT 1"
      );
      
      const authorUser = ownerUsers.length > 0 ? ownerUsers[0] : (adminUsers.length > 0 ? adminUsers[0] : null);
      
      if (authorUser) {
        const adminId = authorUser.id;
        await runMigration(
          `INSERT INTO articles (
            title, 
            descript, 
            content, 
            created_at, 
            genre, 
            public, 
            is_news, 
            author_id, 
            game_type_id
          ) VALUES (
            'Welcome to GridGrove',
            'Announcing the launch of GridGrove, a revolutionary platform for creating and playing custom chess variants with unlimited possibilities.',
            'We are excited to announce the official launch of GridGrove, a groundbreaking platform that reimagines chess for the modern era.

What is GridGrove?

GridGrove is not just another chess platformâ€”it\\'s a complete chess variant creation and playing system that puts the power of game design in your hands. Whether you\\'re a chess enthusiast looking to explore new strategic possibilities or a game designer wanting to experiment with novel mechanics, GridGrove provides the tools you need.

Key Features:

Custom Piece Creation: Design pieces with unique movement patterns, capture mechanics, and special abilities. From traditional chess pieces to completely novel creations, the possibilities are endless.

Game Type Builder: Create entirely new chess variants with custom board sizes, piece arrangements, and win conditions. Want to play on a 10x10 board? Add new piece types? Create asymmetric starting positions? It\\'s all possible.

Live Multiplayer: Challenge friends or match with players from around the world. Our real-time game system supports time controls, premoves, and spectator mode.

Rated Games: Compete in rated matches and climb the ELO leaderboards. Track your performance across different game types and variants.

Community Forums: Share strategies, discuss game designs, and connect with other chess variant enthusiasts in our integrated forum system.

What\\'s New:

The platform now features a completely redesigned live game interface with support for complex piece mechanics including:
- Directional movement and capture patterns
- Hopping mechanics (for knight-like pieces)
- Custom win conditions
- Check and checkmate detection for royal pieces
- Premove functionality for faster-paced games
- Real-time game timers with increment support

Coming Soon:

We\\'re constantly improving GridGrove with new features on the horizon:
- Piece promotion mechanics
- En passant and castling support for traditional variants
- Tournament system
- Puzzle mode
- AI opponents
- Mobile app

Get Started:

Ready to explore the world of chess variants? Create your account, design your first custom piece, or jump into a game of traditional chess to get familiar with the platform. The GridGrove community is growing, and we can\\'t wait to see what amazing game variants you\\'ll create!

Join us in revolutionizing chess, one variant at a time.

â€” The GridGrove Team',
            NOW(),
            'Announcement',
            1,
            1,
            ${adminId},
            NULL
          )`,
          "Create welcome news article"
        );
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('Error creating welcome news article:', err.message);
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
      console.log('âœ“ Added first_move_only column to piece_movement table');
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
      console.log('âœ“ Added first_move_only_capture column to piece_capture table');
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
        console.log(`âœ“ Added ${colName} column to piece_movement table`);
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
        console.log(`âœ“ Added ${colName} column to piece_movement table`);
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
        console.log(`âœ“ Added ${colName} column to piece_capture table`);
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
        console.log(`âœ“ Added ${colName} column to piece_capture table`);
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
      console.log('âœ“ Added can_castle column to pieces table');
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

  // Create initial Software Developer job posting if no career posts exist
  try {
    const [careerCount] = await db_pool.query(
      "SELECT COUNT(*) as count FROM articles WHERE is_career = 1"
    );

    if (careerCount[0].count === 0) {
      // Get owner user ID (or admin as fallback) 
      const [ownerUsers] = await db_pool.query(
        "SELECT id FROM users WHERE role = 'owner' LIMIT 1"
      );
      const [adminUsers] = await db_pool.query(
        "SELECT id FROM users WHERE role = 'admin' OR role = 'Admin' LIMIT 1"
      );
      
      const authorUser = ownerUsers.length > 0 ? ownerUsers[0] : (adminUsers.length > 0 ? adminUsers[0] : null);
      
      if (authorUser) {
        await runMigration(
          `INSERT INTO articles (
            author_id, title, descript, content, created_at, public, is_career, genre
          ) VALUES (
            ${authorUser.id},
            'Software Developer - Full Stack',
            'Join our team building the future of strategic board games. Work with React, Node.js, and SQL to create an innovative chess variant platform.',
            '**Position: Software Developer - Full Stack**\\n\\n**Location:** Remote\\n\\n**About GridGrove**\\n\\nGridGrove is revolutionizing the world of strategic board games by creating a platform where players can design, share, and play custom chess variants with unlimited possibilities. We\\'re building more than just a chess platformâ€”we\\'re creating a complete game design ecosystem.\\n\\n**The Role**\\n\\nWe\\'re looking for a passionate full-stack developer to join our team and help shape the future of GridGrove. You\\'ll work on both frontend and backend features, implement complex game logic, and help build tools that empower game designers and players worldwide.\\n\\n**Required Skills & Technologies**\\n\\n- **Frontend:** React 18+, Redux, HTML5, CSS3/SCSS\\n- **Backend:** Node.js, Express\\n- **Database:** MySQL, SQL query optimization\\n- **Real-time:** Socket.io for live multiplayer functionality\\n- **Version Control:** Git\\n\\n**Nice to Have**\\n\\n- Experience with AI-assisted coding tools (GitHub Copilot, ChatGPT, Claude, etc.)\\n- Passion for chess, board games, or strategic games\\n- Experience with game development or complex state management\\n- Understanding of ELO rating systems\\n- Payment integration experience (Stripe, PayPal)\\n- Analytics implementation (Google Analytics)\\n\\n**What You\\'ll Work On**\\n\\n- Implementing new game mechanics and piece abilities\\n- Building intuitive game creation and editing tools\\n- Developing real-time multiplayer features\\n- Optimizing game state management and performance\\n- Creating responsive, accessible UI components\\n- Writing clean, maintainable, well-documented code\\n\\n**What We Offer**\\n\\n- Fully remote work\\n- Flexible hours\\n- Work on innovative, challenging problems\\n- Opportunity to shape the product direction\\n- Collaborative, learning-focused environment\\n- Competitive compensation\\n\\n**About You**\\n\\nYou\\'re a developer who loves solving complex problems and building elegant solutions. You enjoy working with modern web technologies and aren\\'t afraid to dive into challenging codebases. You appreciate clean code, good architecture, and understand the balance between perfection and shipping features.\\n\\nMost importantly, you\\'re excited about creating tools that empower creativity and bring people together through strategic games.\\n\\n**How to Apply**\\n\\nSend your resume, portfolio, and a brief note about why you\\'re interested in GridGrove to **fosterhans@gmail.com**\\n\\nPlease include:\\n- Your GitHub profile or code samples\\n- Any relevant projects you\\'ve built\\n- What excites you most about this role\\n\\nWe look forward to hearing from you!',
            NOW(),
            1,
            1,
            'Careers'
          )`,
          "Create initial Software Developer job posting"
        );
        migrationsRun++;
      } else {
        console.log('â„¹ No owner or admin user found - skipping job posting creation');
      }
    }
  } catch (err) {
    console.error('Error creating initial job posting:', err.message);
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
      console.log(`âœ“ Set Nisticism (ID: ${nisticismUser[0].id}) as owner`);
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
          console.log(`âœ“ Migrated ${totalPiecesInserted} pieces from ${gameTypes.length} game types`);
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
        console.log(`âœ“ Populated special_scenario_moves for ${result.affectedRows} pawns`);
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
        console.log(`âœ“ Added ${colName} column to pieces table`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('âŒ Error adding missing piece columns:', err.message);
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
        console.log(`âœ“ Added ${colName} column to pieces table`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('âŒ Error adding attack_range exact columns:', err.message);
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
        console.log(`âœ“ Added ${colName} column to pieces table`);
        migrationsRun++;
      }
    }
  } catch (err) {
    console.error('âŒ Error adding attack_range available_for columns:', err.message);
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
        ['max_piece_captures_per_move', 'INT DEFAULT NULL'],
        ['max_piece_captures_per_ranged_attack', 'INT DEFAULT NULL'],
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
          console.log(`  âœ“ Copied ${setClauses.length} columns from piece_movement`);
        }
      } else {
        console.log('  â„¹ piece_movement table not found, skipping data copy');
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
          console.log(`  âœ“ Copied ${setClauses.length} columns from piece_capture`);
        }
      } else {
        console.log('  â„¹ piece_capture table not found, skipping data copy');
      }
      
      console.log('âœ“ Consolidated piece tables into single pieces table');
      migrationsRun++;
    }
  } catch (err) {
    console.error('âŒ Error consolidating piece tables:', err.message);
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

  if (migrationsRun === 0) {
    console.log('âœ“ All migrations up to date\n');
  } else {
    console.log(`\nâœ“ Applied ${migrationsRun} migration(s)\n`);
  }
};

module.exports = { runMigrations };