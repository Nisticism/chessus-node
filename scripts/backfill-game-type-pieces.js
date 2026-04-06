const db_pool = require("../configs/db");

/**
 * Backfill game_type_pieces junction table from games.pieces JSON data.
 * Only backfills game types that have ZERO entries in the junction table,
 * meaning they were created before the junction table existed.
 * Game types that already have entries are left untouched (they may have
 * had pieces deliberately removed by the user).
 */
const backfillGameTypePieces = async () => {
  console.log('\n🔗 Checking game_type_pieces backfill...\n');

  try {
    // Find game types that have NO entries in the junction table at all
    const [gameTypesWithPieces] = await db_pool.query(
      'SELECT DISTINCT game_type_id FROM game_type_pieces'
    );
    const populatedGameTypes = new Set(gameTypesWithPieces.map(e => e.game_type_id));

    // Get all games with their pieces JSON and game_type_id
    const [games] = await db_pool.query(
      'SELECT id, game_type_id, pieces FROM games WHERE pieces IS NOT NULL AND game_type_id IS NOT NULL'
    );

    let backfilled = 0;

    for (const game of games) {
      if (!game.pieces || !game.game_type_id) continue;

      // Skip game types that already have junction entries — they've been set up
      if (populatedGameTypes.has(game.game_type_id)) continue;

      let piecesData;
      try {
        piecesData = typeof game.pieces === 'string' ? JSON.parse(game.pieces) : game.pieces;
      } catch (e) {
        continue;
      }

      if (!Array.isArray(piecesData)) continue;

      // Extract unique piece IDs from this game
      const seenPieceIds = new Set();
      for (const piece of piecesData) {
        if (piece.piece_id && !seenPieceIds.has(piece.piece_id)) {
          seenPieceIds.add(piece.piece_id);
          try {
            const pieceData = piecesData.find(p => p.piece_id === piece.piece_id);
            await db_pool.query(
              `INSERT IGNORE INTO game_type_pieces (game_type_id, piece_id, x, y, player_number) 
               VALUES (?, ?, ?, ?, ?)`,
              [
                game.game_type_id,
                piece.piece_id,
                pieceData?.x ?? 0,
                pieceData?.y ?? 0,
                pieceData?.player_id ?? 1
              ]
            );
            backfilled++;
          } catch (err) {
            // Skip duplicates or FK constraint failures silently
          }
        }
      }

      // Mark this game type as populated so we don't process it again
      populatedGameTypes.add(game.game_type_id);
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
