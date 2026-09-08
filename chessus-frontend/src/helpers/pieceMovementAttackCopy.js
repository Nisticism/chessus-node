/*
 * Copying a piece's movement onto its attack, or the other way round, and
 * telling whether it has either at all.
 *
 * The movement -> attack copy used to live inside PieceStep3Attack as a
 * closure. It is here so the save-time warning can offer the same operation the
 * "Copy from Movement" button performs, rather than a second implementation
 * that drifts from it.
 *
 * The "has any" checks mirror gHasAnyMovement / gHasAnyAttack in
 * server/index.js. They are the site's existing definition of a piece that can
 * do nothing, and the warning has to agree with the server about that.
 */

const DIRS = ['up_left', 'up', 'up_right', 'right', 'down_right', 'down', 'down_left', 'left'];

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const anyDir = (pieceData, suffix) => DIRS.some((d) => num(pieceData[`${d}${suffix}`]) !== 0);

/** A ratio (L-shape) pattern only functions when BOTH legs are set. */
const hasRatio = (pieceData, one, two) => num(pieceData[one]) !== 0 && num(pieceData[two]) !== 0;

export const hasAnyMovement = (pieceData) => !!pieceData && (
  anyDir(pieceData, '_movement')
  || hasRatio(pieceData, 'ratio_one_movement', 'ratio_two_movement')
  || num(pieceData.step_by_step_movement_value) !== 0
  || !!pieceData.custom_movement_squares
  || !!pieceData.special_scenario_moves
);

/*
 * Whether the piece can actually take something once saved.
 *
 * The two "can capture" fields are TOGGLES over the value fields, not attacks in
 * their own right - and can_capture_enemy_on_move is on by default for a brand
 * new piece, so counting it would mean this never fires. Worse, the save route
 * NULLs every capture-on-move value when its toggle is off, so values behind a
 * closed toggle do not survive the save either. Both have to be true.
 *
 * attacks_like_movement is the exception that is a real attack on its own: it
 * makes the piece capture using its MOVEMENT columns, so a piece with movement
 * and that flag can take pieces without a single capture value set.
 */
export const hasAnyAttack = (pieceData) => {
  if (!pieceData) return false;

  if (pieceData.attacks_like_movement && hasAnyMovement(pieceData)) return true;

  const captureOnMove = !!pieceData.can_capture_enemy_on_move;
  if (captureOnMove && (
    anyDir(pieceData, '_capture')
    || hasRatio(pieceData, 'ratio_one_capture', 'ratio_two_capture')
    || num(pieceData.step_by_step_capture) !== 0
  )) return true;

  // Custom squares and scenario captures are not cleared by the toggle, so they
  // stand on their own.
  if (pieceData.custom_attack_squares || pieceData.special_scenario_captures) return true;

  const ranged = !!pieceData.can_capture_enemy_via_range;
  if (ranged && (
    anyDir(pieceData, '_attack_range')
    || hasRatio(pieceData, 'ratio_one_attack_range', 'ratio_two_attack_range')
    || num(pieceData.step_by_step_attack_range) !== 0
  )) return true;

  return false;
};

/** additionalMovements and additionalCaptures have the same shape under a different key. */
const convertScenario = (raw, fromKey, toKey) => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !parsed[fromKey]) return null;
    return JSON.stringify({ [toKey]: parsed[fromKey] });
  } catch (_) {
    return null;
  }
};

/**
 * Everything needed to make this piece capture exactly the way it moves.
 * Returns an object to hand straight to updatePieceData.
 */
export const movementToAttackUpdates = (pieceData) => {
  const converted = convertScenario(pieceData.special_scenario_moves, 'additionalMovements', 'additionalCaptures');
  const ratioSet = num(pieceData.ratio_one_movement) > 0 && num(pieceData.ratio_two_movement) > 0;

  const out = {
    can_capture_enemy_on_move: true,
    ratio_one_capture: ratioSet ? pieceData.ratio_one_movement : 0,
    ratio_two_capture: ratioSet ? pieceData.ratio_two_movement : 0,
    step_by_step_capture: pieceData.step_by_step_movement_value,
    step_by_step_capture_no_orthogonal: pieceData.step_by_step_movement_no_orthogonal,
    repeating_capture: pieceData.repeating_movement,
    repeating_ratio_capture: ratioSet ? pieceData.repeating_ratio : false,
    max_ratio_capture_iterations: ratioSet ? pieceData.max_ratio_iterations : 0,
    ...(converted && { special_scenario_capture: converted }),
    custom_attack_squares: pieceData.custom_movement_squares,
    can_capture_enemy_via_range: pieceData.can_capture_enemy_via_range,
    can_hop_attack_over_allies: pieceData.can_hop_over_allies,
    can_hop_attack_over_enemies: pieceData.can_hop_over_enemies,
    exact_ratio_hop_only_attack: pieceData.exact_ratio_hop_only,
    directional_hop_disabled_attack: pieceData.directional_hop_disabled,
    hop_stop_at_occupied_attack: pieceData.hop_stop_at_occupied,
    directional_hop_only_attack: pieceData.directional_hop_only,
    max_directional_hop_pieces_attack: pieceData.max_directional_hop_pieces,
    directional_capture_change: pieceData.directional_movement_change,
    repeating_capture_change: pieceData.repeating_movement_change,
    require_empty_via_capture: pieceData.require_empty_via_movement,
    require_direction_change_capture: pieceData.require_direction_change,
  };

  for (const d of DIRS) {
    out[`${d}_capture`] = pieceData[`${d}_movement`];
    out[`${d}_capture_exact`] = pieceData[`${d}_movement_exact`];
    out[`${d}_capture_available_for`] = pieceData[`${d}_movement_available_for`];
    out[`${d}_capture_change`] = pieceData[`${d}_movement_change`];
    out[`${d}_capture_change_exact`] = pieceData[`${d}_movement_change_exact`];
    out[`${d}_capture_change_available_for`] = pieceData[`${d}_movement_change_available_for`];
  }
  return out;
};

