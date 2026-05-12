/**
 * One-time migration: copy movement-hop flags to their attack equivalents
 * for all existing pieces that have movement hopping enabled but no explicit
 * attack-hop settings.
 *
 * Background: before the attack-hopping section was added to the piece wizard
 * (Step 3), only movement-hop flags existed and were implicitly assumed to also
 * apply to attacks.  Now that attack-hop flags are a separate set of DB columns,
 * this script back-fills them so existing pieces behave the same as before.
 *
 * Only copies a flag if the destination column is currently NULL or 0 (i.e. the
 * user has not explicitly set it), so any piece that was already edited via the
 * new wizard is left untouched.
 *
 * Safe to run at any time — columns that don't exist yet on the DB are skipped
 * automatically, so the script will not fail if the schema migrations haven't
 * fully run yet.
 *
 * Run once on production:
 *   node scripts/migrate-hop-flags-to-attack.js
 */

const db = require('../configs/db');

async function getExistingColumns(table) {
  const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
  return new Set(rows.map(r => r.Field));
}

async function run() {
  console.log('=== Hop-flags-to-attack migration ===');

  const existing = await getExistingColumns('pieces');

  // All flag pairs: [source column, destination column]
  const allPairs = [
    ['can_hop_over_allies',      'can_hop_attack_over_allies'],
    ['can_hop_over_enemies',     'can_hop_attack_over_enemies'],
    ['exact_ratio_hop_only',     'exact_ratio_hop_only_attack'],
    ['directional_hop_disabled', 'directional_hop_disabled_attack'],
    ['directional_hop_only',     'directional_hop_only_attack'],
  ];

  // Only include pairs where both columns exist on this DB
  const pairs = allPairs.filter(([src, dst]) => {
    const ok = existing.has(src) && existing.has(dst);
    if (!ok) console.log(`  SKIP pair (${src} -> ${dst}): column(s) missing on DB`);
    return ok;
  });

  const hasHopStop = existing.has('hop_stop_at_occupied') && existing.has('hop_stop_at_occupied_attack');
  if (!hasHopStop) console.log('  SKIP pair (hop_stop_at_occupied -> hop_stop_at_occupied_attack): column(s) missing on DB');

  if (pairs.length === 0 && !hasHopStop) {
    console.log('No eligible column pairs found — nothing to migrate.');
    process.exit(0);
  }

  // Build SELECT only with columns that exist
  const selectCols = ['id'];
  for (const [src, dst] of pairs) selectCols.push(src, dst);
  if (hasHopStop) selectCols.push('hop_stop_at_occupied', 'hop_stop_at_occupied_attack');

  // Build WHERE only with existing source columns
  const whereParts = pairs.map(([src]) => `${src} = 1`);
  if (hasHopStop) whereParts.push('hop_stop_at_occupied = 1');
  if (whereParts.length === 0) {
    console.log('No source columns to filter on — nothing to migrate.');
    process.exit(0);
  }

  const [pieces] = await db.query(
    `SELECT ${selectCols.join(', ')} FROM pieces WHERE ${whereParts.join(' OR ')}`
  );

  console.log(`Found ${pieces.length} piece(s) with movement hopping enabled.`);

  let updated = 0;
  let skipped = 0;

  for (const piece of pieces) {
    const sets = [];

    for (const [src, dst] of pairs) {
      const srcVal = piece[src];
      const dstVal = piece[dst];
      // Only copy if source is truthy and destination has never been explicitly enabled
      if ((srcVal === 1 || srcVal === true) && !dstVal) {
        sets.push(`${dst} = 1`);
      }
    }

    if (hasHopStop) {
      const hopSrc = piece['hop_stop_at_occupied'];
      const hopDst = piece['hop_stop_at_occupied_attack'];
      if ((hopSrc === 1 || hopSrc === true) && (hopDst === null || hopDst === 0 || hopDst === false || hopDst === undefined)) {
        sets.push('hop_stop_at_occupied_attack = 1');
      }
    }

    if (sets.length === 0) {
      skipped++;
      continue;
    }

    await db.query(
      `UPDATE pieces SET ${sets.join(', ')} WHERE id = ?`,
      [piece.id]
    );
    console.log(`  Updated piece id=${piece.id}: ${sets.join(', ')}`);
    updated++;
  }

  console.log(`\nDone. ${updated} piece(s) updated, ${skipped} already up-to-date.`);
  process.exit(0);
}

run().catch(err => {
  console.error('[ERR] Migration failed:', err);
  process.exit(1);
});
});
