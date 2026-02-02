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
 * Run a migration SQL statement
 */
const runMigration = async (sql, description) => {
  try {
    await db_pool.query(sql);
    console.log(`✓ ${description}`);
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
  }
];

/**
 * Run all pending migrations
 */
const runMigrations = async () => {
  console.log('\n🔍 Checking for pending migrations...\n');
  
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
      // Get admin user ID
      const [adminUsers] = await db_pool.query(
        "SELECT id FROM users WHERE role = 'admin' OR role = 'Admin' LIMIT 1"
      );
      
      if (adminUsers.length > 0) {
        const adminId = adminUsers[0].id;
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
            'Welcome to SquareStrat',
            'Announcing the launch of SquareStrat, a revolutionary platform for creating and playing custom chess variants with unlimited possibilities.',
            'We are excited to announce the official launch of SquareStrat, a groundbreaking platform that reimagines chess for the modern era.

What is SquareStrat?

SquareStrat is not just another chess platform—it\\'s a complete chess variant creation and playing system that puts the power of game design in your hands. Whether you\\'re a chess enthusiast looking to explore new strategic possibilities or a game designer wanting to experiment with novel mechanics, SquareStrat provides the tools you need.

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

We\\'re constantly improving SquareStrat with new features on the horizon:
- Piece promotion mechanics
- En passant and castling support for traditional variants
- Tournament system
- Puzzle mode
- AI opponents
- Mobile app

Get Started:

Ready to explore the world of chess variants? Create your account, design your first custom piece, or jump into a game of traditional chess to get familiar with the platform. The SquareStrat community is growing, and we can\\'t wait to see what amazing game variants you\\'ll create!

Join us in revolutionizing chess, one variant at a time.

— The SquareStrat Team',
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
      await runMigration(
        `INSERT INTO articles (
          author_id, title, descript, content, created_at, public, is_career, genre
        ) VALUES (
          1,
          'Software Developer - Full Stack',
          'Join our team building the future of strategic board games. Work with React, Node.js, and SQL to create an innovative chess variant platform.',
          '**Position: Software Developer - Full Stack**\\n\\n**Location:** Remote\\n\\n**About SquareStrat**\\n\\nSquareStrat is revolutionizing the world of strategic board games by creating a platform where players can design, share, and play custom chess variants with unlimited possibilities. We\\'re building more than just a chess platform—we\\'re creating a complete game design ecosystem.\\n\\n**The Role**\\n\\nWe\\'re looking for a passionate full-stack developer to join our team and help shape the future of SquareStrat. You\\'ll work on both frontend and backend features, implement complex game logic, and help build tools that empower game designers and players worldwide.\\n\\n**Required Skills & Technologies**\\n\\n- **Frontend:** React 18+, Redux, HTML5, CSS3/SCSS\\n- **Backend:** Node.js, Express\\n- **Database:** MySQL, SQL query optimization\\n- **Real-time:** Socket.io for live multiplayer functionality\\n- **Version Control:** Git\\n\\n**Nice to Have**\\n\\n- Experience with AI-assisted coding tools (GitHub Copilot, ChatGPT, Claude, etc.)\\n- Passion for chess, board games, or strategic games\\n- Experience with game development or complex state management\\n- Understanding of ELO rating systems\\n- Payment integration experience (Stripe, PayPal)\\n- Analytics implementation (Google Analytics)\\n\\n**What You\\'ll Work On**\\n\\n- Implementing new game mechanics and piece abilities\\n- Building intuitive game creation and editing tools\\n- Developing real-time multiplayer features\\n- Optimizing game state management and performance\\n- Creating responsive, accessible UI components\\n- Writing clean, maintainable, well-documented code\\n\\n**What We Offer**\\n\\n- Fully remote work\\n- Flexible hours\\n- Work on innovative, challenging problems\\n- Opportunity to shape the product direction\\n- Collaborative, learning-focused environment\\n- Competitive compensation\\n\\n**About You**\\n\\nYou\\'re a developer who loves solving complex problems and building elegant solutions. You enjoy working with modern web technologies and aren\\'t afraid to dive into challenging codebases. You appreciate clean code, good architecture, and understand the balance between perfection and shipping features.\\n\\nMost importantly, you\\'re excited about creating tools that empower creativity and bring people together through strategic games.\\n\\n**How to Apply**\\n\\nSend your resume, portfolio, and a brief note about why you\\'re interested in SquareStrat to **fosterhans@gmail.com**\\n\\nPlease include:\\n- Your GitHub profile or code samples\\n- Any relevant projects you\\'ve built\\n- What excites you most about this role\\n\\nWe look forward to hearing from you!',
          NOW(),
          1,
          1,
          'Careers'
        )`,
        "Create initial Software Developer job posting"
      );
      migrationsRun++;
    }
  } catch (err) {
    console.error('Error creating initial job posting:', err.message);
  }
  
  if (migrationsRun === 0) {
    console.log('✓ All migrations up to date\n');
  } else {
    console.log(`\n✓ Applied ${migrationsRun} migration(s)\n`);
  }
};

module.exports = { runMigrations };
