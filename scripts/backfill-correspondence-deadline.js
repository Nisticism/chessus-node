/**
 * backfill-correspondence-deadline.js
 * One-time production script - migrates correspondence games from the legacy
 * lastMoveTime-based clock to the absolute moveDeadline architecture.
 *
 * What it does:
 *   Case A - game has moves (lastMoveTime present):
 *     moveDeadline = lastMoveTime + (correspondence_days * 86400000)
 *
 *   Case B - game has no moves yet (lastMoveTime absent):
 *     moveDeadline = start_time + (correspondence_days * 86400000)
 *     (start_time is the DB column set when the game became active)
 *
 *   In both cases the value is written back via JSON_SET, which is
 *   non-destructive - all other fields in other_data are untouched.
 *
 * Safety:
 *   - Dry-run mode (default) - prints what would change, touches nothing.
 *   - Pass --apply to actually write to the database.
 *   - Skips games where moveDeadline would be in the past (already expired);
 *     the hourly cancelExpiredCorrespondenceGames job handles those.
 *   - Idempotent: safe to run multiple times.
 *
 * Run on EC2 (dry-run first, then apply):
 *   node -r dotenv/config scripts/backfill-correspondence-deadline.js
 *   node -r dotenv/config scripts/backfill-correspondence-deadline.js --apply
 */

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv not required - env vars may already be set
}

const db = require('../configs/db');

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  console.log('');
  console.log('======================================================');
  console.log('  Correspondence deadline backfill');
  console.log('  Mode: ' + (DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLYING CHANGES'));
  console.log('======================================================');
  console.log('');

  // Fetch ALL active correspondence games that don't yet have moveDeadline.
  // This includes both:
  //   - games with moves (lastMoveTime present) - Case A
  //   - games with no moves yet (lastMoveTime absent) - Case B, use start_time
  const [rows] = await db.query(`
    SELECT
      id,
      correspondence_days,
      start_time,
      JSON_EXTRACT(other_data, '$.lastMoveTime') AS lastMoveTime,
      JSON_EXTRACT(other_data, '$.moveDeadline') AS existingDeadline
    FROM games
    WHERE is_correspondence = 1
      AND status = 'active'
      AND correspondence_days IS NOT NULL
      AND JSON_EXTRACT(other_data, '$.moveDeadline') IS NULL
    ORDER BY id ASC
  `);

  if (rows.length === 0) {
    console.log('[OK]  No games to backfill - all active correspondence games already have moveDeadline.');
    await db.end();
    return;
  }

  console.log('Found ' + rows.length + ' game(s) to backfill:\n');

  const now = Date.now();
  let skippedAlreadyExpired = 0;
  let skippedNoAnchor = 0;
  const toUpdate = [];

  for (const row of rows) {
    const allowedMs = Number(row.correspondence_days) * 24 * 60 * 60 * 1000;

    // Determine anchor: prefer lastMoveTime (most recent move), fall back to start_time
    let anchor = null;
    let anchorSource = '';
    if (row.lastMoveTime !== null && row.lastMoveTime !== undefined) {
      anchor = Number(row.lastMoveTime);
      anchorSource = 'lastMoveTime';
    } else if (row.start_time) {
      // MySQL datetime strings use space separator ('2026-04-20 10:30:00'), not the
      // ISO 8601 'T' separator that new Date() requires - replace it before parsing.
      anchor = new Date(row.start_time.replace(' ', 'T')).getTime();
      anchorSource = 'start_time';
    }

    if (anchor === null || isNaN(anchor)) {
      console.log('  SKIP  game ' + row.id + ' - no anchor timestamp (no lastMoveTime or start_time)');
      skippedNoAnchor++;
      continue;
    }

    const moveDeadline = anchor + allowedMs;
    const remainingHours = ((moveDeadline - now) / (60 * 60 * 1000)).toFixed(1);

    if (moveDeadline <= now) {
      console.log(
        '  SKIP  game ' + row.id + ' - already expired' +
        ' (anchor [' + anchorSource + ']=' + new Date(anchor).toISOString() + ',' +
        ' deadline was ' + new Date(moveDeadline).toISOString() + ')'
      );
      skippedAlreadyExpired++;
    } else {
      console.log(
        '  ' + (DRY_RUN ? 'WOULD UPDATE' : 'UPDATING') + '  game ' + row.id +
        ' - anchor: ' + anchorSource +
        ', moveDeadline=' + new Date(moveDeadline).toISOString() +
        ' (' + remainingHours + 'h remaining)'
      );
      toUpdate.push({ id: row.id, moveDeadline });
    }
  }

  console.log('');

  if (toUpdate.length === 0) {
    console.log(
      '[OK]  Nothing to update' +
      ' (' + skippedAlreadyExpired + ' expired, ' + skippedNoAnchor + ' no-anchor skipped).'
    );
    await db.end();
    return;
  }

  if (DRY_RUN) {
    console.log(
      'DRY RUN: would update ' + toUpdate.length + ' game(s),' +
      ' skipped ' + skippedAlreadyExpired + ' expired, ' + skippedNoAnchor + ' no-anchor.'
    );
    console.log('Run with --apply to commit these changes.');
    await db.end();
    return;
  }

  // Apply updates one at a time so a single failure does not affect others.
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
        console.log('  [OK]  game ' + id + ' updated');
        successCount++;
      } else {
        console.log('  [WARN]  game ' + id + ' - no rows affected (game may have ended or was already updated)');
        skippedAlreadyExpired++;
      }
    } catch (err) {
      console.error('  [ERR]  game ' + id + ' - UPDATE failed: ' + err.message);
      failCount++;
    }
  }

  console.log('');
  console.log('======================================================');
  console.log('  Done.');
  console.log('  Updated:  ' + successCount);
  console.log('  Skipped:  ' + skippedAlreadyExpired + ' (expired or already backfilled)');
  console.log('  Skipped:  ' + skippedNoAnchor + ' (no anchor timestamp available)');
  console.log('  Errors:   ' + failCount);
  console.log('======================================================');
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
