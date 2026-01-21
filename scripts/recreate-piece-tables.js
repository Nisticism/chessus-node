#!/usr/bin/env node

/**
 * Script to drop and recreate piece tables with correct structure
 * Usage: node scripts/recreate-piece-tables.js
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
  queueLimit: 0,
  multipleStatements: true
});

async function recreateTables() {
  try {
    console.log('\n🔄 Recreating piece tables with correct structure...\n');

    // Drop existing tables (cascade will handle foreign keys)
    console.log('Dropping old tables...');
    await db_pool.query('DROP TABLE IF EXISTS piece_capture');
    console.log('✓ Dropped piece_capture');
    
    await db_pool.query('DROP TABLE IF EXISTS piece_movement');
    console.log('✓ Dropped piece_movement');

    // Create piece_movement table
    console.log('\nCreating piece_movement table...');
    await db_pool.query(`
      CREATE TABLE piece_movement (
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
      )
    `);
    console.log('✓ Created piece_movement table');

    // Create piece_capture table
    console.log('\nCreating piece_capture table...');
    await db_pool.query(`
      CREATE TABLE piece_capture (
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
      )
    `);
    console.log('✓ Created piece_capture table');

    console.log('\n✅ Tables recreated successfully!\n');

    await db_pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error recreating tables:', error.message);
    console.error(error);
    await db_pool.end();
    process.exit(1);
  }
}

recreateTables();
