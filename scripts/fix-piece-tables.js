#!/usr/bin/env node

/**
 * Script to fix piece_movement and piece_capture table structures
 * Usage: node scripts/fix-piece-tables.js
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

async function columnExists(tableName, columnName) {
  const sql = `
    SELECT COUNT(*) as count 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = ? 
    AND COLUMN_NAME = ?
  `;
  const [results] = await db_pool.query(sql, [process.env.DB_NAME || 'chessusnode', tableName, columnName]);
  return results[0].count > 0;
}

async function addColumnIfNotExists(tableName, columnName, columnDef) {
  const exists = await columnExists(tableName, columnName);
  if (!exists) {
    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`;
    await db_pool.query(sql);
    console.log(`✓ Added ${tableName}.${columnName}`);
    return true;
  }
  return false;
}

async function fixPieceTables() {
  try {
    console.log('\n🔧 Fixing piece table structures...\n');

    let changes = 0;

    // piece_capture columns
    const captureColumns = [
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
      ['special_scenario_captures', 'VARCHAR(1000) DEFAULT NULL']
    ];

    console.log('Checking piece_capture table...');
    for (const [columnName, columnDef] of captureColumns) {
      if (await addColumnIfNotExists('piece_capture', columnName, columnDef)) {
        changes++;
      }
    }

    // piece_movement columns
    const movementColumns = [
      ['up_left_movement', 'INT DEFAULT 0'],
      ['up_movement', 'INT DEFAULT 0'],
      ['up_right_movement', 'INT DEFAULT 0'],
      ['right_movement', 'INT DEFAULT 0'],
      ['down_right_movement', 'INT DEFAULT 0'],
      ['down_movement', 'INT DEFAULT 0'],
      ['down_left_movement', 'INT DEFAULT 0'],
      ['left_movement', 'INT DEFAULT 0'],
      ['ratio_one_movement', 'INT DEFAULT NULL'],
      ['ratio_two_movement', 'INT DEFAULT NULL'],
      ['step_by_step_movement_value', 'INT DEFAULT NULL'],
      ['max_directional_movement_iterations', 'INT DEFAULT NULL'],
      ['min_directional_movement_iterations', 'INT DEFAULT NULL'],
      ['max_ratio_iterations', 'INT DEFAULT NULL'],
      ['min_ratio_iterations', 'INT DEFAULT NULL'],
      ['min_turns_per_move', 'INT DEFAULT NULL'],
      ['max_turns_per_move', 'INT DEFAULT NULL'],
      ['special_scenario_moves', 'VARCHAR(1000) DEFAULT NULL']
    ];

    console.log('\nChecking piece_movement table...');
    for (const [columnName, columnDef] of movementColumns) {
      if (await addColumnIfNotExists('piece_movement', columnName, columnDef)) {
        changes++;
      }
    }

    if (changes === 0) {
      console.log('\n✓ All columns already exist\n');
    } else {
      console.log(`\n✅ Added ${changes} missing column(s)\n`);
    }

    await db_pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error fixing tables:', error.message);
    console.error(error);
    await db_pool.end();
    process.exit(1);
  }
}

fixPieceTables();
