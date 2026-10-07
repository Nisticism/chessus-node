/*
 * A piece's FIRST-MOVE movement: a second movement and attack, used only while
 * the piece has made fewer than `first_move_profile_moves` moves (default 1).
 *
 * The pawn's double step is the case everyone knows; the general one is any
 * movement at all - a first-move knight jump, a first-move leap of three, a
 * first-move capture - set in the piece wizard with the same Movement and
 * Attack steps as the piece's ordinary movement.
 *
 * Stored as one JSON column, `first_move_profile`, holding the same fields the
 * Movement and Attack steps edit (FIRST_MOVE_FIELDS, database names). While it
 * applies, a piece may move by its ordinary movement OR its first-move
 * movement. The engines get the first-move moves by running their own move
 * code on a copy of the piece with these fields swapped in (firstMoveVariant),
 * so every ability works the same way on a first move as on any other.
 *
 * The older first-move settings - each direction's "available for the first N
 * moves", first-move alternate distances, first_move_only - keep working for
 * the pieces (and frozen games) that use them; the copy clears them, so a
 * first-move movement does not inherit them.
 *
 * A MIRROR of server/first-move.js; the two must agree
 * (scripts/e2e/first-move-fields-test.js compares the field lists).
 */

const DIRS = ['up_left', 'up', 'up_right', 'right', 'down_right', 'down', 'down_left', 'left'];

export const FIRST_MOVE_FIELDS = [
  ...DIRS.flatMap((d) => [
    `${d}_movement`, `${d}_movement_exact`, `${d}_capture`, `${d}_capture_exact`,
    `${d}_movement_change`, `${d}_movement_change_exact`, `${d}_capture_change`, `${d}_capture_change_exact`,
  ]),
  'directional_movement_style', 'repeating_movement', 'max_repeating_movement', 'repeating_capture', 'max_repeating_capture',
  'ratio_movement_style', 'ratio_one_movement', 'ratio_two_movement', 'repeating_ratio', 'max_ratio_iterations', 'min_ratio_iterations',
  'ratio_one_capture', 'ratio_two_capture', 'repeating_ratio_capture', 'max_ratio_capture_iterations',
  'step_by_step_movement_style', 'step_by_step_movement_value', 'step_by_step_movement_no_orthogonal',
  'step_by_step_capture', 'step_by_step_capture_no_orthogonal',
  'can_hop_over_allies', 'can_hop_over_enemies', 'can_hop_attack_over_allies', 'can_hop_attack_over_enemies',
  'exact_ratio_hop_only', 'exact_ratio_hop_only_attack', 'directional_hop_disabled', 'directional_hop_disabled_attack',
  'hop_stop_at_occupied', 'hop_stop_at_occupied_attack', 'directional_hop_only', 'directional_hop_only_attack',
  'max_directional_hop_pieces', 'max_directional_hop_pieces_attack', 'min_directional_hop_pieces', 'min_directional_hop_pieces_attack',
  'hop_landing_distance', 'hop_landing_distance_attack',
  'ratio_path_order', 'ratio_path_order_attack', 'ratio_path_blocking', 'ratio_path_blocking_attack',
  'ratio_path_corner_blocks', 'ratio_path_corner_blocks_attack',
  'can_capture_enemy_on_move', 'attacks_like_movement',
  'custom_movement_squares', 'custom_attack_squares',
  'directional_movement_change', 'repeating_movement_change', 'require_empty_via_movement',
  'directional_capture_change', 'repeating_capture_change', 'require_empty_via_capture',
  'require_direction_change', 'require_direction_change_capture',
  'special_scenario_moves', 'special_scenario_captures',
];
const FIRST_MOVE_FIELD_SET = new Set(FIRST_MOVE_FIELDS);
// The direction values (0 = none), as opposed to their exact flags and the rest.
const DIRECTION_VALUE_FIELDS = new Set(DIRS.flatMap((d) => [
  `${d}_movement`, `${d}_capture`, `${d}_movement_change`, `${d}_capture_change`,
]));

// The older first-move settings, which a first-move copy must not inherit.
export const LEGACY_FIRST_MOVE_FIELDS = [
  ...DIRS.flatMap((d) => [
    `${d}_movement_available_for`, `${d}_capture_available_for`,
    `${d}_movement_change_available_for`, `${d}_capture_change_available_for`,
  ]),
  'first_move_only', 'first_move_only_capture',
];

// Database name -> the name the engines read (as puzzle-hydrate's toEngineFields).
const ENGINE_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};

