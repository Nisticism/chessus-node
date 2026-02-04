const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '',
  database: process.env.DB_NAME || 'chessusnode',
  multipleStatements: true
};

async function migratePiecesToJunction() {
  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to database');

    // Get all game types with pieces_string
    const [gameTypes] = await connection.query(
      'SELECT id, pieces_string FROM game_types WHERE pieces_string IS NOT NULL AND pieces_string != ""'
    );

    console.log(`Found ${gameTypes.length} game types with pieces`);

    let totalPiecesInserted = 0;
    let gamesProcessed = 0;
    let errors = 0;

    for (const gameType of gameTypes) {
      try {
        const piecesString = gameType.pieces_string;
        let piecesData;

        // Parse the pieces_string
        try {
          piecesData = JSON.parse(piecesString);
        } catch (parseError) {
          console.error(`Error parsing pieces_string for game_type ${gameType.id}:`, parseError.message);
          errors++;
          continue;
        }

        let piecesToInsert = [];

        // Handle both object format {"row,col": {...}} and array format [{x, y, ...}]
        if (Array.isArray(piecesData)) {
          // Array format
          piecesToInsert = piecesData.map(piece => ({
            game_type_id: gameType.id,
            piece_id: piece.piece_id,
            x: piece.x || 0,
            y: piece.y || 0,
            player_number: piece.player_number || piece.player || 1
          }));
        } else if (typeof piecesData === 'object') {
          // Object format {"row,col": {...}}
          piecesToInsert = Object.entries(piecesData).map(([key, piece]) => {
            const [row, col] = key.split(',').map(Number);
            return {
              game_type_id: gameType.id,
              piece_id: piece.piece_id,
              x: col || piece.x || 0,
              y: row || piece.y || 0,
              player_number: piece.player_number || piece.player || 1
            };
          });
        }

        // Filter out invalid pieces (missing piece_id)
        piecesToInsert = piecesToInsert.filter(p => p.piece_id);

        if (piecesToInsert.length === 0) {
          console.log(`No valid pieces found for game_type ${gameType.id}`);
          continue;
        }

        // Insert pieces into junction table
        for (const piece of piecesToInsert) {
          try {
            await connection.query(
              `INSERT INTO game_type_pieces (game_type_id, piece_id, x, y, player_number) 
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE piece_id = piece_id`,
              [piece.game_type_id, piece.piece_id, piece.x, piece.y, piece.player_number]
            );
            totalPiecesInserted++;
          } catch (insertError) {
            console.error(`Error inserting piece for game_type ${gameType.id}:`, insertError.message);
            errors++;
          }
        }

        gamesProcessed++;
        if (gamesProcessed % 10 === 0) {
          console.log(`Processed ${gamesProcessed}/${gameTypes.length} games...`);
        }
      } catch (gameError) {
        console.error(`Error processing game_type ${gameType.id}:`, gameError.message);
        errors++;
      }
    }

    console.log('\n=== Migration Complete ===');
    console.log(`Games processed: ${gamesProcessed}`);
    console.log(`Total pieces inserted: ${totalPiecesInserted}`);
    console.log(`Errors: ${errors}`);

    // Verify the migration
    const [junctionCount] = await connection.query(
      'SELECT COUNT(*) as count FROM game_type_pieces'
    );
    console.log(`Total rows in game_type_pieces: ${junctionCount[0].count}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

// Run the migration
migratePiecesToJunction()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
