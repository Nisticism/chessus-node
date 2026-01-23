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
  
  if (migrationsRun === 0) {
    console.log('✓ All migrations up to date\n');
  } else {
    console.log(`\n✓ Applied ${migrationsRun} migration(s)\n`);
  }
};

module.exports = { runMigrations };
