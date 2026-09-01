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

// This must match Cargo.toml [package] version in ai-engine-rs/.
// Bump both together whenever a protocol.rs change breaks compatibility.
const TRAINER_VERSION = '1.3.0';
// Minimum binary version that can still train and upload. Bump this only when
// a protocol-breaking change requires users to get a new binary. As long as
// you only add optional fields, leave this at 1.0.0 so existing binaries keep
// working and just auto-update in the background.
const TRAINER_MIN_VERSION = '1.0.0';

const REPO_ROOT = path.resolve(__dirname, '../..');
// Allow the training data directory to live outside the repo so that git
// operations (fresh clone, clean, etc.) can never touch it.  Set
// TRAINING_DATA_DIR in .env on the server; leave unset for local dev.
const TRAINING_ROOT = process.env.TRAINING_DATA_DIR
  ? path.resolve(process.env.TRAINING_DATA_DIR)
  : path.join(REPO_ROOT, 'ai-training');

function trainingDirFor(gameTypeId) {
  return path.join(TRAINING_ROOT, String(gameTypeId));
}

function trainingRootDir() {
  return TRAINING_ROOT;
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
        gtp.die_on_capture_grants_win AS placement_die_on_capture_grants_win,
        gtp.cannot_move_outside_zone AS placement_cannot_move_outside_zone,
        gtp.can_en_passant,
        gtp.can_control_squares,
        gtp.hit_points,
        gtp.attack_damage,
        gtp.can_promote_to_checkmate,
        gtp.can_promote_to_capture,
        gtp.promotion_pieces_override,
        gtp.hp_regen,
        gtp.hit_points,
        gtp.attack_damage,
        gtp.burn_damage,
        gtp.burn_duration,
        gtp.trample              AS placement_trample,
        gtp.trample_radius       AS placement_trample_radius,
        gtp.attack_radius        AS placement_attack_radius,
        gtp.capture_points_gain,
        gtp.capture_points_loss,
        gtp.limit_promote_checkmate_to_original,
        gtp.limit_promote_capture_to_original,
        gtp.is_neutral
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
    p.placement_cannot_move_outside_zone ? 1 : 0,
    p.can_en_passant ? 1 : 0,
    p.can_promote_to_checkmate ? 1 : 0,
    p.can_promote_to_capture ? 1 : 0,
    p.placement_die_on_capture ? 1 : 0,
    p.can_control_squares ? 1 : 0,
    p.hit_points ?? '',
    p.attack_damage ?? '',
    p.hp_regen ?? '',
    p.burn_damage ?? '',
    p.burn_duration ?? '',
    p.placement_trample ? 1 : 0,
    p.placement_trample_radius ?? '',
    p.placement_attack_radius ?? '',
    p.capture_points_gain ?? '',
    p.capture_points_loss ?? '',
    p.limit_promote_checkmate_to_original ? 1 : 0,
    p.limit_promote_capture_to_original ? 1 : 0,
    p.disable_promotion ? 1 : 0,
    (() => {
      // Normalize promotion_pieces_override into a stable signature. Entries
      // may be plain IDs (legacy) or { id, player } objects (per-player /
      // neutral promotion). Encode id:player so distinct owner configs don't
      // merge into the same virtual template.
      let raw = p.promotion_pieces_override;
      if (!raw) return '';
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return ''; } }
      if (!Array.isArray(raw) || raw.length === 0) return '';
      return raw.map(entry => {
        if (entry != null && typeof entry === 'object') {
          const id = Number(entry.id != null ? entry.id : entry.piece_id);
          const player = entry.player != null ? Number(entry.player) : '';
          return Number.isFinite(id) ? `${id}:${player}` : '';
        }
        const id = Number(entry);
        return Number.isFinite(id) ? `${id}:` : '';
      }).filter(Boolean).sort().join(',');
    })(),
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
      die_on_capture_grants_win: toBool(tpl.die_on_capture_grants_win) || toBool(pos.placement_die_on_capture_grants_win),
      // Per-placement restriction zone: this piece can only move to squares marked asRestrictionZone.
      cannot_move_outside_zone: toBool(pos.placement_cannot_move_outside_zone),
      // En passant: placement-level flag (from game_type_pieces.can_en_passant).
      // Pieces with this flag enabled can capture en passant and also create
      // en passant targets when making a first-move multi-square advance.
      can_en_passant: toBool(pos.can_en_passant),
      // Promotion gating: controls whether this piece may promote into a
      // royal/game-ending piece. Default false — must be explicitly opted in
      // via the game wizard (Step 4 → piece placement options).
      can_promote_to_checkmate: !!pos.can_promote_to_checkmate,
      can_promote_to_capture: !!pos.can_promote_to_capture,
      // Per-placement promotion target override: if set, the Rust engine uses
      // these piece IDs instead of the piece-level promotion_pieces_ids list.
      promotion_pieces_override: pos.promotion_pieces_override ?? null,
      capture_points_gain: intOr(pos.capture_points_gain, 0),
      capture_points_loss: intOr(pos.capture_points_loss, 0),
      can_control_squares: toBool(pos.can_control_squares),
      hit_points: intOr(pos.hit_points, tpl.hit_points ?? 1) || 1,
      attack_damage: intOr(pos.attack_damage, tpl.attack_damage ?? 1) || 1,
      hp_regen: intOr(pos.hp_regen, tpl.hp_regen ?? 0),
      burn_damage: intOr(pos.burn_damage, tpl.burn_damage ?? 0),
      burn_duration: intOr(pos.burn_duration, tpl.burn_duration ?? 0),
      trample: toBool(pos.placement_trample) || toBool(tpl.trample),
      trample_radius: intOr(pos.placement_trample_radius, tpl.trample_radius ?? 0),
      attack_radius: intOr(pos.placement_attack_radius, tpl.attack_radius ?? 0),
      limit_promote_checkmate_to_original: toBool(pos.limit_promote_checkmate_to_original),
      limit_promote_capture_to_original: toBool(pos.limit_promote_capture_to_original),
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

  // Collect any piece IDs referenced in promotion_pieces_override or
  // promotion_pieces_ids that are NOT already in starting_positions.  These
  // are "off-board" promotion targets — pieces a player can promote into but
  // that don't start on the board.  We add them to `pieces` (so the Rust
  // engine knows their move templates) but NOT to `starting_positions`.
  const promotionOnlyRealIds = new Set();
  const parseIds = (raw) => {
    if (!raw) return [];
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return []; } }
    if (!Array.isArray(raw)) return [];
    // Entries may be plain IDs (legacy) or { id, player } objects.
    return raw.map(entry => {
      const id = (entry != null && typeof entry === 'object') ? (entry.id != null ? entry.id : entry.piece_id) : entry;
      return Number(id);
    }).filter(Number.isFinite);
  };
  for (const p of pieces) {
    for (const rid of parseIds(p.promotion_pieces_override)) {
      if (!realIdToFirstVirtualId.has(rid)) promotionOnlyRealIds.add(rid);
    }
    for (const rid of parseIds(p.promotion_pieces_ids)) {
      if (!realIdToFirstVirtualId.has(rid)) promotionOnlyRealIds.add(rid);
    }
  }
  if (promotionOnlyRealIds.size > 0) {
    const offBoardIds = Array.from(promotionOnlyRealIds);
    const placeholders = offBoardIds.map(() => '?').join(',');
    const [offBoardRows] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${placeholders})`,
      offBoardIds,
    );
    for (const tpl of offBoardRows) {
      const virtualId = VIRTUAL_ID_BASE + (virtualSeq++);
      realIdToFirstVirtualId.set(tpl.id, virtualId);
      pieces.push({
        ...tpl,
        id: virtualId,
        real_piece_id: tpl.id,
        // Off-board pieces have no per-placement overrides; use safe defaults.
        ends_game_on_checkmate: false,
        ends_game_on_capture: false,
        can_promote_to_checkmate: false,
        can_promote_to_capture: false,
        disable_promotion: false,
        cannot_be_captured: toBool(tpl.cannot_be_captured),
        ghostwalk: toBool(tpl.ghostwalk),
        die_on_capture: toBool(tpl.die_on_capture),
        die_on_capture_grants_win: toBool(tpl.die_on_capture_grants_win),
        cannot_move_outside_zone: false,
        can_en_passant: toBool(tpl.can_en_passant),
        can_control_squares: false,
        hop_stop_at_occupied: tpl.hop_stop_at_occupied != null ? toBool(tpl.hop_stop_at_occupied) : true,
        directional_hop_only: toBool(tpl.directional_hop_only),
        exact_ratio_hop_only: toBool(tpl.exact_ratio_hop_only),
        can_hop_attack_over_allies: toBool(tpl.can_hop_attack_over_allies),
        can_hop_attack_over_enemies: toBool(tpl.can_hop_attack_over_enemies),
        directional_hop_disabled_attack: toBool(tpl.directional_hop_disabled_attack),
        directional_hop_only_attack: toBool(tpl.directional_hop_only_attack),
        exact_ratio_hop_only_attack: toBool(tpl.exact_ratio_hop_only_attack),
        hop_stop_at_occupied_attack: tpl.hop_stop_at_occupied_attack != null ? toBool(tpl.hop_stop_at_occupied_attack) : true,
        chain_hop_allies: toBool(tpl.chain_hop_allies),
        capture_points_gain: 0,
        capture_points_loss: 0,
        hit_points: intOr(tpl.hit_points, 1) || 1,
        attack_damage: intOr(tpl.attack_damage, 1) || 1,
        hp_regen: intOr(tpl.hp_regen, 0),
        burn_damage: intOr(tpl.burn_damage, 0),
        burn_duration: intOr(tpl.burn_duration, 0),
        trample: toBool(tpl.trample),
        trample_radius: intOr(tpl.trample_radius, 0),
        attack_radius: intOr(tpl.attack_radius, 0),
        limit_promote_checkmate_to_original: false,
        limit_promote_capture_to_original: false,
        disable_promotion: false,
        promotion_pieces_override: null,
      });
    }
  }

  // Build the document. Field names match protocol.rs exactly.
  const doc = {
    game: {
      id: g.id,
      game_name: g.game_name || '',
      trainer_min_version: TRAINER_VERSION,
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
      veto_enabled: toBool(g.veto_enabled),
      veto_style: g.veto_style || 'preemptive',
      veto_per_turn_limit: intOr(g.veto_per_turn_limit, 1),
      veto_per_game_limit: g.veto_per_game_limit == null ? null : intOr(g.veto_per_game_limit, null),
      veto_disallow_placement: toBool(g.veto_disallow_placement),
      veto_disallow_promotion: toBool(g.veto_disallow_promotion),
      mate_condition: toBool(g.mate_condition),
      mate_condition_requires_all: toBool(g.mate_condition_requires_all),
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
      // Hidden-pieces fog of war + illegal-move-limit loss condition.
      // The bot cheats (sees the full board) so the trainer doesn't need
      // to model fog itself, but the loss condition must be honored so
      // self-play games can end via that path.
      hide_enemy_pieces: toBool(g.hide_enemy_pieces),
      illegal_move_limit: intOr(g.illegal_move_limit, 0),
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
      // Points win condition
      points_to_win: g.points_to_win == null ? null : intOr(g.points_to_win, null),
      starting_points_p1: intOr(g.starting_points_p1, 0),
      starting_points_p2: intOr(g.starting_points_p2, 0),
      draw_equal_points_at_turn: g.draw_equal_points_at_turn == null ? null : intOr(g.draw_equal_points_at_turn, null),
      draw_equal_points_consecutive: g.draw_equal_points_consecutive == null ? null : intOr(g.draw_equal_points_consecutive, null),
      range_squares_string: g.range_squares_string || null,
      promotion_squares_string: g.promotion_squares_string || null,
      special_squares_string: g.special_squares_string || null,
      control_squares_string: g.control_squares_string || null,
      global_hp_regen: (() => {
        try {
          const ogd = g.other_game_data ? JSON.parse(g.other_game_data) : {};
          return intOr(ogd.global_hp_regen, 0);
        } catch { return 0; }
      })(),
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
      step_by_step_movement_value: intOr(p.step_by_step_movement_value, 0),
      step_by_step_capture: intOr(p.step_by_step_capture, 0),

      can_hop_over_allies: toBool(p.can_hop_over_allies),
      can_hop_over_enemies: toBool(p.can_hop_over_enemies),
      hop_stop_at_occupied: p.hop_stop_at_occupied != null ? toBool(p.hop_stop_at_occupied) : true,
      directional_hop_disabled: toBool(p.directional_hop_disabled),
      directional_hop_only: toBool(p.directional_hop_only),
      exact_ratio_hop_only: toBool(p.exact_ratio_hop_only),
      can_hop_attack_over_allies: toBool(p.can_hop_attack_over_allies),
      can_hop_attack_over_enemies: toBool(p.can_hop_attack_over_enemies),
      directional_hop_disabled_attack: toBool(p.directional_hop_disabled_attack),
      directional_hop_only_attack: toBool(p.directional_hop_only_attack),
      exact_ratio_hop_only_attack: toBool(p.exact_ratio_hop_only_attack),
      hop_stop_at_occupied_attack: p.hop_stop_at_occupied_attack != null ? toBool(p.hop_stop_at_occupied_attack) : true,
      chain_hop_allies: toBool(p.chain_hop_allies),
      ghostwalk: toBool(p.ghostwalk),
      min_turns_per_move: intOr(p.min_turns_per_move, 0),

      can_capture_enemy_on_move:
        p.can_capture_enemy_on_move == null ? true : toBool(p.can_capture_enemy_on_move),
      can_capture_allies: toBool(p.can_capture_allies),
      first_move_only: toBool(p.first_move_only),
      first_move_only_capture: toBool(p.first_move_only_capture),

      can_castle: toBool(p.can_castle),
      castling_distance: intOr(p.castling_distance, 2),

      can_promote: toBool(p.can_promote),
      // Map promotion target real piece ids → virtual ids used in this export.
      // Prefer per-placement promotion_pieces_override (set in game wizard
      // Step 4) over the piece-level promotion_pieces_ids default, mirroring
      // how getPromotionOptions prioritises the override in game-socket.js.
      // Both fields store real DB piece ids; we translate to virtual ids here.
      promotion_pieces_ids: (() => {
        let raw = p.promotion_pieces_override || p.promotion_pieces_ids;
        if (!raw) return [];
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch (e) { return []; }
        }
        if (!Array.isArray(raw)) return [];
        return raw.map((rid) => {
          const vid = realIdToFirstVirtualId.get(Number(rid));
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
      disable_promotion: toBool(p.disable_promotion),
      cannot_be_captured: toBool(p.cannot_be_captured),

      can_en_passant: toBool(p.can_en_passant),

      die_on_capture: toBool(p.die_on_capture),
      die_on_capture_grants_win: toBool(p.die_on_capture_grants_win),
      cannot_move_outside_zone: toBool(p.cannot_move_outside_zone),
      can_control_squares: toBool(p.can_control_squares),
      hit_points: intOr(p.hit_points, 1) || 1,
      attack_damage: intOr(p.attack_damage, 1) || 1,
      hp_regen: intOr(p.hp_regen, 0),
      capture_points_gain: intOr(p.capture_points_gain, 0),
      capture_points_loss: intOr(p.capture_points_loss, 0),
      burn_damage: intOr(p.burn_damage, 0),
      burn_duration: intOr(p.burn_duration, 0),
      capture_actions_per_turn: intOr(p.capture_actions_per_turn, 1) || 1,
      ranged_capture_actions_per_turn: intOr(p.ranged_capture_actions_per_turn, 1) || 1,
      trample: toBool(p.trample),
      trample_radius: intOr(p.trample_radius, 0),
      attack_radius: intOr(p.attack_radius, 0),
      limit_promote_checkmate_to_original: toBool(p.limit_promote_checkmate_to_original),
      limit_promote_capture_to_original: toBool(p.limit_promote_capture_to_original),

      special_scenario_moves: p.special_scenario_moves || null,
      special_scenario_captures: p.special_scenario_captures || null,

      // Ranged attack fields
      can_capture_enemy_via_range: toBool(p.can_capture_enemy_via_range),
      up_attack_range: intOr(p.up_attack_range, 0),
      down_attack_range: intOr(p.down_attack_range, 0),
      left_attack_range: intOr(p.left_attack_range, 0),
      right_attack_range: intOr(p.right_attack_range, 0),
      up_left_attack_range: intOr(p.up_left_attack_range, 0),
      up_right_attack_range: intOr(p.up_right_attack_range, 0),
      down_left_attack_range: intOr(p.down_left_attack_range, 0),
      down_right_attack_range: intOr(p.down_right_attack_range, 0),
      up_attack_range_exact: toBool(p.up_attack_range_exact),
      down_attack_range_exact: toBool(p.down_attack_range_exact),
      left_attack_range_exact: toBool(p.left_attack_range_exact),
      right_attack_range_exact: toBool(p.right_attack_range_exact),
      up_left_attack_range_exact: toBool(p.up_left_attack_range_exact),
      up_right_attack_range_exact: toBool(p.up_right_attack_range_exact),
      down_left_attack_range_exact: toBool(p.down_left_attack_range_exact),
      down_right_attack_range_exact: toBool(p.down_right_attack_range_exact),
      ratio_one_attack_range: intOr(p.ratio_one_attack_range, 0),
      ratio_two_attack_range: intOr(p.ratio_two_attack_range, 0),
      // Combined step-by-step ranged attack: negative = orthogonal-only (Manhattan), positive = with diagonals (Chebyshev)
      step_by_step_attack_range: (p.step_by_step_attack_value != null && p.step_by_step_attack_value !== 0)
        ? (toBool(p.step_by_step_attack_style) ? -Math.abs(intOr(p.step_by_step_attack_value, 0)) : intOr(p.step_by_step_attack_value, 0))
        : 0,
      can_fire_over_allies: toBool(p.can_fire_over_allies),
      can_fire_over_enemies: toBool(p.can_fire_over_enemies),

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
      is_neutral: toBool(sp.is_neutral),
    })),
  };

  fs.mkdirSync(trainingDirFor(id), { recursive: true });
  const outPath = rulesPathFor(id);

  // Guard: never overwrite an existing valid rules.json with empty data.
  // This protects production-downloaded rule files from being silently wiped
  // when a game type's settings are edited on a local server that has no
  // game_type_pieces rows for that game (e.g. a "remote training only" game
  // that was imported by name but whose pieces only exist on production).
  if (positions.length === 0) {
    throw new Error(
      `exportGameRules: game ${id} has no game_type_pieces rows — ` +
      `refusing to overwrite existing rules.json with empty data. ` +
      `Add pieces to the game in the wizard, or re-import from production.`,
    );
  }

  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  return { path: outPath, pieceCount: pieces.length, positionCount: positions.length };
}

module.exports = {
  exportGameRules,
  rulesPathFor,
  trainingDirFor,
  trainingRootDir,
  TRAINING_ROOT,
  TRAINER_VERSION,
  TRAINER_MIN_VERSION,
};
