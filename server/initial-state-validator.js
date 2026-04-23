/**
 * Initial-state validator
 * ------------------------
 * Detects when a game type's brand-new starting position is already in a
 * decided state (one side in checkmate, no legal moves with `no_moves_condition`,
 * stalemate under `stalemate_draw_condition` / `stalemate_win_condition`,
 * capture-condition already satisfied, anti-chess already satisfied, etc.).
 *
 * Wired into:
 *   - POST /api/games/create   (rejects publish if decided; drafts skipped)
 *   - PUT  /api/games/:gameId  (rejects publish if decided; drafts skipped)
 *   - Live game start (joinGame / vs-bot setup) — re-rolls randomization a
 *     few times if the rolled position is decided.
 *   - Admin scan endpoint that bulk-checks all existing game types and
 *     stores a human-readable warning in `game_types.initial_state_warning`.
 *
 * IMPORTANT: when adding a NEW win/draw condition column to game_types, you
 * MUST also extend `evaluateInitialPosition()` in `server/game-socket.js`
 * to detect that condition's already-satisfied state at move 0. Otherwise
 * users will be able to publish broken games. See the user-memory note
 * `initial-state-validator-reminder.md` for the full checklist.
 */

const db_pool = require("../configs/db");
const { evaluateInitialPosition } = require("./game-socket");

/**
 * Load and hydrate a game type's starting pieces array in the same shape
 * the live-game engine uses. Mirrors the inline loader inside the
 * `socket.on('createGame')` handler in `server/game-socket.js`.
 *
 * @param {number} gameTypeId
 * @returns {Promise<{ gameType: object|null, pieces: object[] }>}
 */
