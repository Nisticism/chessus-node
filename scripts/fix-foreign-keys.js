#!/usr/bin/env node

/**
 * Script to fix foreign key constraints to include ON DELETE CASCADE
 * Usage: node scripts/fix-foreign-keys.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const db_pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'chessusnode',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function fixForeignKeys() {
  try {
    console.log('\n🔧 Fixing foreign key constraints...\n');

    // Drop old constraints
    console.log('Dropping old foreign key constraints...');
    
    try {
      await db_pool.query('ALTER TABLE piece_capture DROP FOREIGN KEY fk_piece_capture_piece_id');
      console.log('✓ Dropped piece_capture FK');
    } catch (err) {
      console.log('⚠ Could not drop piece_capture FK (may not exist)');
    }

    try {
      await db_pool.query('ALTER TABLE piece_movement DROP FOREIGN KEY fk_piece_movement_piece_id');
      console.log('✓ Dropped piece_movement FK');
    } catch (err) {
      console.log('⚠ Could not drop piece_movement FK (may not exist)');
    }

    // Add new constraints with CASCADE
    console.log('\nAdding new foreign key constraints with ON DELETE CASCADE...');
    
    await db_pool.query(`
      ALTER TABLE piece_capture 
      ADD CONSTRAINT fk_piece_capture_piece_id 
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    `);
    console.log('✓ Added piece_capture FK with CASCADE');

    await db_pool.query(`
      ALTER TABLE piece_movement 
      ADD CONSTRAINT fk_piece_movement_piece_id 
      FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE
    `);
    console.log('✓ Added piece_movement FK with CASCADE');

    console.log('\n✅ Foreign keys fixed successfully!\n');

    await db_pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error fixing foreign keys:', error.message);
    console.error(error);
    await db_pool.end();
    process.exit(1);
  }
}

fixForeignKeys();
