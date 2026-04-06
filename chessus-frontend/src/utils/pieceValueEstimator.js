/**
 * Estimates the approximate value of a piece based on max squares reachable
 * from the center of an empty board. Orthogonal directions are weighted higher
 * than diagonal (rook > bishop). Scaled so a queen ≈ 9 on standard 8×8.
 *   Pawn ≈ 1, Knight ≈ 3, Bishop ≈ 3.5, Rook ≈ 5.4, Queen ≈ 9
 */
export function estimatePieceValue(piece, boardSize = 8) {
  if (!piece) return 0;
  if (piece.ends_game_on_checkmate || piece.ends_game_on_capture) return 100;

  const bs = boardSize || 8;
  const center = Math.floor(bs / 2);
  const ORTH_WEIGHT = 1.4; // orthogonal squares worth more than diagonal

  const dirs = [
    { move: 'up_movement', cap: 'up_capture', dx: 0, dy: -1, orth: true },
    { move: 'down_movement', cap: 'down_capture', dx: 0, dy: 1, orth: true },
    { move: 'left_movement', cap: 'left_capture', dx: -1, dy: 0, orth: true },
    { move: 'right_movement', cap: 'right_capture', dx: 1, dy: 0, orth: true },
    { move: 'up_left_movement', cap: 'up_left_capture', dx: -1, dy: -1, orth: false },
    { move: 'up_right_movement', cap: 'up_right_capture', dx: 1, dy: -1, orth: false },
    { move: 'down_left_movement', cap: 'down_left_capture', dx: -1, dy: 1, orth: false },
    { move: 'down_right_movement', cap: 'down_right_capture', dx: 1, dy: 1, orth: false },
  ];

  // Walk from center in a direction and count reachable squares
  function countSquares(dx, dy, range) {
    if (!range || range <= 0) return 0;
    let steps = 0, x = center, y = center;
    const limit = range === 99 ? bs : range;
    for (let i = 0; i < limit; i++) {
      x += dx; y += dy;
      if (x < 0 || x >= bs || y < 0 || y >= bs) break;
      steps++;
    }
    return steps;
  }

  // For each direction, use max of move and capture range (both let you interact)
  let coverage = 0;
  for (const d of dirs) {
    const effective = Math.max(piece[d.move] || 0, piece[d.cap] || 0);
    if (effective <= 0) continue;
    const squares = countSquares(d.dx, d.dy, effective);
    coverage += squares * (d.orth ? ORTH_WEIGHT : 1.0);
  }

  // L-shaped / ratio movement (knight-like): count actual reachable squares from center
  if (piece.ratio_movement_1 && piece.ratio_movement_2) {
    const r1 = Math.abs(piece.ratio_movement_1);
    const r2 = Math.abs(piece.ratio_movement_2);
    const seen = new Set();
    for (const [dx, dy] of [[r1,r2],[r1,-r2],[-r1,r2],[-r1,-r2],[r2,r1],[r2,-r1],[-r2,r1],[-r2,-r1]]) {
      const nx = center + dx, ny = center + dy;
      if (nx >= 0 && nx < bs && ny >= 0 && ny < bs) seen.add(`${nx},${ny}`);
    }
    coverage += seen.size * 1.3; // L-shape premium: can't be blocked
  }

  // Step movement
  if (piece.step_movement_value) {
    coverage += Math.abs(piece.step_movement_value) * 1.5;
  }

  // Compute reference: hypothetical queen (8-dir infinite) on this board size
  let queenRef = 0;
  for (const d of dirs) {
    let steps = 0, x = center, y = center;
    while (true) { x += d.dx; y += d.dy; if (x < 0 || x >= bs || y < 0 || y >= bs) break; steps++; }
    queenRef += steps * (d.orth ? ORTH_WEIGHT : 1.0);
  }
  // Scale so queen-equivalent = 9 points
  const divisor = Math.max(1, queenRef / 9);
  let value = coverage / divisor;

  // Ability bonuses
  if (piece.can_capture_enemy_via_range) value += 1.5;
  if (piece.can_hop_over_allies || piece.can_hop_over_enemies) value += 0.5;
  if (piece.can_control_squares) value += 1.0;

  // Promotion bonus: pieces that can promote have latent future value
  if (piece.can_promote) value += 0.5;

  // HP scaling: damaged pieces are worth less
  const hp = piece.current_hp ?? piece.hit_points ?? 1;
  const maxHp = piece.hit_points || 1;
  if (maxHp > 1) value *= (0.5 + 0.5 * hp / maxHp);

  return Math.max(0.5, Math.round(value * 10) / 10);
}

/**
 * Calculate total material value for a list of pieces.
 */
export function totalMaterialValue(pieces, boardSize = 8) {
  return pieces.reduce((sum, p) => sum + estimatePieceValue(p, boardSize), 0);
}
