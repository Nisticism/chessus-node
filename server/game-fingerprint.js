/*
 * A fingerprint of a game type: its rules, its board, and every piece on it.
 *
 * WHY THIS EXISTS
 *
 * Seeded puzzles are generated against one database and installed on another.
 * The ids line up because the local database is a pull of production - but only
 * mostly. Games exist locally that were never deployed, games exist on
 * production that were made after the last pull, and a game can be EDITED on one
 * side and not the other. An id match is therefore not enough: installing a
 * puzzle whose position was verified against a different version of the same
 * game produces a puzzle that is subtly wrong, or has no answer at all.
 *
 * So each seeded puzzle carries the fingerprint of the game it was built in, and
 * the installer recomputes it for the game it is about to attach to. Different
 * fingerprint, no insert. That is a deliberately blunt rule: it would rather
 * skip a game than publish a broken puzzle.
 *
 * WHAT IT COVERS
 *
 * Everything a puzzle's correctness depends on - how pieces move, what each
 * placement overrides, which squares are special, how the game is won - and
 * nothing that it does not. The name, description, play counts, badges and
 * timestamps are all left out, so renaming a game does not orphan its puzzle.
 */
const crypto = require('crypto');

/** Board, win conditions, and anything that changes what a legal move is. */
const RULE_COLS = [
  'board_width', 'board_height', 'player_count',
  'mate_condition', 'mate_condition_requires_all',
  'capture_condition', 'capture_condition_requires_all',
  'value_condition', 'value_max',
  'squares_condition', 'squares_count',
  'hill_condition', 'hill_x', 'hill_y', 'hill_turns',
  'piece_count_condition', 'points_to_win',
  'starting_points_p1', 'starting_points_p2',
  'no_moves_condition', 'lose_all_pieces_condition',
  'stalemate_win_condition', 'stalemate_draw_condition',
  'forced_capture_condition', 'promotion_condition', 'optional_condition',
  'actions_per_turn', 'simultaneous_turns', 'start_repositions',
  'fog_of_war', 'permanent_fog_reveal', 'hide_enemy_pieces',
  'veto_enabled', 'veto_style', 'veto_per_turn_limit', 'veto_per_game_limit',
  'veto_disallow_placement', 'veto_disallow_promotion',
  'draw_move_limit', 'repetition_draw_count', 'illegal_move_limit',
  'promotion_squares_string', 'special_squares_string',
  'range_squares_string', 'control_squares_string',
  'pieces_string', 'other_game_data',
];

/** Everything about a piece that decides how it moves, captures or ends a game. */
const PIECE_COLS = [
  'piece_name', 'piece_width', 'piece_height',
  'repeating_movement', 'max_directional_movement_iterations', 'min_directional_movement_iterations',
  'up_left_movement', 'up_movement', 'up_right_movement', 'right_movement',
  'down_right_movement', 'down_movement', 'down_left_movement', 'left_movement',
  'up_left_movement_exact', 'up_movement_exact', 'up_right_movement_exact', 'right_movement_exact',
  'down_right_movement_exact', 'down_movement_exact', 'down_left_movement_exact', 'left_movement_exact',
  'up_left_movement_available_for', 'up_movement_available_for', 'up_right_movement_available_for',
  'right_movement_available_for', 'down_right_movement_available_for', 'down_movement_available_for',
  'down_left_movement_available_for', 'left_movement_available_for',
  'up_left_capture', 'up_capture', 'up_right_capture', 'right_capture',
  'down_right_capture', 'down_capture', 'down_left_capture', 'left_capture',
  'ratio_one_movement', 'ratio_two_movement', 'ratio_one_capture', 'ratio_two_capture',
  'repeating_ratio', 'max_ratio_iterations', 'min_ratio_iterations',
  'step_by_step_movement_value', 'step_by_step_movement_style',
  'can_hop_over_allies', 'can_hop_over_enemies', 'hop_stop_at_occupied',
  'can_castle', 'can_promote', 'can_en_passant', 'first_move_only', 'first_move_only_capture',
  'has_checkmate_rule', 'has_check_rule', 'has_lose_on_capture_rule',
  'can_capture_allies', 'cannot_be_captured', 'must_move_if_able',
  'chain_capture_enabled', 'capture_on_hop',
  'trample', 'ghostwalk', 'die_on_capture', 'attack_radius',
  'custom_movement_squares', 'custom_attack_squares',
  'special_scenario_moves', 'special_scenario_captures',
  'promotion_pieces_ids', 'free_move_after_promotion',
  'directional_movement_change', 'directional_capture_change',
  'can_fire_over_allies', 'can_fire_over_enemies',
];

