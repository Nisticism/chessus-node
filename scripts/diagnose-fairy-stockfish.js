// One-off diagnostic: print the Fairy-Stockfish compatibility verdict and
// the raw piece/placement/game-type flags that contribute to it for a single
// game type. Usage:  node scripts/diagnose-fairy-stockfish.js <gameTypeId>
require('dotenv').config();
const db = require('../configs/db');
const fairyCompat = require('../server/ai/fairy-stockfish-compat');

(async () => {
  const gid = parseInt(process.argv[2] || '38', 10);
  console.log(`=== Fairy-Stockfish diagnostic for game_type_id=${gid} ===`);

  const [gameRows] = await db.query('SELECT * FROM game_types WHERE id = ? LIMIT 1', [gid]);
  if (gameRows.length === 0) { console.error('Game type not found'); process.exit(1); }
  const game = gameRows[0];
  console.log(`Game name: ${game.game_name}`);

  const [placements] = await db.query('SELECT * FROM game_type_pieces WHERE game_type_id = ?', [gid]);
  const pieceIds = Array.from(new Set(placements.map(p => p.piece_id).filter(v => v != null)));
  let pieces = [];
  if (pieceIds.length) {
    const ph = pieceIds.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT * FROM pieces WHERE id IN (${ph})`, pieceIds);
    pieces = rows;
  }

  console.log(`Placements: ${placements.length}, Distinct pieces: ${pieces.length}`);

  // Game-level flags that compat checks
  const gameFlags = [
    'simultaneous_turns', 'fog_of_war', 'actions_per_turn', 'start_repositions',
    'piece_count_condition', 'squares_condition', 'points_to_win', 'optional_condition',
    'board_width', 'board_height', 'other_game_data',
  ];
  console.log('\n--- Game-type flags ---');
  for (const k of gameFlags) console.log(`  ${k} = ${JSON.stringify(game[k])}`);

  // Per-piece flags that compat checks
  const pieceFlags = [
    'piece_width', 'piece_height',
    'step_by_step_movement_style', 'step_by_step_attack_style',
    'directional_movement_change', 'directional_capture_change',
    'trample', 'ghostwalk', 'attack_radius',
    'die_on_capture', 'die_on_capture_grants_win',
    'can_fire_over_allies', 'can_fire_over_enemies',
    'can_capture_allies', 'cannot_be_captured',
    'must_move_if_able', 'chain_capture_enabled',
    'custom_movement_squares', 'custom_attack_squares',
    'special_scenario_moves', 'special_scenario_capture',
  ];

  // Identify royals from placements (same logic as compat checker)
  const royalIds = new Set();
  for (const pl of placements) {
    if ((pl.ends_game_on_checkmate == 1) || (pl.ends_game_on_capture == 1)) {
      if (pl.piece_id != null) royalIds.add(pl.piece_id);
    }
  }
  console.log(`\nRoyal piece IDs (cm/capture-loss targets): ${[...royalIds].join(',') || '(none)'}`);

  for (const p of pieces) {
    console.log(`\n--- Piece ${p.id}: ${p.piece_name} (royal=${royalIds.has(p.id)}) ---`);
    for (const k of pieceFlags) {
      const v = p[k];
      if (v == null || v === 0 || v === '0' || v === false || v === '') continue;
      if (typeof v === 'string' && (v === '[]' || v === '{}')) continue;
      console.log(`  ${k} = ${typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '...' : v}`);
    }
    // Run the per-piece checker directly to see its verdict
    const r = fairyCompat.pieceIncompatReasons(p, royalIds.has(p.id));
    if (r.length) {
      console.log(`  >>> pieceIncompatReasons:`);
      for (const m of r) console.log(`      - ${m}`);
    } else {
      console.log(`  >>> pieceIncompatReasons: (none)`);
    }
  }

  // Per-placement flag check
  console.log(`\n--- Placement override checks ---`);
  let plBad = 0;
  for (const pl of placements) {
    const r = fairyCompat.placementIncompatReasons(pl);
    if (r.length) {
      plBad++;
      console.log(`  placement id=${pl.id} piece_id=${pl.piece_id} (${pl.x},${pl.y} p${pl.player_owner}):`);
      for (const m of r) console.log(`      - ${m}`);
    }
  }
  if (!plBad) console.log('  (no placement-override incompatibilities)');

  // Final verdict
  const verdict = fairyCompat.checkCompatibility(game, pieces, placements);
  console.log(`\n=== Final verdict: compatible=${verdict.compatible} ===`);
  if (verdict.reasons.length) {
    console.log('Reasons:');
    for (const r of verdict.reasons) {
      const msg = typeof r === 'string' ? r : `[${r.category}] ${r.sourceName} (${r.field}): ${r.message}${r.fix ? '  >> FIX: ' + r.fix : ''}`;
      console.log(`  - ${msg}`);
    }
  }

  await db.end();
})().catch(err => { console.error(err); process.exit(1); });
