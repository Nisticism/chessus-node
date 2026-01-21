#!/usr/bin/env node

/**
 * Script to check piece table structures
 * Usage: node scripts/check-tables.js
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

async function checkTables() {
  try {
    console.log('\n📋 Checking database table structures...\n');

    // Check if tables exist
    const [tables] = await db_pool.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME IN ('pieces', 'piece_movement', 'piece_capture')
    `, [process.env.DB_NAME || 'chessusnode']);

    console.log('Existing tables:');
    tables.forEach(row => console.log(`  ✓ ${row.TABLE_NAME}`));
    console.log('');

    // Check piece_capture columns
    if (tables.some(t => t.TABLE_NAME === 'piece_capture')) {
      const [columns] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'piece_capture'
        ORDER BY ORDINAL_POSITION
      `, [process.env.DB_NAME || 'chessusnode']);

      console.log('piece_capture columns:');
      columns.forEach(row => console.log(`  - ${row.COLUMN_NAME}`));
      console.log('');
    } else {
      console.log('⚠ piece_capture table does not exist\n');
    }

    // Check piece_movement columns
    if (tables.some(t => t.TABLE_NAME === 'piece_movement')) {
      const [columns] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'piece_movement'
        ORDER BY ORDINAL_POSITION
      `, [process.env.DB_NAME || 'chessusnode']);

      console.log('piece_movement columns:');
      columns.forEach(row => console.log(`  - ${row.COLUMN_NAME}`));
      console.log('');
    } else {
      console.log('⚠ piece_movement table does not exist\n');
    }

    // Check pieces columns
    if (tables.some(t => t.TABLE_NAME === 'pieces')) {
      const [columns] = await db_pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'pieces'
        ORDER BY ORDINAL_POSITION
      `, [process.env.DB_NAME || 'chessusnode']);

      console.log('pieces columns:');
      columns.forEach(row => console.log(`  - ${row.COLUMN_NAME}`));
      console.log('');
    } else {
      console.log('⚠ pieces table does not exist\n');
    }

    await db_pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    await db_pool.end();
    process.exit(1);
  }
}

checkTables();
