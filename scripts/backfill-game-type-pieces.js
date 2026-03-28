const db_pool = require("../configs/db");

/**
 * Backfill game_type_pieces junction table from games.pieces JSON data.
 * Scans all game types, and for pieces not yet linked in game_type_pieces,
 * checks the games table for any games of that type containing those pieces,
 * then creates the junction entries.
 */
const backfillGameTypePieces = async () => {
  console.log('\n🔗 Checking game_type_pieces backfill...\n');

  try {
    // Get all existing game_type_pieces entries for fast lookup
    const [existingEntries] = await db_pool.query(
      'SELECT DISTINCT game_type_id, piece_id FROM game_type_pieces'
    );
    const existingSet = new Set(
      existingEntries.map(e => `${e.game_type_id}_${e.piece_id}`)
    );

    // Get all games with their pieces JSON and game_type_id
    const [games] = await db_pool.query(
      'SELECT id, game_type_id, pieces FROM games WHERE pieces IS NOT NULL AND game_type_id IS NOT NULL'
    );

    let backfilled = 0;

    for (const game of games) {
      if (!game.pieces || !game.game_type_id) continue;

      let piecesData;
      try {
        piecesData = typeof game.pieces === 'string' ? JSON.parse(game.pieces) : game.pieces;
      } catch (e) {
        continue;
      }

      if (!Array.isArray(piecesData)) continue;

      // Extract unique piece IDs from this game
      const pieceIds = new Set();
      for (const piece of piecesData) {
        if (piece.piece_id) {
          pieceIds.add(piece.piece_id);
        }
      }

      for (const pieceId of pieceIds) {
        const key = `${game.game_type_id}_${pieceId}`;
        if (!existingSet.has(key)) {
          try {
            // Find the piece's position from the game data (use first occurrence)
            const pieceData = piecesData.find(p => p.piece_id === pieceId);
            await db_pool.query(
              `INSERT IGNORE INTO game_type_pieces (game_type_id, piece_id, x, y, player_number) 
               VALUES (?, ?, ?, ?, ?)`,
              [
                game.game_type_id,
                pieceId,
                pieceData?.x ?? 0,
                pieceData?.y ?? 0,
                pieceData?.player_id ?? 1
              ]
            );
            existingSet.add(key);
            backfilled++;
          } catch (err) {
            // Skip duplicates or FK constraint failures silently
          }
        }
      }
    }

    if (backfilled > 0) {
      console.log(`✔ Backfilled ${backfilled} game_type_pieces entries\n`);
    } else {
      console.log('✔ game_type_pieces already up to date\n');
    }
  } catch (err) {
    console.error('Error during game_type_pieces backfill:', err.message);
  }
};

module.exports = { backfillGameTypePieces };