/** Per-placement overrides, which are part of the game and not of the piece. */
const PLACEMENT_COLS = [
  'x', 'y', 'player_number',
  'ends_game_on_checkmate', 'ends_game_on_capture',
  'manual_castling_partners', 'castling_partner_left_key', 'castling_partner_right_key',
  'castling_distance', 'can_control_squares', 'can_en_passant',
  'can_fire_over_allies', 'can_fire_over_enemies',
  'promotion_pieces_override', 'disable_promotion',
  'can_promote_to_checkmate', 'limit_promote_checkmate_to_original',
  'can_promote_to_capture', 'limit_promote_capture_to_original',
  'capture_points_gain', 'capture_points_loss',
  'cannot_move_outside_zone', 'cannot_be_captured', 'is_neutral',
  'hit_points', 'attack_damage', 'hp_regen', 'burn_damage', 'burn_duration',
  'trample', 'trample_radius', 'ghostwalk', 'die_on_capture',
  'die_on_capture_grants_win', 'attack_radius',
];

/*
 * The same value can be spelled several ways across two databases - '' and NULL
 * and '{}' all mean "not set", 0 and '0' and false all mean off, and JSON keys
 * can come back in a different order. Canonicalising first means a fingerprint
 * only differs when the GAME differs.
 */
function canon(v) {
  if (v == null) return '';
  if (v === true) return '1';
  if (v === false) return '';
  const s = String(v).trim();
  if (s === '' || s === 'null' || s === '{}' || s === '[]' || s === '0' || s === 'false') return '';
  if (s === 'true') return '1';
  if (s[0] !== '{' && s[0] !== '[') return s;
  let parsed;
  try { parsed = JSON.parse(s); } catch (_) { return s; }
  const sortDeep = (x) => {
    if (Array.isArray(x)) return x.map(sortDeep);
    if (x && typeof x === 'object') {
      const out = {};
      for (const k of Object.keys(x).sort()) out[k] = sortDeep(x[k]);
      return out;
    }
    return x;
  };
  const out = JSON.stringify(sortDeep(parsed));
  return out === '{}' || out === '[]' ? '' : out;
}

/**
 * Fingerprint one game type.
 *
 * @param {object} gameType   row from `game_types`
 * @param {Array}  placements rows from `game_type_pieces` for this game
 * @param {Map|object} pieceById  piece rows keyed by id
 * @returns {string} 32 hex characters, or '' when the inputs are unusable
 */
function fingerprintGame(gameType, placements, pieceById) {
  if (!gameType) return '';
  const get = (map, id) => (map instanceof Map ? map.get(id) : map[id]);

  const rules = RULE_COLS.map(c => `${c}=${canon(gameType[c])}`).join('|');

  const cells = (placements || [])
    .map((pl) => {
      const def = get(pieceById, Number(pl.piece_id)) || {};
      const piece = PIECE_COLS.map(c => canon(def[c])).join(',');
      const over = PLACEMENT_COLS.map(c => canon(pl[c])).join(',');
      // Sorted by square so row order in the table cannot change the result.
      return `${pl.player_number}:${pl.y},${pl.x}|${piece}|${over}`;
    })
    .sort();

  return crypto.createHash('sha256')
    .update(`${rules}\n${cells.join('\n')}`)
    .digest('hex')
    .slice(0, 32);
}

module.exports = { fingerprintGame, canon };