async function loadInitialStateForGameType(gameTypeId) {
  const [[gameType]] = await db_pool.query(
    "SELECT * FROM game_types WHERE id = ?",
    [gameTypeId]
  );
  if (!gameType) return { gameType: null, pieces: [] };

  // Load placements from the junction table.
  const [junctionPieces] = await db_pool.query(
    `SELECT gtp.*, gtp.ends_game_on_checkmate, gtp.ends_game_on_capture,
            p.piece_name, p.image_location
       FROM game_type_pieces gtp
       INNER JOIN pieces p ON gtp.piece_id = p.id
      WHERE gtp.game_type_id = ?`,
    [gameTypeId]
  );

  const pieceIdsToLoad = new Set();
  let pieces = junctionPieces.map(piece => {
    if (piece.piece_id) pieceIdsToLoad.add(piece.piece_id);
    return {
      ...piece,
      id: `${piece.piece_id}_${piece.y}_${piece.x}`,
      player_id: piece.player_number || 1,
      team: piece.player_number || 1,
      initial_x: piece.x,
      initial_y: piece.y,
      ends_game_on_checkmate: !!piece.ends_game_on_checkmate,
      ends_game_on_capture: !!piece.ends_game_on_capture,
      can_control_squares: !!piece.can_control_squares,
      manual_castling_partners: !!piece.manual_castling_partners,
      castling_partner_left_key: piece.castling_partner_left_key || null,
      castling_partner_right_key: piece.castling_partner_right_key || null,
      castling_distance: piece.castling_distance ?? 2,
      hit_points: piece.hit_points ?? 1,
      current_hp: piece.hit_points ?? 1,
      attack_damage: piece.attack_damage ?? 1,
      show_hp_ad: !!piece.show_hp_ad,
      hp_regen: piece.hp_regen ?? 0,
      cannot_be_captured: !!piece.cannot_be_captured,
      burn_damage: piece.burn_damage ?? 0,
      burn_duration: piece.burn_duration ?? 0,
      show_burn: !!piece.show_burn,
      burn_active_damage: 0,
      burn_active_turns: 0,
    };
  });

  // Hydrate movement / capture / range data from the pieces table.
  if (pieceIdsToLoad.size > 0) {
    const [pieceRows] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (?)`,
      [Array.from(pieceIdsToLoad)]
    );
    const pieceDataMap = {};
    pieceRows.forEach(p => { pieceDataMap[p.id] = p; });

    pieces = pieces.map(piece => {
      const full = pieceDataMap[piece.piece_id];
      if (!full) return piece;
      return {
        ...piece,
        piece_name: piece.piece_name || full.piece_name,
        // Movement
        directional_movement_style: full.directional_movement_style,
        up_movement: full.up_movement, down_movement: full.down_movement,
        left_movement: full.left_movement, right_movement: full.right_movement,
        up_left_movement: full.up_left_movement, up_right_movement: full.up_right_movement,
        down_left_movement: full.down_left_movement, down_right_movement: full.down_right_movement,
        up_movement_exact: full.up_movement_exact, down_movement_exact: full.down_movement_exact,
        left_movement_exact: full.left_movement_exact, right_movement_exact: full.right_movement_exact,
        up_left_movement_exact: full.up_left_movement_exact, up_right_movement_exact: full.up_right_movement_exact,
        down_left_movement_exact: full.down_left_movement_exact, down_right_movement_exact: full.down_right_movement_exact,
        ratio_movement_style: full.ratio_movement_style,
        ratio_movement_1: full.ratio_one_movement,
        ratio_movement_2: full.ratio_two_movement,
        repeating_movement: full.repeating_movement,
        repeating_ratio: full.repeating_ratio,
        max_ratio_iterations: full.max_ratio_iterations,
        repeating_capture: full.repeating_capture,
        repeating_ratio_capture: full.repeating_ratio_capture,
        max_ratio_capture_iterations: full.max_ratio_capture_iterations,
        step_movement_style: full.step_by_step_movement_style,
        step_movement_value: full.step_by_step_movement_value,
        can_hop_over_allies: full.can_hop_over_allies,
        can_hop_over_enemies: full.can_hop_over_enemies,
        exact_ratio_hop_only: full.exact_ratio_hop_only,
        directional_hop_disabled: full.directional_hop_disabled,
        can_hop_attack_over_allies: full.can_hop_attack_over_allies,
        can_hop_attack_over_enemies: full.can_hop_attack_over_enemies,
        // Capture
        can_capture_enemy_on_move: full.can_capture_enemy_on_move,
        attacks_like_movement: full.attacks_like_movement,
        up_capture: full.up_capture, down_capture: full.down_capture,
        left_capture: full.left_capture, right_capture: full.right_capture,
        up_left_capture: full.up_left_capture, up_right_capture: full.up_right_capture,
        down_left_capture: full.down_left_capture, down_right_capture: full.down_right_capture,
        up_capture_exact: full.up_capture_exact, down_capture_exact: full.down_capture_exact,
        left_capture_exact: full.left_capture_exact, right_capture_exact: full.right_capture_exact,
        up_left_capture_exact: full.up_left_capture_exact, up_right_capture_exact: full.up_right_capture_exact,
        down_left_capture_exact: full.down_left_capture_exact, down_right_capture_exact: full.down_right_capture_exact,
        ratio_capture_1: full.ratio_one_capture,
        ratio_capture_2: full.ratio_two_capture,
        step_capture_value: full.step_by_step_capture,
        // Stats
        piece_value: full.piece_value,
        is_royal: full.is_royal,
        can_promote: full.can_promote,
        can_castle: full.can_castle,
        has_checkmate_rule: full.has_checkmate_rule,
        special_scenario_moves: full.special_scenario_moves,
        special_scenario_captures: full.special_scenario_captures,
        // Ranged attacks
        can_capture_enemy_via_range: full.can_capture_enemy_via_range,
        up_attack_range: full.up_attack_range, down_attack_range: full.down_attack_range,
        left_attack_range: full.left_attack_range, right_attack_range: full.right_attack_range,
        up_left_attack_range: full.up_left_attack_range, up_right_attack_range: full.up_right_attack_range,
        down_left_attack_range: full.down_left_attack_range, down_right_attack_range: full.down_right_attack_range,
        up_attack_range_exact: full.up_attack_range_exact, down_attack_range_exact: full.down_attack_range_exact,
        left_attack_range_exact: full.left_attack_range_exact, right_attack_range_exact: full.right_attack_range_exact,
        up_left_attack_range_exact: full.up_left_attack_range_exact, up_right_attack_range_exact: full.up_right_attack_range_exact,
        down_left_attack_range_exact: full.down_left_attack_range_exact, down_right_attack_range_exact: full.down_right_attack_range_exact,
        ratio_one_attack_range: full.ratio_one_attack_range,
        ratio_two_attack_range: full.ratio_two_attack_range,
        step_by_step_attack_range: full.step_by_step_attack_value,
        max_piece_captures_per_ranged_attack: full.max_piece_captures_per_ranged_attack,
        can_fire_over_allies: full.can_fire_over_allies,
        can_fire_over_enemies: full.can_fire_over_enemies,
        can_en_passant: full.can_en_passant,
        capture_on_hop: full.capture_on_hop,
        chain_capture_enabled: full.chain_capture_enabled,
        chain_hop_allies: full.chain_hop_allies,
        max_chain_hops: full.max_chain_hops,
        free_move_after_promotion: full.free_move_after_promotion,
        promotion_pieces_ids: full.promotion_pieces_ids,
        piece_width: full.piece_width || 1,
        piece_height: full.piece_height || 1,
        can_capture_allies: full.can_capture_allies,
        custom_movement_squares: full.custom_movement_squares,
        custom_attack_squares: full.custom_attack_squares,
      };
    });
  }

  return { gameType, pieces };
}

/**
 * Validate a freshly-saved game type and return the same `{ decided, ... }`
 * result shape as `evaluateInitialPosition()`. Returns `{ decided: false }`
 * when no game type / no pieces are found (we can't validate a half-built
 * game so we don't block it).
 */
async function validateGameTypeInitialState(gameTypeId) {
  try {
    const { gameType, pieces } = await loadInitialStateForGameType(gameTypeId);
    if (!gameType || pieces.length === 0) return { decided: false };
    return evaluateInitialPosition(gameType, pieces);
  } catch (err) {
    console.error(`[initial-state] validateGameTypeInitialState(${gameTypeId}) failed:`, err);
    return { decided: false, error: err.message };
  }
}

/**
 * Validate a game type BEFORE inserting/updating it, by hydrating piece
 * data straight from the request body + the `pieces` table. Used by
 * POST /api/games/create and PUT /api/games/:id so we can reject a publish
 * without having to rollback an INSERT/UPDATE.
 *
 * @param {object} gameData The wizard's request body. Must include the
 *                          win-condition fields and `pieces_string` (object
 *                          format keyed by "y,x").
 * @returns {Promise<object>} `{ decided: false }` or the `evaluateInitialPosition` result.
 */
async function validateGameTypeFromRequestBody(gameData) {
  if (!gameData || !gameData.pieces_string) return { decided: false };

  // Parse placements from the wizard payload (object keyed by "y,x").
  let placements = [];
  try {
    const parsed = typeof gameData.pieces_string === 'string'
      ? JSON.parse(gameData.pieces_string)
      : gameData.pieces_string;
    if (Array.isArray(parsed)) {
      placements = parsed.filter(p => p && p.piece_id && !p._occupied && !p._anchorKey);
    } else if (parsed && typeof parsed === 'object') {
      placements = Object.entries(parsed)
        .filter(([, p]) => p && p.piece_id && !p._occupied && !p._anchorKey)
        .map(([key, p]) => {
          const [row, col] = key.split(',').map(Number);
          return { ...p, x: col, y: row };
        });
    }
  } catch (e) {
    return { decided: false };
  }
  if (placements.length === 0) return { decided: false };

  // Hydrate movement data from the pieces table.
  const pieceIds = Array.from(new Set(placements.map(p => p.piece_id).filter(Boolean)));
  if (pieceIds.length === 0) return { decided: false };
  let pieceRows = [];
  try {
    [pieceRows] = await db_pool.query(`SELECT * FROM pieces WHERE id IN (?)`, [pieceIds]);
  } catch (e) {
    return { decided: false };
  }
  const pieceDataMap = {};
  pieceRows.forEach(p => { pieceDataMap[p.id] = p; });

  const pieces = placements.map(p => {
    const full = pieceDataMap[p.piece_id] || {};
    const playerNum = Number(p.player_id ?? p.player_number ?? p.player ?? 1);
    return {
      ...full,
      ...p,
      id: `${p.piece_id}_${p.y}_${p.x}`,
      player_id: playerNum,
      team: playerNum,
      piece_name: p.piece_name || full.piece_name,
      initial_x: p.x,
      initial_y: p.y,
      ends_game_on_checkmate: !!p.ends_game_on_checkmate,
      ends_game_on_capture: !!p.ends_game_on_capture,
      can_control_squares: !!p.can_control_squares,
      hit_points: p.hit_points ?? 1,
      current_hp: p.hit_points ?? 1,
      attack_damage: p.attack_damage ?? 1,
      cannot_be_captured: !!p.cannot_be_captured,
      ratio_movement_1: full.ratio_one_movement,
      ratio_movement_2: full.ratio_two_movement,
      step_movement_style: full.step_by_step_movement_style,
      step_movement_value: full.step_by_step_movement_value,
      ratio_capture_1: full.ratio_one_capture,
      ratio_capture_2: full.ratio_two_capture,
      step_capture_value: full.step_by_step_capture,
      step_by_step_attack_range: full.step_by_step_attack_value,
      piece_width: full.piece_width || 1,
      piece_height: full.piece_height || 1,
    };
  });

  const gameType = {
    id: gameData.id,
    board_width: parseInt(gameData.board_width) || 8,
    board_height: parseInt(gameData.board_height) || 8,
    player_count: 2,
    actions_per_turn: parseInt(gameData.actions_per_turn) || 1,
    mate_condition: !!gameData.mate_condition,
    mate_piece: gameData.mate_piece ?? null,
    mate_condition_requires_all: !!gameData.mate_condition_requires_all,
    capture_condition: !!gameData.capture_condition,
    capture_piece: gameData.capture_piece ?? null,
    capture_condition_requires_all: !!gameData.capture_condition_requires_all,
    value_condition: !!gameData.value_condition,
    value_piece: gameData.value_piece ?? null,
    value_max: gameData.value_max ?? null,
    squares_condition: !!gameData.squares_condition,
    squares_count: gameData.squares_count ?? null,
    hill_condition: !!gameData.hill_condition,
    hill_x: gameData.hill_x ?? null,
    hill_y: gameData.hill_y ?? null,
    hill_turns: gameData.hill_turns ?? null,
    no_moves_condition: !!gameData.no_moves_condition,
    piece_count_condition: !!gameData.piece_count_condition,
    promotion_condition: !!gameData.promotion_condition,
    lose_all_pieces_condition: !!gameData.lose_all_pieces_condition,
    stalemate_win_condition: !!gameData.stalemate_win_condition,
    stalemate_draw_condition: gameData.stalemate_draw_condition === undefined ? true : !!gameData.stalemate_draw_condition,
    forced_capture_condition: !!gameData.forced_capture_condition,
    range_squares_string: gameData.range_squares_string || null,
    promotion_squares_string: gameData.promotion_squares_string || null,
    special_squares_string: gameData.special_squares_string || null,
    control_squares_string: gameData.control_squares_string || null,
    other_game_data: gameData.other_game_data || null,
  };

  try {
    return evaluateInitialPosition(gameType, pieces);
  } catch (err) {
    console.error('[initial-state] evaluateInitialPosition (request body) threw:', err.message);
    return { decided: false, error: err.message };
  }
}

/**
 * Persist (or clear) the warning text on `game_types`. Always updates the
 * `initial_state_checked_at` timestamp.
 */
async function writeInitialStateWarning(gameTypeId, warningTextOrNull) {
  try {
    await db_pool.query(
      `UPDATE game_types
          SET initial_state_warning = ?,
              initial_state_checked_at = NOW()
        WHERE id = ?`,
      [warningTextOrNull || null, gameTypeId]
    );
  } catch (err) {
    console.error(`[initial-state] writeInitialStateWarning(${gameTypeId}) failed:`, err.message);
  }
}

module.exports = {
  loadInitialStateForGameType,
  validateGameTypeInitialState,
  validateGameTypeFromRequestBody,
  writeInitialStateWarning,
};
