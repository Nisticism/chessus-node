#!/usr/bin/env node

/**
 * Script to create a test rook piece in the database
 * Usage: node scripts/create-test-rook.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Database configuration
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

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded image to ${filepath}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function createRook() {
  try {
    console.log('\n🏰 Creating test rook piece...\n');

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'pieces');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log(`✓ Created directory ${uploadsDir}`);
    }

    // Download a simple rook image from a public source
    const imageFilename = `test-rook-${Date.now()}.png`;
    const imagePath = path.join(uploadsDir, imageFilename);
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Chess_rlt45.svg/128px-Chess_rlt45.svg.png';
    
    console.log('📥 Downloading rook image...');
    await downloadImage(imageUrl, imagePath);

    const imageLocation = JSON.stringify([`/uploads/pieces/${imageFilename}`]);

    // Get a valid user ID or use NULL
    let creatorId = null;
    try {
      const [users] = await db_pool.query('SELECT id FROM users LIMIT 1');
      if (users.length > 0) {
        creatorId = users[0].id;
        console.log(`✓ Using creator_id: ${creatorId}`);
      } else {
        console.log('⚠ No users found, using NULL for creator_id');
      }
    } catch (err) {
      console.log('⚠ Could not query users, using NULL for creator_id');
    }

    // Insert into pieces table
    const pieceSql = `
      INSERT INTO pieces (
        piece_name, image_location, piece_width, piece_height, creator_id, piece_description
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const pieceValues = [
      'Test Rook',
      imageLocation,
      1,
      1,
      creatorId,
      'A standard rook piece that moves horizontally and vertically any number of squares'
    ];

    console.log('📝 Inserting piece into database...');
    const [pieceResult] = await db_pool.query(pieceSql, pieceValues);
    const pieceId = pieceResult.insertId;
    console.log(`✓ Created piece with ID: ${pieceId}`);

    // Insert into piece_movement table
    // Rook moves: unlimited up, down, left, right
    const movementSql = `
      INSERT INTO piece_movement (
        piece_id,
        directional_movement_style,
        repeating_movement,
        max_directional_movement_iterations,
        min_directional_movement_iterations,
        up_left_movement, up_movement, up_right_movement,
        right_movement, down_right_movement, down_movement, down_left_movement, left_movement,
        ratio_movement_style, ratio_one_movement, ratio_two_movement,
        repeating_ratio,
        max_ratio_iterations,
        min_ratio_iterations,
        step_by_step_movement_style, step_by_step_movement_value,
        can_hop_over_allies, can_hop_over_enemies,
        min_turns_per_move,
        max_turns_per_move,
        special_scenario_moves
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const movementValues = [
      pieceId,
      true,  // directional_movement_style
      false, // repeating_movement
      null,  // max_directional_movement_iterations (null = unlimited)
      null,  // min_directional_movement_iterations
      0,     // up_left_movement (no diagonal)
      99,    // up_movement (unlimited vertical)
      0,     // up_right_movement (no diagonal)
      99,    // right_movement (unlimited horizontal)
      0,     // down_right_movement (no diagonal)
      99,    // down_movement (unlimited vertical)
      0,     // down_left_movement (no diagonal)
      99,    // left_movement (unlimited horizontal)
      false, // ratio_movement_style (no L-shaped moves)
      null,  // ratio_one_movement
      null,  // ratio_two_movement
      false, // repeating_ratio
      null,  // max_ratio_iterations
      null,  // min_ratio_iterations
      false, // step_by_step_movement_style
      null,  // step_by_step_movement_value
      false, // can_hop_over_allies
      false, // can_hop_over_enemies
      null,  // min_turns_per_move
      null,  // max_turns_per_move
      null   // special_scenario_moves
    ];

    console.log('📝 Inserting movement data...');
    await db_pool.query(movementSql, movementValues);
    console.log('✓ Movement data inserted');

    // Insert into piece_capture table
    // Rook captures the same way it moves
    const captureSql = `
      INSERT INTO piece_capture (
        piece_id,
        can_capture_enemy_via_range,
        can_capture_ally_via_range,
        can_capture_enemy_on_move,
        can_capture_ally_on_range,
        can_attack_on_iteration,
        up_left_capture, up_capture, up_right_capture,
        right_capture, down_right_capture, down_capture, down_left_capture, left_capture,
        ratio_one_capture, ratio_two_capture, step_by_step_capture,
        up_left_attack_range, up_attack_range, up_right_attack_range,
        right_attack_range, down_right_attack_range, down_attack_range, down_left_attack_range, left_attack_range,
        repeating_directional_ranged_attack,
        max_directional_ranged_attack_iterations,
        min_directional_ranged_attack_iterations,
        ratio_one_attack_range, ratio_two_attack_range,
        repeating_ratio_ranged_attack,
        max_ratio_ranged_attack_iterations,
        min_ratio_ranged_attack_iterations,
        step_by_step_attack_style,
        step_by_step_attack_value,
        max_piece_captures_per_move,
        max_piece_captures_per_ranged_attack,
        special_scenario_captures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const captureValues = [
      pieceId,
      false, // can_capture_enemy_via_range
      false, // can_capture_ally_via_range
      true,  // can_capture_enemy_on_move
      false, // can_capture_ally_on_range
      false, // can_attack_on_iteration
      0,     // up_left_capture
      99,    // up_capture (matches movement)
      0,     // up_right_capture
      99,    // right_capture (matches movement)
      0,     // down_right_capture
      99,    // down_capture (matches movement)
      0,     // down_left_capture
      99,    // left_capture (matches movement)
      null,  // ratio_one_capture
      null,  // ratio_two_capture
      null,  // step_by_step_capture
      0,     // up_left_attack_range
      0,     // up_attack_range
      0,     // up_right_attack_range
      0,     // right_attack_range
      0,     // down_right_attack_range
      0,     // down_attack_range
      0,     // down_left_attack_range
      0,     // left_attack_range
      false, // repeating_directional_ranged_attack
      null,  // max_directional_ranged_attack_iterations
      null,  // min_directional_ranged_attack_iterations
      null,  // ratio_one_attack_range
      null,  // ratio_two_attack_range
      false, // repeating_ratio_ranged_attack
      null,  // max_ratio_ranged_attack_iterations
      null,  // min_ratio_ranged_attack_iterations
      false, // step_by_step_attack_style
      null,  // step_by_step_attack_value
      null,  // max_piece_captures_per_move
      null,  // max_piece_captures_per_ranged_attack
      null   // special_scenario_captures
    ];

    console.log('📝 Inserting capture data...');
    await db_pool.query(captureSql, captureValues);
    console.log('✓ Capture data inserted');

    console.log('\n✅ Test rook piece created successfully!');
    console.log(`   Piece ID: ${pieceId}`);
    console.log(`   Name: Test Rook`);
    console.log(`   Image: /uploads/pieces/${imageFilename}\n`);

    await db_pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error creating rook:', error.message);
    console.error(error);
    await db_pool.end();
    process.exit(1);
  }
}

createRook();
