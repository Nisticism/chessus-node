// Script to expand randomized_starting_positions column
// This fixes issues with games that have large starting position data (>1000 chars)

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function expandColumn() {
  let connection;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true
    });

    console.log('Connected successfully.');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', 'expand-randomized-starting-positions.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running migration to expand randomized_starting_positions column...');
    await connection.query(sql);
    
    console.log('✓ Migration completed successfully!');
    console.log('✓ The randomized_starting_positions column has been expanded from VARCHAR(1000) to TEXT');
    console.log('✓ Your existing games are preserved and can now be edited without errors');
    
    // Check for any games with large data
    const [games] = await connection.query(
      `SELECT id, LENGTH(randomized_starting_positions) as data_length 
       FROM games 
       WHERE randomized_starting_positions IS NOT NULL 
       ORDER BY data_length DESC 
       LIMIT 10`
    );
    
    if (games.length > 0) {
      console.log('\nGames with randomized starting positions (top 10):');
      games.forEach(game => {
        console.log(`  Game ID ${game.id}: ${game.data_length} characters`);
      });
    }
    
  } catch (error) {
    console.error('Error running migration:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run the migration
expandColumn();
