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
 * Run once on production:
 *   node scripts/migrate-hop-flags-to-attack.js
 */

const db = require('../configs/db');

async function run() {
  console.log('=== Hop-flags-to-attack migration ===');

  // Fetch all pieces that have at least one movement-hop flag set
  const [pieces] = await db.query(`
    SELECT id,
      can_hop_over_allies,    can_hop_attack_over_allies,
      can_hop_over_enemies,   can_hop_attack_over_enemies,
      exact_ratio_hop_only,   exact_ratio_hop_only_attack,
      directional_hop_disabled, directional_hop_disabled_attack,
      directional_hop_only,   directional_hop_only_attack,
      hop_stop_at_occupied,   hop_stop_at_occupied_attack
    FROM pieces
    WHERE can_hop_over_allies = 1
       OR can_hop_over_enemies = 1
       OR exact_ratio_hop_only = 1
       OR directional_hop_disabled = 1
       OR directional_hop_only = 1
  `);

  console.log(`Found ${pieces.length} piece(s) with movement hopping enabled.`);

  let updated = 0;
  let skipped = 0;

  for (const piece of pieces) {
    const sets = [];
    const values = [];

    // For each flag pair: only copy if the attack column is not already set
    const pairs = [
      ['can_hop_over_allies',      'can_hop_attack_over_allies'],
      ['can_hop_over_enemies',     'can_hop_attack_over_enemies'],
      ['exact_ratio_hop_only',     'exact_ratio_hop_only_attack'],
      ['directional_hop_disabled', 'directional_hop_disabled_attack'],
      ['directional_hop_only',     'directional_hop_only_attack'],
    ];

    for (const [src, dst] of pairs) {
      const srcVal = piece[src];
      const dstVal = piece[dst];
      // Only copy if source is truthy and destination has never been explicitly enabled
      if ((srcVal === 1 || srcVal === true) && !dstVal) {
        sets.push(`${dst} = 1`);
        values.push(piece.id);
      }
    }

    // hop_stop_at_occupied defaults to 1 (true) when not set, so only copy when
    // src is explicitly 1 and dst is 0 (explicitly disabled) -- skip if dst is
    // null (will default correctly) or already 1.
    // Actually: copy if src=1 and dst is null/0, meaning not yet explicitly set to true.
    const hopSrc = piece['hop_stop_at_occupied'];
    const hopDst = piece['hop_stop_at_occupied_attack'];
    if ((hopSrc === 1 || hopSrc === true) && (hopDst === null || hopDst === 0 || hopDst === false || hopDst === undefined)) {
      sets.push('hop_stop_at_occupied_attack = 1');
      values.push(piece.id);
    }

    if (sets.length === 0) {
      skipped++;
      continue;
    }

    // Deduplicate values (one id per SET clause was pushed, but UPDATE only needs one id)
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
