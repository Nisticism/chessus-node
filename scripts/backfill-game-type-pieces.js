const db_pool = require("../configs/db");

/**
 * Backfill game_type_pieces junction table from game_types.pieces_string.
 * Only backfills game types that have ZERO entries in the junction table
 * AND have non-empty pieces_string (meaning they were created before the
 * junction table existed and have actual starting pieces defined).
 *
 * IMPORTANT: The source of truth is ALWAYS game_types.pieces_string (the
 * designer-defined starting layout), never games.pieces (runtime gameplay
 * state). Reading from games.pieces would corrupt placement games by
 * treating mid-game or end-game piece positions as permanent starting pieces.
 */
const backfillGameTypePieces = async () => {
  console.log('[backfill] Checking game_type_pieces backfill...');

  try {
    // Find game type IDs that already have at least one junction row
    const [populatedRows] = await db_pool.query(
      'SELECT DISTINCT game_type_id FROM game_type_pieces'
    );
    const populatedGameTypes = new Set(populatedRows.map(e => e.game_type_id));

    // Find game types with actual starting pieces defined in pieces_string
    // that have NOT yet been migrated to the junction table.
    const [gameTypes] = await db_pool.query(
      `SELECT id, pieces_string FROM game_types
       WHERE pieces_string IS NOT NULL
         AND pieces_string != ''
         AND pieces_string != '{}'`
    );

    let backfilled = 0;

    for (const gameType of gameTypes) {
      // Skip game types already in the junction table
      if (populatedGameTypes.has(gameType.id)) continue;

      let piecesData;
      try {
        const parsed = JSON.parse(gameType.pieces_string);
        // pieces_string is stored as {"row,col": {...}} object format
        if (Array.isArray(parsed)) {
          piecesData = parsed;
        } else if (parsed && typeof parsed === 'object') {
          piecesData = Object.entries(parsed).map(([key, piece]) => {
            const [row, col] = key.split(',').map(Number);
            return { ...piece, x: col, y: row };
          });
        }
      } catch (e) {
        continue;
      }

      if (!Array.isArray(piecesData) || piecesData.length === 0) continue;

      for (const piece of piecesData) {
        // Skip multi-tile extension squares; only insert anchor squares
        if (!piece.piece_id || piece._occupied || piece._anchorKey) continue;
        try {
          await db_pool.query(
            `INSERT IGNORE INTO game_type_pieces (game_type_id, piece_id, x, y, player_number)
             VALUES (?, ?, ?, ?, ?)`,
            [
              gameType.id,
              piece.piece_id,
              piece.x ?? 0,
              piece.y ?? 0,
              Number(piece.player_id ?? piece.player_number ?? piece.player ?? 1)
            ]
          );
          backfilled++;
        } catch (err) {
          // Skip duplicates or FK constraint failures silently
        }
      }
    }

    if (backfilled > 0) {
      console.log(`[backfill] Backfilled ${backfilled} game_type_pieces entries`);
    } else {
      console.log('[backfill] game_type_pieces already up to date');
    }
  } catch (err) {
    console.error('[backfill] Error during game_type_pieces backfill:', err.message);
  }
};

module.exports = { backfillGameTypePieces };