export const MAX_FIRST_MOVES = 8;

/** The stored profile as an object, or null. */
export function parseFirstMoveProfile(raw) {
  if (!raw) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch (_) { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).some((k) => FIRST_MOVE_FIELD_SET.has(k)) ? value : null;
}

/** For how many of its first moves the profile applies: 1-8. */
export const firstMoveCount = (piece) => Math.min(MAX_FIRST_MOVES, Math.max(1, Math.floor(Number(piece?.first_move_profile_moves)) || 1));

/** Only the profile fields, from anything (a form, a request body). */
export function sanitizeFirstMoveProfile(raw) {
  const profile = parseFirstMoveProfile(raw);
  if (!profile) return null;
  const out = {};
  for (const [k, v] of Object.entries(profile)) {
    if (FIRST_MOVE_FIELD_SET.has(k)) out[k] = v;
    // The wizard calls the alternate-capture field by its form name.
    else if (k === 'special_scenario_capture') out.special_scenario_captures = v;
  }
  return compactFirstMoveProfile(out);
}

/*
 * A profile with only what it sets: empty, false and 0 say nothing a first-move
 * copy does not already have (firstMoveVariant clears every field), so they are
 * dropped - except where 0 is itself a setting (the corner of an L-path).
 */
export function compactFirstMoveProfile(profile) {
  if (!profile) return null;
  const out = {};
  for (const [k, v] of Object.entries(profile)) {
    if (!FIRST_MOVE_FIELD_SET.has(k)) continue;
    if (v === null || v === undefined || v === '' || v === false) continue;
    if (v === 0 && !k.startsWith('ratio_path_corner_blocks')) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/*
 * The piece as it moves on a first move: its own fields, with the movement and
 * attack replaced by the first-move profile. null when it has no profile, or
 * has already made its first `first_move_profile_moves` moves.
 */
export function firstMoveVariant(piece) {
  if (!piece) return null;
  const profile = parseFirstMoveProfile(piece.first_move_profile);
  if (!profile) return null;
  if ((Number(piece.moveCount) || 0) >= firstMoveCount(piece)) return null;
  const variant = { ...piece, first_move_profile: null, isFirstMoveVariant: true };
  // Cleared as a freshly saved piece has them: a direction's value 0 (not
  // null - the engines read a null capture direction as "captures the way it
  // moves", and 0 as "does not capture this way"), everything else null.
  for (const f of FIRST_MOVE_FIELDS) variant[f] = DIRECTION_VALUE_FIELDS.has(f) ? 0 : null;
  for (const f of LEGACY_FIRST_MOVE_FIELDS) variant[f] = null;
  for (const [k, v] of Object.entries(profile)) {
    if (FIRST_MOVE_FIELD_SET.has(k)) variant[k] = v;
  }
  for (const [from, to] of Object.entries(ENGINE_RENAMES)) variant[to] = variant[from];
  return variant;
}

/*
 * The older first-move settings of a piece (wizard field names), rebuilt as a
 * first-move movement - for the wizard's "Convert" button.
 *
 * The older settings mark single directions, or alternate distances, as
 * available for the first N moves. The rebuilt profile is a full copy of the
 * piece's movement and attack WITH those parts in it, and the piece itself
 * keeps everything WITHOUT them; on a first move the engines offer both, so
 * the piece moves exactly as before, and afterwards exactly as before too.
 *
 * Only when every marked part shares one N, from 1 to MAX_FIRST_MOVES:
 * { status: 'none' } (nothing to convert), { status: 'unsupported', reason },
 * or { status: 'ok', moves, updates }.
 */
export function convertLegacyFirstMove(pd) {
  const kinds = [['movement', 'special_scenario_moves', 'additionalMovements'], ['capture', 'special_scenario_capture', 'additionalCaptures']];
  const parse = (v) => {
    if (!v) return {};
    if (typeof v === 'object') return v;
    try { return JSON.parse(v) || {}; } catch (_) { return {}; }
  };
  const counts = new Set();
  let found = false;
  for (const d of DIRS) {
    for (const [kind] of kinds) {
      const af = Number(pd[`${d}_${kind}_available_for`]);
      if (af > 0) { counts.add(af); found = true; }
    }
    if (pd[`${d}_movement_change_available_for`] || pd[`${d}_capture_change_available_for`]) {
      return { status: 'unsupported', reason: 'a direction change is limited to the first moves' };
    }
  }
  const alternates = {};
  for (const [kind, field, key] of kinds) {
    alternates[kind] = parse(pd[field]);
    for (const list of Object.values(alternates[kind][key] || {})) {
      for (const m of list || []) {
        if (m.availableForMoves) { counts.add(Number(m.availableForMoves)); found = true; }
        if (m.firstMoveOnly) { counts.add(1); found = true; }
      }
    }
  }
  if (pd.first_move_only || pd.first_move_only_capture) {
    return { status: 'unsupported', reason: 'the whole movement is limited to the first move' };
  }
  if (!found) return { status: 'none' };
  if (counts.size > 1) return { status: 'unsupported', reason: `different parts last for different numbers of moves (${[...counts].sort((a, b) => a - b).join(', ')})` };
  const moves = [...counts][0];
  if (!(moves >= 1 && moves <= MAX_FIRST_MOVES)) return { status: 'unsupported', reason: `the first-move parts last ${moves} moves; at most ${MAX_FIRST_MOVES} can be set` };

  // The profile: the piece's whole movement and attack, as they are now...
  const profile = {};
  for (const f of FIRST_MOVE_FIELDS) {
    const wizardName = f === 'special_scenario_captures' ? 'special_scenario_capture' : f;
    if (pd[wizardName] !== undefined) profile[f] = pd[wizardName];
  }
  // ... and the piece, without its first-move parts.
  const updates = {};
  for (const d of DIRS) {
    for (const [kind] of kinds) {
      const afKey = `${d}_${kind}_available_for`;
      if (Number(pd[afKey]) > 0) {
        updates[`${d}_${kind}`] = 0;
        updates[`${d}_${kind}_exact`] = false;
        updates[afKey] = null;
      }
    }
  }
  const strip = (m) => { const { availableForMoves, firstMoveOnly, ...rest } = m; return { ...rest, firstMoveOnly: false }; };
  for (const [kind, field, key] of kinds) {
    const all = alternates[kind][key] || {};
    const kept = {};
    const profiled = {};
    for (const [dir, list] of Object.entries(all)) {
      // An alternate in a direction limited to the first moves is limited with
      // it (the engines check the direction's own "first N moves"), so it
      // goes with the direction, into the first-move movement only.
      const directionLimited = Number(pd[`${dir}_${kind}_available_for`]) > 0;
      kept[dir] = directionLimited ? [] : (list || []).filter((m) => !m.availableForMoves && !m.firstMoveOnly);
      profiled[dir] = (list || []).map(strip);
      if (!kept[dir].length) delete kept[dir];
    }
    updates[field] = Object.keys(kept).length ? JSON.stringify({ ...alternates[kind], [key]: kept }) : '';
    profile[kind === 'movement' ? 'special_scenario_moves' : 'special_scenario_captures'] = Object.keys(profiled).length
      ? JSON.stringify({ ...alternates[kind], [key]: profiled }) : null;
  }
  updates.first_move_profile = JSON.stringify(compactFirstMoveProfile(profile));
  updates.first_move_profile_moves = moves;
  return { status: 'ok', moves, updates };
}

/** The older first-move settings, cleared: for the wizard's "Remove" button. */
export function clearLegacyFirstMove(pd) {
  const updates = { first_move_only: false, first_move_only_capture: false };
  for (const d of DIRS) {
    for (const k of ['movement', 'capture', 'movement_change', 'capture_change']) {
      if (pd[`${d}_${k}_available_for`]) updates[`${d}_${k}_available_for`] = null;
    }
  }
  for (const [field, key] of [['special_scenario_moves', 'additionalMovements'], ['special_scenario_capture', 'additionalCaptures']]) {
    let parsed = {};
    try { parsed = typeof pd[field] === 'string' ? JSON.parse(pd[field] || '{}') : (pd[field] || {}); } catch (_) { parsed = {}; }
    const lists = parsed[key];
    if (!lists) continue;
    const kept = {};
    for (const [dir, list] of Object.entries(lists)) {
      const rest = (list || []).filter((m) => !m.availableForMoves && !m.firstMoveOnly);
      if (rest.length) kept[dir] = rest;
    }
    updates[field] = Object.keys(kept).length ? JSON.stringify({ ...parsed, [key]: kept }) : '';
  }
  return updates;
}

/** "has its own first move (first 2 moves)", or '' - for the piece and game pages. */
export function firstMoveWords(piece) {
  if (!parseFirstMoveProfile(piece?.first_move_profile)) return '';
  const n = firstMoveCount(piece);
  return `has its own first-move movement (${n === 1 ? 'its first move' : `its first ${n} moves`})`;
}
