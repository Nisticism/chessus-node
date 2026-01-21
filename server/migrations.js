const db_pool = require("../configs/db");

/**
 * Check if a column exists in a table
 */
const columnExists = async (tableName, columnName) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT COUNT(*) as count 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = ?
    `;
    db_pool.query(sql, [process.env.DB_NAME || 'chessusnode', tableName, columnName], (err, results) => {
      if (err) reject(err);
      else resolve(results[0].count > 0);
    });
  });
};

/**
 * Run a migration SQL statement
 */
const runMigration = async (sql, description) => {
  return new Promise((resolve, reject) => {
    db_pool.query(sql, (err, result) => {
      if (err) {
        console.error(`Migration failed: ${description}`, err.message);
        reject(err);
      } else {
        console.log(`✓ ${description}`);
        resolve(result);
      }
    });
  });
};

/**
 * Define all migrations here
 */
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
  }
];

/**
 * Run all pending migrations
 */
const runMigrations = async () => {
  console.log('\n🔍 Checking for pending migrations...\n');
  
  let migrationsRun = 0;
  
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
