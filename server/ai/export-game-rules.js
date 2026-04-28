/**
 * Export a game type's full rule set to a JSON file the Rust trainer can
 * consume. Pulls from `game_types`, `pieces`, and `game_type_pieces` so the
 * trainer learns the *actual* rules players see — not generic chess.
 *
 * Output shape mirrors `ai-engine-rs/src/protocol.rs::RulesDoc`.
 */
const fs = require('fs');
const path = require('path');
const db_pool = require('../../configs/db');

const REPO_ROOT = path.resolve(__dirname, '../..');
const TRAINING_ROOT = path.join(REPO_ROOT, 'ai-training');

function trainingDirFor(gameTypeId) {
  return path.join(TRAINING_ROOT, String(gameTypeId));
}

function rulesPathFor(gameTypeId) {
  return path.join(trainingDirFor(gameTypeId), 'rules.json');
}

/**
 * Coerce DB tinyint/0/1/null fields to booleans so the Rust side gets the
 * shape it expects.
 */
function toBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    return lower === '1' || lower === 'true' || lower === 'yes';
  }
  return Boolean(v);
}

function intOr(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function exportGameRules(gameTypeId) {
  const id = parseInt(gameTypeId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`exportGameRules: invalid game_type_id ${gameTypeId}`);
  }

  const [gameRows] = await db_pool.query(
    'SELECT * FROM game_types WHERE id = ? LIMIT 1',
    [id],
  );
  if (gameRows.length === 0) {
    throw new Error(`game_type_id ${id} not found`);
  }
  const g = gameRows[0];

  // Pull every placement (game_type_pieces) row with its per-placement
  // overrides. Several gameplay flags — most importantly
  // `ends_game_on_checkmate` and `ends_game_on_capture` (what makes a King
  // royal in chess) — live on game_type_pieces, NOT on the pieces template.
  const [positions] = await db_pool.query(
    `SELECT
        gtp.id            AS gtp_id,
        gtp.piece_id,
        gtp.x, gtp.y,
        gtp.player_number,
        gtp.ends_game_on_checkmate,
        gtp.ends_game_on_capture,
        gtp.castling_distance,
        gtp.cannot_be_captured AS placement_cannot_be_captured,
        gtp.ghostwalk          AS placement_ghostwalk,
        gtp.die_on_capture     AS placement_die_on_capture,
        gtp.can_en_passant,
        gtp.can_control_squares,
        gtp.hit_points,
        gtp.attack_damage,
        gtp.can_promote_to_checkmate,
        gtp.can_promote_to_capture
     FROM game_type_pieces gtp
     WHERE gtp.game_type_id = ?`,
    [id],
  );

  // Distinct piece templates referenced.
  const uniquePieceIds = Array.from(new Set(positions.map((p) => p.piece_id)));
  let pieceRows = [];
  if (uniquePieceIds.length > 0) {
    const placeholders = uniquePieceIds.map(() => '?').join(',');
    const [rows] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${placeholders})`,
      uniquePieceIds,
    );
    pieceRows = rows;
  }
  const pieceById = new Map(pieceRows.map((r) => [r.id, r]));

  // Group placements by (piece_id + override-tuple) so that pieces with
  // identical placement-level flags share a single synthesized template.
  // The synthesized template's id is what `starting_positions` reference;
  // the in-game move generator only needs `pieces[].id` to match.
  const overrideTupleKey = (p) => [
    p.piece_id,
    p.ends_game_on_checkmate ? 1 : 0,
    p.ends_game_on_capture ? 1 : 0,
    p.castling_distance ?? '',
    p.placement_cannot_be_captured ? 1 : 0,
    p.placement_ghostwalk ? 1 : 0,
    p.can_en_passant ? 1 : 0,
    p.can_promote_to_checkmate ? 1 : 0,
    p.can_promote_to_capture ? 1 : 0,
  ].join('|');

  const groupKeyToVirtualId = new Map();
  // Use a high offset so virtual ids never collide with real piece ids.
  const VIRTUAL_ID_BASE = 1_000_000;
  let virtualSeq = 0;
  const pieces = []; // synthesized PieceTemplate rows
  for (const pos of positions) {
    const key = overrideTupleKey(pos);
    if (groupKeyToVirtualId.has(key)) continue;
    const tpl = pieceById.get(pos.piece_id);
    if (!tpl) continue;
    const virtualId = VIRTUAL_ID_BASE + (virtualSeq++);
    groupKeyToVirtualId.set(key, virtualId);
    // Merge placement overrides on top of the base template, preferring
    // placement values when they're set.
    const merged = {
      ...tpl,
      id: virtualId,
      // Original DB pieces.id this virtual template was derived from.
      // Carried through so the Rust opening-book recorder can key by the
      // user-visible piece type rather than the per-placement variant id.
      real_piece_id: pos.piece_id,
      // Royal flags (these don't exist on the pieces table at all).
      ends_game_on_checkmate: !!pos.ends_game_on_checkmate,
      ends_game_on_capture: !!pos.ends_game_on_capture,
      // Castling distance lives on the placement; fall back to template's
      // value if the placement didn't override it.
      castling_distance:
        pos.castling_distance != null ? pos.castling_distance : (tpl.castling_distance ?? 2),
      // OR-merge boolean flags that exist on both tables.
      cannot_be_captured: toBool(tpl.cannot_be_captured) || toBool(pos.placement_cannot_be_captured),
      ghostwalk: toBool(tpl.ghostwalk) || toBool(pos.placement_ghostwalk),
      // Per-placement override: die_on_capture forces the moving piece
      // to be removed when it captures (kamikaze-style). Live server
      // honors the placement value when set, otherwise the piece-template
      // default. Currently informational for the trainer (no special
      // logic in moves.rs yet) but exported so future ports can read it.
      die_on_capture: toBool(tpl.die_on_capture) || toBool(pos.placement_die_on_capture),
      // En passant: placement-level flag (from game_type_pieces.can_en_passant).
      // Pieces with this flag enabled can capture en passant and also create
      // en passant targets when making a first-move multi-square advance.
      can_en_passant: toBool(pos.can_en_passant),
      // Promotion gating: controls whether this piece may promote into a
      // royal/game-ending piece. Default false — must be explicitly opted in
      // via the game wizard (Step 4 → piece placement options).
      can_promote_to_checkmate: !!pos.can_promote_to_checkmate,
      can_promote_to_capture: !!pos.can_promote_to_capture,
    };
    pieces.push(merged);
  }
  // Each placement now references its synthesized variant via the virtual id.
  for (const pos of positions) {
    pos._virtual_id = groupKeyToVirtualId.get(overrideTupleKey(pos));
  }

  // Build a lookup: real piece DB id → first virtual id used in this export.
  // Needed to translate promotion_pieces_ids (which store real DB piece ids)
  // into the virtual template ids the Rust engine uses.
  const realIdToFirstVirtualId = new Map();
  for (const p of pieces) {
    const realId = p.real_piece_id ?? p.id;
    if (!realIdToFirstVirtualId.has(realId)) {
      realIdToFirstVirtualId.set(realId, p.id);
    }
  }

  // Build the document. Field names match protocol.rs exactly.
  const doc = {
    game: {
      id: g.id,
      game_name: g.game_name || '',
      board_width: intOr(g.board_width, 8),
      board_height: intOr(g.board_height, 8),
      player_count: intOr(g.player_count, 2),
      actions_per_turn: intOr(g.actions_per_turn, 1),
      simultaneous_turns: toBool(g.simultaneous_turns),
      simul_turns_clock_pause: toBool(g.simul_turns_clock_pause),
      simul_turns_draw_after_cancellations: intOr(g.simul_turns_draw_after_cancellations, 3),
      simul_turns_submit_mode: g.simul_turns_submit_mode || 'immediate',
      simul_turns_place_conflict: g.simul_turns_place_conflict || 'cancel',
      simul_turns_free_move_after_capture: g.simul_turns_free_move_after_capture || 'disable',
      simul_turns_simultaneous_capture_draw: g.simul_turns_simultaneous_capture_draw == null ? true : toBool(g.simul_turns_simultaneous_capture_draw),
      simul_turns_simultaneous_checkmate_draw: g.simul_turns_simultaneous_checkmate_draw == null ? true : toBool(g.simul_turns_simultaneous_checkmate_draw),
      mate_condition: toBool(g.mate_condition),
      mate_piece: g.mate_piece == null ? null : intOr(g.mate_piece, null),
      capture_condition: toBool(g.capture_condition),
      capture_piece: g.capture_piece == null ? null : intOr(g.capture_piece, null),
      value_condition: toBool(g.value_condition),
      value_piece: g.value_piece == null ? null : intOr(g.value_piece, null),
      value_max: g.value_max == null ? null : intOr(g.value_max, null),
      squares_condition: toBool(g.squares_condition),
      squares_count: g.squares_count == null ? null : intOr(g.squares_count, null),
      hill_condition: toBool(g.hill_condition),
      hill_x: g.hill_x == null ? null : intOr(g.hill_x, null),
      hill_y: g.hill_y == null ? null : intOr(g.hill_y, null),
      hill_turns: g.hill_turns == null ? null : intOr(g.hill_turns, null),
      draw_move_limit: g.draw_move_limit == null ? null : intOr(g.draw_move_limit, null),
      repetition_draw_count: g.repetition_draw_count == null ? null : intOr(g.repetition_draw_count, null),
      lose_all_pieces_condition: toBool(g.lose_all_pieces_condition),
      stalemate_win_condition: toBool(g.stalemate_win_condition),
      no_moves_condition: toBool(g.no_moves_condition),
      // forced-capture: live game enforces this in handleMove; the trainer
      // must too, otherwise self-play diverges from production rules and
      // produces an opening book / model that suggests illegal-at-runtime
      // lines. Skewed sampling is also a major source of spurious
      // stalemates in capture-heavy variants.
      forced_capture_condition: toBool(g.forced_capture_condition),
      // Promotion-as-win and capture-requires-all: both implemented in the
      // live server (game-socket.js) and required for the trainer to
      // produce models that match production behavior.
      promotion_condition: toBool(g.promotion_condition),
      capture_condition_requires_all: toBool(g.capture_condition_requires_all),
      // stalemate_draw_condition defaults to true (classic chess) when the
      // DB column is null/missing, matching the live-game default.
      stalemate_draw_condition: g.stalemate_draw_condition === false || g.stalemate_draw_condition === 0
        ? false
        : true,
      range_squares_string: g.range_squares_string || null,
      promotion_squares_string: g.promotion_squares_string || null,
      special_squares_string: g.special_squares_string || null,
      control_squares_string: g.control_squares_string || null,
    },
    pieces: pieces.map((p) => ({
      id: p.id,
      real_piece_id: intOr(p.real_piece_id, p.id),
      piece_name: p.piece_name || '',
      piece_value: intOr(p.piece_value, 1),
      piece_width: intOr(p.piece_width, 1),
      piece_height: intOr(p.piece_height, 1),

      directional_movement_style: toBool(p.directional_movement_style),
      repeating_movement: toBool(p.repeating_movement),
      max_directional_movement_iterations: intOr(p.max_directional_movement_iterations, 0),

      up_movement: intOr(p.up_movement, 0),
      down_movement: intOr(p.down_movement, 0),
      left_movement: intOr(p.left_movement, 0),
      right_movement: intOr(p.right_movement, 0),
      up_left_movement: intOr(p.up_left_movement, 0),
      up_right_movement: intOr(p.up_right_movement, 0),
      down_left_movement: intOr(p.down_left_movement, 0),
      down_right_movement: intOr(p.down_right_movement, 0),

      up_movement_exact: toBool(p.up_movement_exact),
      down_movement_exact: toBool(p.down_movement_exact),
      left_movement_exact: toBool(p.left_movement_exact),
      right_movement_exact: toBool(p.right_movement_exact),
      up_left_movement_exact: toBool(p.up_left_movement_exact),
      up_right_movement_exact: toBool(p.up_right_movement_exact),
      down_left_movement_exact: toBool(p.down_left_movement_exact),
      down_right_movement_exact: toBool(p.down_right_movement_exact),

      up_movement_available_for: intOr(p.up_movement_available_for, 0),
      down_movement_available_for: intOr(p.down_movement_available_for, 0),
      left_movement_available_for: intOr(p.left_movement_available_for, 0),
      right_movement_available_for: intOr(p.right_movement_available_for, 0),
      up_left_movement_available_for: intOr(p.up_left_movement_available_for, 0),
      up_right_movement_available_for: intOr(p.up_right_movement_available_for, 0),
      down_left_movement_available_for: intOr(p.down_left_movement_available_for, 0),
      down_right_movement_available_for: intOr(p.down_right_movement_available_for, 0),

      up_capture: intOr(p.up_capture, 0),
      down_capture: intOr(p.down_capture, 0),
      left_capture: intOr(p.left_capture, 0),
      right_capture: intOr(p.right_capture, 0),
      up_left_capture: intOr(p.up_left_capture, 0),
      up_right_capture: intOr(p.up_right_capture, 0),
      down_left_capture: intOr(p.down_left_capture, 0),
      down_right_capture: intOr(p.down_right_capture, 0),

      up_capture_exact: toBool(p.up_capture_exact),
      down_capture_exact: toBool(p.down_capture_exact),
      left_capture_exact: toBool(p.left_capture_exact),
      right_capture_exact: toBool(p.right_capture_exact),
      up_left_capture_exact: toBool(p.up_left_capture_exact),
      up_right_capture_exact: toBool(p.up_right_capture_exact),
      down_left_capture_exact: toBool(p.down_left_capture_exact),
      down_right_capture_exact: toBool(p.down_right_capture_exact),

      repeating_capture: toBool(p.repeating_capture),

      ratio_movement_style: toBool(p.ratio_movement_style),
      ratio_movement_1: intOr(p.ratio_one_movement, 0),
      ratio_movement_2: intOr(p.ratio_two_movement, 0),
      repeating_ratio: toBool(p.repeating_ratio),
      max_ratio_iterations: intOr(p.max_ratio_iterations, 1),

      // Step-by-step movement (checkers-king-style "up to N squares").
      // Negative value = no diagonals (Manhattan), positive = with diagonals
      // (Chebyshev). Zero / null means no step-by-step movement.
      step_by_step_movement_value:
        toBool(p.step_by_step_movement_style)
          ? intOr(p.step_by_step_movement_value, 0)
          : 0,
      step_by_step_capture: intOr(p.step_by_step_capture, 0),

      can_hop_over_allies: toBool(p.can_hop_over_allies),
      can_hop_over_enemies: toBool(p.can_hop_over_enemies),
      directional_hop_disabled: toBool(p.directional_hop_disabled),
      ghostwalk: toBool(p.ghostwalk),

      can_capture_enemy_on_move:
        p.can_capture_enemy_on_move == null ? true : toBool(p.can_capture_enemy_on_move),
      can_capture_allies: toBool(p.can_capture_allies),
      first_move_only: toBool(p.first_move_only),
      first_move_only_capture: toBool(p.first_move_only_capture),

      can_castle: toBool(p.can_castle),
      castling_distance: intOr(p.castling_distance, 2),

      can_promote: toBool(p.can_promote),
      // Map promotion target real piece ids → virtual ids used in this export.
      // promotion_pieces_ids is a JSON array of real piece DB ids in the DB.
      promotion_pieces_ids: (() => {
        let raw = p.promotion_pieces_ids;
        if (!raw) return [];
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch (e) { return []; }
        }
        if (!Array.isArray(raw)) return [];
        return raw.map((rid) => {
          const vid = realIdToFirstVirtualId.get(rid);
          return vid != null ? vid : null;
        }).filter((v) => v != null);
      })(),
      is_royal: toBool(p.is_royal),
      has_check_rule: toBool(p.has_check_rule),
      has_checkmate_rule: toBool(p.has_checkmate_rule),
      has_lose_on_capture_rule: toBool(p.has_lose_on_capture_rule),
      ends_game_on_capture: toBool(p.ends_game_on_capture),
      ends_game_on_checkmate: toBool(p.ends_game_on_checkmate),
      can_promote_to_checkmate: toBool(p.can_promote_to_checkmate),
      can_promote_to_capture: toBool(p.can_promote_to_capture),
      cannot_be_captured: toBool(p.cannot_be_captured),

      can_en_passant: toBool(p.can_en_passant),

      special_scenario_moves: p.special_scenario_moves || null,
      special_scenario_captures: p.special_scenario_captures || null,
      custom_movement_squares: p.custom_movement_squares || null,
      custom_attack_squares: p.custom_attack_squares || null,
    })),
    starting_positions: positions.map((sp) => ({
      // Reference the synthesized variant id so per-placement overrides
      // (royal flags, castling distance, etc.) follow the piece.
      piece_id: sp._virtual_id != null ? sp._virtual_id : sp.piece_id,
      x: intOr(sp.x, 0),
      y: intOr(sp.y, 0),
      player_number: intOr(sp.player_number, 1),
    })),
  };

  fs.mkdirSync(trainingDirFor(id), { recursive: true });
  const outPath = rulesPathFor(id);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  return { path: outPath, pieceCount: pieces.length, positionCount: positions.length };
}

module.exports = {
  exportGameRules,
  rulesPathFor,
  trainingDirFor,
  TRAINING_ROOT,
};
