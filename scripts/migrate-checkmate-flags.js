/**
 * Migration script to populate ends_game_on_checkmate and ends_game_on_capture 
 * columns in game_type_pieces junction table from pieces_string data
 * 
 * Run with: node scripts/migrate-checkmate-flags.js
 */

const db = require('../configs/db');

async function migrateCheckmateFlags() {
  console.log('Starting migration of checkmate/capture flags to junction table...');
  
  try {
    // Get all game types with pieces_string
    const [gameTypes] = await db.query(
      'SELECT id, game_name, pieces_string FROM game_types WHERE pieces_string IS NOT NULL'
    );
    
    console.log(`Found ${gameTypes.length} game types with pieces_string`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const gameType of gameTypes) {
      if (!gameType.pieces_string) {
        skippedCount++;
        continue;
      }
      
      let piecesData;
      try {
        piecesData = JSON.parse(gameType.pieces_string);
      } catch (e) {
        console.error(`Failed to parse pieces_string for game type ${gameType.id} (${gameType.game_name}):`, e.message);
        skippedCount++;
        continue;
      }
      
      // pieces_string format: {"row,col": {piece_id, player_number, ends_game_on_checkmate, ...}}
      for (const [key, pieceData] of Object.entries(piecesData)) {
        const [row, col] = key.split(',').map(Number);
        
        const endsGameOnCheckmate = pieceData.ends_game_on_checkmate ? 1 : 0;
        const endsGameOnCapture = pieceData.ends_game_on_capture ? 1 : 0;
        
        // Only update if either flag is true
        if (endsGameOnCheckmate || endsGameOnCapture) {
          try {
            const [result] = await db.query(
              `UPDATE game_type_pieces 
               SET ends_game_on_checkmate = ?, ends_game_on_capture = ?
               WHERE game_type_id = ? AND x = ? AND y = ?`,
              [endsGameOnCheckmate, endsGameOnCapture, gameType.id, col, row]
            );
            
            if (result.affectedRows > 0) {
              console.log(`  Updated piece at (${col}, ${row}) in game type ${gameType.id} (${gameType.game_name}): checkmate=${endsGameOnCheckmate}, capture=${endsGameOnCapture}`);
              updatedCount++;
            }
          } catch (e) {
            console.error(`  Failed to update piece at (${col}, ${row}) in game type ${gameType.id}:`, e.message);
          }
        }
      }
    }
    
    console.log(`\nMigration complete!`);
    console.log(`  Updated: ${updatedCount} piece placements`);
    console.log(`  Skipped: ${skippedCount} game types (no pieces_string or parse error)`);
    
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrateCheckmateFlags();
