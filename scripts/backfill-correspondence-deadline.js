/**
 * backfill-correspondence-deadline.js
 * One-time production script — migrates correspondence games from the legacy
 * `lastMoveTime`-based clock to the absolute `moveDeadline` architecture.
 *
 * What it does:
 *   For every active correspondence game that has `lastMoveTime` in other_data
 *   but no `moveDeadline`, computes:
 *     moveDeadline = lastMoveTime + (correspondence_days * 86400000)
 *   and writes it back into other_data via JSON_SET (non-destructive — all
 *   other fields in other_data are left untouched).
 *
 * Safety:
 *   - Dry-run mode (default) — prints what would change, touches nothing.
 *   - Pass --apply to actually write to the database.
 *   - Only touches rows where moveDeadline is NULL and lastMoveTime is set.
 *   - Skips games already expired (moveDeadline would be in the past) so
 *     the hourly cancelExpiredCorrespondenceGames job can handle those on
 *     its next run without us accidentally reviving them.
 *   - Idempotent: safe to run multiple times.
 *
 * Run on EC2 (dry-run first, then apply):
 *   node scripts/backfill-correspondence-deadline.js
 *   node scripts/backfill-correspondence-deadline.js --apply
 *
 * To load credentials from the .env file automatically:
 *   node -r dotenv/config scripts/backfill-correspondence-deadline.js [--apply]
 *
 * Or pull credentials directly from the .env file without dotenv installed:
 *   set -a && source .env && set +a
 *   node scripts/backfill-correspondence-deadline.js --apply
 */

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv not required — env vars may already be set
}

const db = require('../configs/db');

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  Correspondence deadline backfill');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : '⚠️  APPLYING CHANGES'}`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  // Fetch all active correspondence games that still use the legacy approach:
  //   - has lastMoveTime in other_data
  //   - does NOT yet have moveDeadline in other_data
  const [rows] = await db.query(`
    SELECT
      id,
      correspondence_days,
      JSON_EXTRACT(other_data, '$.lastMoveTime') AS lastMoveTime,
      JSON_EXTRACT(other_data, '$.moveDeadline') AS existingDeadline
    FROM games
    WHERE is_correspondence = 1
      AND status = 'active'
      AND correspondence_days IS NOT NULL
      AND JSON_EXTRACT(other_data, '$.lastMoveTime') IS NOT NULL
      AND JSON_EXTRACT(other_data, '$.moveDeadline') IS NULL
    ORDER BY id ASC
  `);

  if (rows.length === 0) {
    console.log('✅  No games to backfill — all active correspondence games already have moveDeadline.');
    await db.end();
    return;
  }

  console.log(`Found ${rows.length} game(s) to backfill:\n`);

  const now = Date.now();
  let skippedAlreadyExpired = 0;
  let toUpdate = [];

  for (const row of rows) {
    const lastMoveTime = Number(row.lastMoveTime);
    const allowedMs = Number(row.correspondence_days) * 24 * 60 * 60 * 1000;
    const moveDeadline = lastMoveTime + allowedMs;
    const remainingMs = moveDeadline - now;
    const remainingHours = (remainingMs / (60 * 60 * 1000)).toFixed(1);

    if (moveDeadline <= now) {
      // Already past deadline — leave it for the hourly expiry job to handle.
      console.log(
        `  SKIP  game ${row.id} — already expired ` +
        `(lastMoveTime=${new Date(lastMoveTime).toISOString()}, ` +
        `deadline was ${new Date(moveDeadline).toISOString()})`
      );
      skippedAlreadyExpired++;
    } else {
      console.log(
        `  ${DRY_RUN ? 'WOULD UPDATE' : 'UPDATING'}  game ${row.id} — ` +
        `moveDeadline=${new Date(moveDeadline).toISOString()} ` +
        `(${remainingHours}h remaining)`
      );
      toUpdate.push({ id: row.id, moveDeadline });
    }
  }

  console.log('');

  if (toUpdate.length === 0) {
    console.log(`✅  Nothing to update (${skippedAlreadyExpired} already-expired game(s) skipped).`);
    await db.end();
    return;
  }

  if (DRY_RUN) {
    console.log(`DRY RUN: would update ${toUpdate.length} game(s), skipped ${skippedAlreadyExpired} expired.`);
    console.log('Run with --apply to commit these changes.');
    await db.end();
    return;
  }

  // Apply updates one at a time so a single failure doesn't roll back others.
  let successCount = 0;
  let failCount = 0;

  for (const { id, moveDeadline } of toUpdate) {
    try {
      const [result] = await db.query(
        `UPDATE games
         SET other_data = JSON_SET(other_data, '$.moveDeadline', ?)
         WHERE id = ?
           AND status = 'active'
           AND JSON_EXTRACT(other_data, '$.moveDeadline') IS NULL`,
        [moveDeadline, id]
      );

      if (result.affectedRows === 1) {
        console.log(`  ✅  game ${id} updated`);
        successCount++;
      } else {
        // Race condition: game completed or already backfilled between SELECT and UPDATE
        console.log(`  ⚠️  game ${id} — no rows affected (game may have ended or was already updated)`);
        skippedAlreadyExpired++;
      }
    } catch (err) {
      console.error(`  ❌  game ${id} — UPDATE failed: ${err.message}`);
      failCount++;
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Done.`);
  console.log(`  Updated:  ${successCount}`);
  console.log(`  Skipped:  ${skippedAlreadyExpired} (already expired or already backfilled)`);
  console.log(`  Errors:   ${failCount}`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  if (failCount > 0) {
    process.exitCode = 1;
  }

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