/**
 * The mirror: make this piece move the way it attacks.
 *
 * Prefers the capture-on-move pattern, which is the direct analogue of
 * movement. A piece whose only attack is a RANGED one has nothing there to
 * copy, so it falls back to the ranged directions instead - otherwise the
 * button would appear to work and change nothing.
 */
export const attackToMovementUpdates = (pieceData) => {
  const fromCapture = anyDir(pieceData, '_capture')
    || hasRatio(pieceData, 'ratio_one_capture', 'ratio_two_capture')
    || num(pieceData.step_by_step_capture) !== 0
    || !!pieceData.custom_attack_squares
    || !!pieceData.special_scenario_captures;

  const src = fromCapture ? '_capture' : '_attack_range';
  const ratioOne = fromCapture ? 'ratio_one_capture' : 'ratio_one_attack_range';
  const ratioTwo = fromCapture ? 'ratio_two_capture' : 'ratio_two_attack_range';
  const ratioSet = num(pieceData[ratioOne]) > 0 && num(pieceData[ratioTwo]) > 0;

  const converted = fromCapture
    ? convertScenario(pieceData.special_scenario_captures, 'additionalCaptures', 'additionalMovements')
    : null;

  const out = {
    ratio_one_movement: ratioSet ? pieceData[ratioOne] : 0,
    ratio_two_movement: ratioSet ? pieceData[ratioTwo] : 0,
    repeating_ratio: ratioSet ? (fromCapture ? pieceData.repeating_ratio_capture : pieceData.repeating_ratio_ranged_attack) : false,
    max_ratio_iterations: ratioSet ? (fromCapture ? pieceData.max_ratio_capture_iterations : pieceData.max_ratio_ranged_attack_iterations) : 0,
    ...(converted && { special_scenario_moves: converted }),
    ...(fromCapture ? {
      step_by_step_movement_value: pieceData.step_by_step_capture,
      step_by_step_movement_no_orthogonal: pieceData.step_by_step_capture_no_orthogonal,
      repeating_movement: pieceData.repeating_capture,
      custom_movement_squares: pieceData.custom_attack_squares,
      can_hop_over_allies: pieceData.can_hop_attack_over_allies,
      can_hop_over_enemies: pieceData.can_hop_attack_over_enemies,
      exact_ratio_hop_only: pieceData.exact_ratio_hop_only_attack,
      directional_hop_disabled: pieceData.directional_hop_disabled_attack,
      hop_stop_at_occupied: pieceData.hop_stop_at_occupied_attack,
      directional_hop_only: pieceData.directional_hop_only_attack,
      max_directional_hop_pieces: pieceData.max_directional_hop_pieces_attack,
      directional_movement_change: pieceData.directional_capture_change,
      repeating_movement_change: pieceData.repeating_capture_change,
      require_empty_via_movement: pieceData.require_empty_via_capture,
      require_direction_change: pieceData.require_direction_change_capture,
    } : {
      step_by_step_movement_value: pieceData.step_by_step_attack_range,
      step_by_step_movement_no_orthogonal: pieceData.step_by_step_attack_no_orthogonal,
    }),
  };

  for (const d of DIRS) {
    out[`${d}_movement`] = pieceData[`${d}${src}`];
    out[`${d}_movement_exact`] = pieceData[`${d}${src}_exact`];
    out[`${d}_movement_available_for`] = pieceData[`${d}${src}_available_for`];
    if (fromCapture) {
      out[`${d}_movement_change`] = pieceData[`${d}_capture_change`];
      out[`${d}_movement_change_exact`] = pieceData[`${d}_capture_change_exact`];
      out[`${d}_movement_change_available_for`] = pieceData[`${d}_capture_change_available_for`];
    }
  }
  return out;
};
