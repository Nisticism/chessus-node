/**
 * backfill-game-moves.js — Option A, Phase 4 (one-time data migration).
 *
 * Copies move history + initial board out of the fat `games.other_data` JSON
 * blob into the `game_moves` table (keyed by game_id) and sets `games.move_count`.
 * This is what populates game_moves for all EXISTING games so the read paths
 * (Phase 3) can be switched over safely.
 *
 * SAFE by design:
 *   - Idempotent upsert — re-running is fine.
 *   - Does NOT modify `games.other_data` (moves stay there until Phase 5 strip),
 *     so it can't lose data or affect the live app.
 *   - Batched by id to bound memory/IO (important on the small RDS instance —
 *     other_data rows can be multiple MB each).
 *   - Per-row error handling: a bad/oversized row is logged and skipped, never
 *     aborts the run.
 *   - Skips rows whose other_data has no `moves` key (already stripped/migrated),
 *     so an accidental re-run AFTER Phase 5 can't clobber game_moves with blanks.
 *
 * Usage (on the server, or locally against a test DB):
 *   node -r dotenv/config scripts/backfill-game-moves.js               # DRY RUN
 *   node -r dotenv/config scripts/backfill-game-moves.js --apply       # write
 *   node -r dotenv/config scripts/backfill-game-moves.js --apply --batch=100
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) {}

const db = require('../configs/db');

const APPLY = process.argv.includes('--apply');
const batchArg = process.argv.find(a => a.startsWith('--batch='));
const BATCH = Math.max(1, parseInt(batchArg ? batchArg.split('=')[1] : '50', 10) || 50);

async function tableExists(name) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`, [name]
  );
  return rows[0].c > 0;
}

async function main() {
  console.log('======================================================');
  console.log('  Option A backfill: games.other_data -> game_moves');
  console.log('  Mode:  ' + (APPLY ? 'APPLYING CHANGES' : 'DRY RUN (pass --apply to write)'));
  console.log('  Batch: ' + BATCH);
  console.log('======================================================');

  if (!(await tableExists('game_moves'))) {
    console.error('[ERR] game_moves table does not exist yet. Run the app once so migrations create it, then retry.');
    await db.end();
    process.exit(1);
  }

  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM games');
  console.log(`Total games: ${total}`);

  let lastId = 0;
  let scanned = 0;
  let migrated = 0;
  let skippedNoMoves = 0;
  let skippedParse = 0;
  let errors = 0;

  // Cursor by id so we never load the whole table at once.
  for (;;) {
    const [rows] = await db.query(
      'SELECT id, other_data FROM games WHERE id > ? ORDER BY id ASC LIMIT ?',
      [lastId, BATCH]
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      lastId = row.id;
      if (!row.other_data) { skippedNoMoves++; continue; }

      let od;
      try {
        od = JSON.parse(row.other_data);
      } catch (e) {
        skippedParse++;
        console.warn(`[WARN] game ${row.id}: other_data JSON parse failed - skipped (${e.message})`);
        continue;
      }

      // No `moves` key => already stripped (post Phase 5) or never had any.
      // Guard so a re-run can't overwrite good game_moves data with blanks.
      if (!Object.prototype.hasOwnProperty.call(od, 'moves')) { skippedNoMoves++; continue; }

      const moves = Array.isArray(od.moves) ? od.moves : [];
      const initialPieces = od.initialPieces || null;
      const moveCount = moves.length;

      if (APPLY) {
        try {
          await db.query(
            `INSERT INTO game_moves (game_id, moves_json, initial_pieces_json)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
               moves_json = VALUES(moves_json),
               initial_pieces_json = COALESCE(VALUES(initial_pieces_json), initial_pieces_json)`,
            [row.id, JSON.stringify(moves), initialPieces ? JSON.stringify(initialPieces) : null]
          );
          await db.query('UPDATE games SET move_count = ? WHERE id = ?', [moveCount, row.id]);
          migrated++;
        } catch (e) {
          errors++;
          console.error(`[ERR] game ${row.id}: write failed - ${e.message}`);
        }
      } else {
        migrated++; // would-migrate count in dry run
      }
    }

    console.log(`  ...scanned ${scanned}/${total} (lastId=${lastId})`);
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Scanned:            ${scanned}`);
  console.log(`  ${APPLY ? 'Migrated' : 'Would migrate'}:       ${migrated}`);
  console.log(`  Skipped (no moves): ${skippedNoMoves}`);
  console.log(`  Skipped (parse):    ${skippedParse}`);
  console.log(`  Errors:             ${errors}`);
  console.log(APPLY ? 'DONE.' : 'DRY RUN complete - re-run with --apply to write.');

  await db.end();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
