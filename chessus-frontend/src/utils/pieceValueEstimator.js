/**
 * Estimates the approximate value of a piece based on its movement and attack capabilities.
 * Used for captured piece value display and material-based clock mechanics.
 * Mirrors the logic in server/ai/ai-engine.js getPieceValue() for consistency.
 */
export function estimatePieceValue(piece, boardSize = 8) {
  if (!piece) return 0;

  let value = piece.piece_value || 1;

  // Critical flags — these pieces are game-enders
  if (piece.ends_game_on_checkmate) value += 100;
  if (piece.ends_game_on_capture) value += 100;

  const bs = boardSize || 8;
  const boardScale = bs / 8;

  const moveDirs = [
    'up_movement', 'down_movement', 'left_movement', 'right_movement',
    'up_left_movement', 'up_right_movement', 'down_left_movement', 'down_right_movement'
  ];
  const capDirs = [
    'up_capture', 'down_capture', 'left_capture', 'right_capture',
    'up_left_capture', 'up_right_capture', 'down_left_capture', 'down_right_capture'
  ];

  let moveDirections = 0;
  for (const dir of moveDirs) {
    if (piece[dir] && piece[dir] > 0) {
      moveDirections++;
      if (piece[dir] === 99) {
        value += 1.5 * boardScale;
      } else {
        value += Math.min(piece[dir], 8) * 0.3;
      }
    }
  }

  let captureDirections = 0;
  for (const dir of capDirs) {
    if (piece[dir] && piece[dir] > 0) {
      captureDirections++;
      if (piece[dir] === 99) {
        value += 1.0 * boardScale;
      } else {
        value += Math.min(piece[dir], 8) * 0.2;
      }
    }
  }

  value += moveDirections * 0.5;
  value += captureDirections * 0.3;

  if (moveDirections >= 4 && captureDirections >= 4) value += 2 * boardScale;
  if (piece.ratio_movement_1 && piece.ratio_movement_2) value += 2.5 * boardScale;
  if (piece.step_movement_value) value += Math.abs(piece.step_movement_value) * 0.8;
  if (piece.can_capture_enemy_via_range) value += 2;
  if (piece.can_hop_over_allies || piece.can_hop_over_enemies) value += 1;

  // HP scaling
  const hp = piece.current_hp ?? piece.hit_points ?? 1;
  const maxHp = piece.hit_points || 1;
  if (maxHp > 1) value *= (0.5 + 0.5 * hp / maxHp);

  return Math.round(value * 10) / 10;
}

/**
 * Calculate total material value for a list of pieces.
 */
export function totalMaterialValue(pieces, boardSize = 8) {
  return pieces.reduce((sum, p) => sum + estimatePieceValue(p, boardSize), 0);
}
