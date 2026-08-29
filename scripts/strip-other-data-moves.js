/**
 * strip-other-data-moves.js — Option A, Phase 5 (one-time data migration).
 *
 * Removes the fat `moves` + `initialPieces` keys from `games.other_data` now
 * that the game_moves table is the authoritative store (Phase 3 reads from it,
 * Phase 4 backfilled it). This is what actually shrinks the `games` table so it
 * fits the RDS buffer pool and the disk-bound slow queries stop.
 *
 * SAFE by design — a row is only stripped when its move history is provably
 * already preserved in game_moves:
 *   - Requires a game_moves row whose stored move count is >= the count still
 *     in other_data.moves. If game_moves is missing or SHORTER, the row is left
 *     untouched and reported as UNSAFE (run the Phase 4 backfill for those ids
 *     first, then re-run this).
 *   - Rows with no `moves` key are already stripped => skipped (idempotent).
 *   - Rows whose other_data.moves is empty carry nothing to lose => safe to
 *     strip even without a game_moves row.
 *   - Uses JSON_REMOVE in-place; `initialPieces` is removed too (a no-op when
 *     absent). Only touches `moves`/`initialPieces` — all other keys are kept.
 *   - Batched by id; per-row error handling never aborts the run.
 *
 * Usage (on the server, or locally against a test DB):
 *   node -r dotenv/config scripts/strip-other-data-moves.js               # DRY RUN
 *   node -r dotenv/config scripts/strip-other-data-moves.js --apply       # write
 *   node -r dotenv/config scripts/strip-other-data-moves.js --apply --batch=100
 *
 * After a clean --apply run, reclaim the freed disk + defragment during low
 * traffic:  OPTIMIZE TABLE games;   (rebuilds the table, briefly locking it).
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
  console.log('  Option A Phase 5: strip moves/initialPieces from other_data');
  console.log('  Mode:  ' + (APPLY ? 'APPLYING CHANGES' : 'DRY RUN (pass --apply to write)'));
  console.log('  Batch: ' + BATCH);
  console.log('======================================================');

  if (!(await tableExists('game_moves'))) {
    console.error('[ERR] game_moves table does not exist. Run the Phase 4 backfill first.');
    await db.end();
    process.exit(1);
  }

  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM games');
  console.log(`Total games: ${total}`);

  let lastId = 0;
  let scanned = 0;
  let stripped = 0;
  let alreadyStripped = 0;
  let unsafe = 0;
  let errors = 0;
  const unsafeIds = [];

  for (;;) {
    // Reconcile in SQL so we never pull the multi-MB other_data blob into node:
    //   od_has_moves  - does other_data still carry a `moves` key
    //   od_len        - # moves still in other_data
    //   gm_len        - # moves preserved in game_moves (NULL if no row)
    const [rows] = await db.query(
      `SELECT g.id,
              JSON_CONTAINS_PATH(g.other_data, 'one', '$.moves') AS od_has_moves,
              JSON_LENGTH(JSON_EXTRACT(g.other_data, '$.moves'))  AS od_len,
              JSON_LENGTH(gm.moves_json)                          AS gm_len
         FROM games g
         LEFT JOIN game_moves gm ON gm.game_id = g.id
        WHERE g.id > ? ORDER BY g.id ASC LIMIT ?`,
      [lastId, BATCH]
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      lastId = row.id;

      // Already stripped (or never had moves) => nothing to do.
      if (!row.od_has_moves) { alreadyStripped++; continue; }

      const odLen = row.od_len == null ? 0 : Number(row.od_len);
      const gmLen = row.gm_len == null ? 0 : Number(row.gm_len);

      // Safe when there is nothing to lose, OR game_moves already holds at
      // least as many moves as other_data. Otherwise leave it and report.
      const safe = odLen === 0 || (row.gm_len != null && gmLen >= odLen);
      if (!safe) {
        unsafe++;
        if (unsafeIds.length < 100) unsafeIds.push(`${row.id}(od=${odLen},gm=${row.gm_len == null ? 'none' : gmLen})`);
        continue;
      }

      if (APPLY) {
        try {
          await db.query(
            "UPDATE games SET other_data = JSON_REMOVE(other_data, '$.moves', '$.initialPieces') WHERE id = ?",
            [row.id]
          );
          stripped++;
        } catch (e) {
          errors++;
          console.error(`[ERR] game ${row.id}: strip failed - ${e.message}`);
        }
      } else {
        stripped++; // would-strip count in dry run
      }
    }

    console.log(`  ...scanned ${scanned}/${total} (lastId=${lastId})`);
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Scanned:               ${scanned}`);
  console.log(`  ${APPLY ? 'Stripped' : 'Would strip'}:           ${stripped}`);
  console.log(`  Already stripped:      ${alreadyStripped}`);
  console.log(`  UNSAFE (skipped):      ${unsafe}`);
  console.log(`  Errors:                ${errors}`);
  if (unsafe > 0) {
    console.log('');
    console.log('  UNSAFE ids (other_data has more moves than game_moves).');
    console.log('  Run: node -r dotenv/config scripts/backfill-game-moves.js --apply');
    console.log('  then re-run this script. First 100:');
    console.log('    ' + unsafeIds.join(', '));
  }
  console.log(APPLY ? 'DONE.' : 'DRY RUN complete - re-run with --apply to write.');

  await db.end();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
