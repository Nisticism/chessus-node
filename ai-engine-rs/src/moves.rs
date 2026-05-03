//! Move generation, mirroring `getPossibleMovesForPiece` in
//! `server/game-socket.js`. The JS source is the spec â€” when behavior
//! diverges, fix this file.
//!
//! Coverage matches the JS function (which is what the existing AI sees):
//!   * 8-direction movement & capture (with `_exact`, `_available_for`,
//!     `repeating_movement`, `repeating_capture`)
//!   * capture-only directions (pawn-style diagonals)
//!   * additional movements from `special_scenario_moves.additionalMovements`
//!   * ratio (knight) jumps with selective hopping + `repeating_ratio`
//!   * castling with both partners, `castling_distance`, close-range hop,
//!     and check-aware path checks
//!   * `custom_movement_squares` and `custom_attack_squares` (player-2 flipped)
//!   * multi-tile fit/clear filter
//!   * range-square bonus, custom-square `restrictFirstMoveToCustom` /
//!     `disableFirstMoveHere` first-move blockers
//!   * legal-move filtering: drop any move that leaves a royal/check piece
//!     in check (only enforced when at least one of our pieces has
//!     `has_check_rule` or `is_royal`)
//!
//! Not yet ported (matches what the existing JS AI ignores):
//!   * step-by-step movement (it's a predicate, not enumerated)
//!   * standalone ranged attacks (HP/AD multi-strike combat)

use crate::board::{Board, Coord, Move, PieceOnBoard};
use crate::rules::{PieceTemplate, Rules};
use serde_json::Value;
use std::collections::HashMap;

/// Cardinal directions, in JS order: up, down, left, right,
/// up_left, up_right, down_left, down_right.
const DIR_NAMES: [&str; 8] = [
    "up", "down", "left", "right",
    "up_left", "up_right", "down_left", "down_right",
];

fn dir_vec(name: &str, is_player2: bool) -> (i32, i32) {
    // Player 1 (top): "up" = -y, "down" = +y.
    // Player 2 (bottom) flips vertical only.
    let (dx, dy) = match name {
        "up" => (0, -1),
        "down" => (0, 1),
        "left" => (-1, 0),
        "right" => (1, 0),
        "up_left" => (-1, -1),
        "up_right" => (1, -1),
        "down_left" => (-1, 1),
        "down_right" => (1, 1),
        _ => (0, 0),
    };
    if is_player2 { (dx, -dy) } else { (dx, dy) }
}

// ---------- field accessors ----------

fn directional_movement(p: &PieceTemplate, dir: &str) -> i32 {
    match dir {
        "up" => p.up_movement,
        "down" => p.down_movement,
        "left" => p.left_movement,
        "right" => p.right_movement,
        "up_left" => p.up_left_movement,
        "up_right" => p.up_right_movement,
        "down_left" => p.down_left_movement,
        "down_right" => p.down_right_movement,
        _ => 0,
    }
}

fn directional_movement_exact(p: &PieceTemplate, dir: &str) -> bool {
    match dir {
        "up" => p.up_movement_exact,
        "down" => p.down_movement_exact,
        "left" => p.left_movement_exact,
        "right" => p.right_movement_exact,
        "up_left" => p.up_left_movement_exact,
        "up_right" => p.up_right_movement_exact,
        "down_left" => p.down_left_movement_exact,
        "down_right" => p.down_right_movement_exact,
        _ => false,
    }
}

fn directional_movement_available_for(p: &PieceTemplate, dir: &str) -> i32 {
    match dir {
        "up" => p.up_movement_available_for,
        "down" => p.down_movement_available_for,
        "left" => p.left_movement_available_for,
        "right" => p.right_movement_available_for,
        "up_left" => p.up_left_movement_available_for,
        "up_right" => p.up_right_movement_available_for,
        "down_left" => p.down_left_movement_available_for,
        "down_right" => p.down_right_movement_available_for,
        _ => 0,
    }
}

fn directional_capture(p: &PieceTemplate, dir: &str) -> i32 {
    match dir {
        "up" => p.up_capture,
        "down" => p.down_capture,
        "left" => p.left_capture,
        "right" => p.right_capture,
        "up_left" => p.up_left_capture,
        "up_right" => p.up_right_capture,
        "down_left" => p.down_left_capture,
        "down_right" => p.down_right_capture,
        _ => 0,
    }
}

fn directional_capture_exact(p: &PieceTemplate, dir: &str) -> bool {
    match dir {
        "up" => p.up_capture_exact,
        "down" => p.down_capture_exact,
        "left" => p.left_capture_exact,
        "right" => p.right_capture_exact,
        "up_left" => p.up_left_capture_exact,
        "up_right" => p.up_right_capture_exact,
        "down_left" => p.down_left_capture_exact,
        "down_right" => p.down_right_capture_exact,
        _ => false,
    }
}

// ---------- special-square helpers ----------

/// Mirrors `shouldBlockFirstMoveAbilities`. The `piece` here is the
/// on-board piece (we need its x/y).
fn should_block_first_move_abilities(p: &PieceOnBoard, rules: &Rules) -> bool {
    // disableFirstMoveHere: block all first-N-move abilities on this square.
    if rules.disable_first_move_here_squares.contains(&(p.x, p.y)) {
        return true;
    }
    // restrictFirstMoveToCustom: when any such square exists, first-N-move
    // abilities are only allowed from those squares.
    if !rules.restrict_first_move_to_custom_squares.is_empty() {
        return !rules.restrict_first_move_to_custom_squares.contains(&(p.x, p.y));
    }
    false
}

fn boost_value(v: i32, bonus: i32) -> i32 {
    if v == 0 || v == 99 { v }
    else if v < 0 { v - bonus }
    else { v + bonus }
}

fn apply_range_bonus_to_template(tpl: &PieceTemplate, bonus: i32) -> PieceTemplate {
    let mut t = tpl.clone();
    macro_rules! b { ($f:ident) => { t.$f = boost_value(t.$f, bonus); }; }
    b!(up_movement); b!(down_movement); b!(left_movement); b!(right_movement);
    b!(up_left_movement); b!(up_right_movement); b!(down_left_movement); b!(down_right_movement);
    b!(up_capture); b!(down_capture); b!(left_capture); b!(right_capture);
    b!(up_left_capture); b!(up_right_capture); b!(down_left_capture); b!(down_right_capture);
    b!(ratio_movement_1); b!(ratio_movement_2);

    // Boost additionalMovements / additionalCaptures values inside the JSON blob.
    if let Some(s) = &t.special_scenario_moves {
        if let Ok(mut v) = serde_json::from_str::<Value>(s) {
            for key in ["additionalMovements", "additionalCaptures"] {
                if let Some(obj) = v.get_mut(key).and_then(|x| x.as_object_mut()) {
                    for (_dir, opts) in obj.iter_mut() {
                        if let Some(arr) = opts.as_array_mut() {
                            for opt in arr.iter_mut() {
                                let infinite = opt.get("infinite").and_then(|x| x.as_bool()).unwrap_or(false);
                                let val = opt.get("value").and_then(|x| x.as_i64()).unwrap_or(0);
                                if infinite || val == 0 { continue; }
                                opt["value"] = Value::from(val + bonus as i64);
                            }
                        }
                    }
                }
            }
            t.special_scenario_moves = Some(v.to_string());
        }
    }
    t
}

// ---------- board queries ----------

/// Find the piece whose footprint covers square (x, y).
/// Accounts for multi-tile pieces: a 2×2 piece at anchor (3,3) matches
/// queries at (3,3), (4,3), (3,4), and (4,4).
fn piece_occupying<'a>(board: &'a Board, rules: &Rules, x: i32, y: i32) -> Option<&'a PieceOnBoard> {
    board.pieces.iter().find(|p| {
        let (pw, ph) = rules.piece(p.piece_id)
            .map(|t| (t.piece_width.max(1), t.piece_height.max(1)))
            .unwrap_or((1, 1));
        x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph
    })
}

fn piece_occupying_excluding<'a>(board: &'a Board, rules: &Rules, x: i32, y: i32, exclude_id: u32) -> Option<&'a PieceOnBoard> {
    board.pieces.iter().find(|p| {
        if p.id == exclude_id { return false; }
        let (pw, ph) = rules.piece(p.piece_id)
            .map(|t| (t.piece_width.max(1), t.piece_height.max(1)))
            .unwrap_or((1, 1));
        x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph
    })
}

fn cannot_be_captured(rules: &Rules, target: &PieceOnBoard) -> bool {
    rules.piece(target.piece_id).map(|t| t.cannot_be_captured).unwrap_or(false)
}

fn can_hop_over(
    target: &PieceOnBoard,
    mover_player: i32,
    mover: &PieceTemplate,
) -> bool {
    if mover.ghostwalk { return true; }
    let same = target.player == mover_player;
    if same { mover.can_hop_over_allies } else { mover.can_hop_over_enemies }
}

fn is_path_clear(
    board: &Board,
    rules: &Rules,
    mover: &PieceOnBoard,
    tpl: &PieceTemplate,
    to_x: i32, to_y: i32,
    allow_hop: bool,
    effective_player: i32,
) -> bool {
    if tpl.ghostwalk { return true; }
    let pw = tpl.piece_width.max(1);
    let ph = tpl.piece_height.max(1);
    let step_x = (to_x - mover.x).signum();
    let step_y = (to_y - mover.y).signum();
    for sdy in 0..ph {
        for sdx in 0..pw {
            let mut x = mover.x + sdx + step_x;
            let mut y = mover.y + sdy + step_y;
            while x != to_x + sdx || y != to_y + sdy {
                // Impassable squares always block the path (no hopping through them).
                if !rules.impassable_squares.is_empty()
                    && rules.impassable_squares.contains(&(x, y))
                {
                    return false;
                }
                if let Some(blocker) = piece_occupying_excluding(board, rules, x, y, mover.id) {
                    if !allow_hop || !can_hop_over(blocker, effective_player, tpl) {
                        return false;
                    }
                }
                x += step_x;
                y += step_y;
            }
        }
    }
    true
}

fn does_piece_fit_on_board(x: i32, y: i32, w: i32, h: i32, bw: i32, bh: i32) -> bool {
    x >= 0 && y >= 0 && x + w <= bw && y + h <= bh
}

fn is_destination_clear(
    board: &Board,
    rules: &Rules,
    mover: &PieceOnBoard,
    tpl: &PieceTemplate,
    to_x: i32, to_y: i32,
    effective_player: i32,
) -> bool {
    let pw = tpl.piece_width.max(1);
    let ph = tpl.piece_height.max(1);
    for sdy in 0..ph {
        for sdx in 0..pw {
            if let Some(o) = piece_occupying_excluding(board, rules, to_x + sdx, to_y + sdy, mover.id) {
                if o.player == effective_player { return false; }
                if cannot_be_captured(rules, o) { return false; }
            }
        }
    }
    true
}

// ---------- main move generator ----------

/// Pseudo-legal moves for a single piece, mirroring
/// `getPossibleMovesForPiece`.
pub fn moves_for(board: &Board, rules: &Rules, mover: &PieceOnBoard) -> Vec<Move> {
    let raw_tpl = match rules.piece(mover.piece_id) {
        Some(t) => t.clone(),
        None => return vec![],
    };

    // Range-square bonus (pre-cached in rules to avoid per-call JSON parsing).
    let tpl = if let Some(&bonus) = rules.range_square_bonuses.get(&(mover.x, mover.y)) {
        apply_range_bonus_to_template(&raw_tpl, bonus)
    } else {
        raw_tpl
    };

    let bw = board.width;
    let bh = board.height;
    let in_bounds = |x: i32, y: i32| x >= 0 && y >= 0 && x < bw && y < bh;
    let is_player2 = mover.player == 2;
    // For neutral pieces (player == 0), use the active side as the effective
    // owner so they cannot capture friendly pieces or be blocked by them.
    // Keep is_player2 = false for neutral (consistent with JS getPossibleMovesForPiece
    // where pieceOwner=0 means isPlayer2=false regardless of who is moving).
    let effective_player = if mover.is_neutral { board.turn } else { mover.player };

    // Minimum game-ply restriction: piece cannot move until this many half-moves
    // have been played (board.ply counts every half-move from game start).
    if tpl.min_turns_per_move > 0 && board.ply < tpl.min_turns_per_move as u32 {
        return vec![];
    }

    let block_first_move = should_block_first_move_abilities(mover, rules);
    let move_count = mover.move_count as i32;
    let global_first_move_block = tpl.first_move_only && (move_count > 0 || block_first_move);
    let global_first_move_capture_block = tpl.first_move_only_capture && (move_count > 0 || block_first_move);

    let has_any_capture_dir = DIR_NAMES.iter().any(|d| directional_capture(&tpl, d) != 0);

    let mut out: Vec<Move> = Vec::new();
    let push = |out: &mut Vec<Move>, to_x: i32, to_y: i32, capture: Option<u32>| {
        out.push(Move {
            piece_id: mover.id,
            from: Coord { x: mover.x, y: mover.y },
            to: Coord { x: to_x, y: to_y },
            capture,
            partner: None,
            is_castling: false,
            is_promotion: false,
            promote_to: None,
            creates_en_passant: false,
            hp_damage: if capture.is_some() { tpl.attack_damage.max(1) } else { 0 },
            attacker_dies: tpl.die_on_capture && capture.is_some(),
            has_trample: tpl.trample,
            trample_radius: tpl.trample_radius,
            area_radius: tpl.attack_radius,
            burn_damage: tpl.burn_damage,
            burn_duration: tpl.burn_duration,
        });
    };

    // -------- directional & capture-only generator --------
    let check_dir = |
        out: &mut Vec<Move>,
        dx: i32, dy: i32,
        max_dist_signed: i32,
        dir_name: Option<&str>,
        exact_flag: bool,
        repeating: bool,
        capture_only: bool,
    | {
        if max_dist_signed == 0 { return; }
        if global_first_move_block { return; }

        // Per-direction first-N gating.
        if let Some(name) = dir_name {
            let avail = directional_movement_available_for(&tpl, name);
            if avail > 0 {
                if move_count >= avail { return; }
                if block_first_move { return; }
            }
        }

        // If the piece has dedicated capture directions, only allow capturing in
        // directions that have a non-zero capture value (pawns).
        let can_capture_in_dir = capture_only || !has_any_capture_dir || dir_name.is_none() || {
            dir_name.map(|n| directional_capture(&tpl, n) != 0).unwrap_or(true)
        };

        let dir_hop_allowed = tpl.ghostwalk
            || ((tpl.can_hop_over_allies || tpl.can_hop_over_enemies)
                && (!tpl.directional_hop_disabled || exact_flag));

        let abs_md = max_dist_signed.unsigned_abs() as i32;
        let limit = if max_dist_signed == 99 { bw.max(bh) } else { abs_md };
        let exact_dist = if exact_flag { abs_md } else { 0 };
        let max_iter = if exact_flag && repeating { bw.max(bh) } else { limit };

        for dist in 1..=max_iter {
            let tx = mover.x + dx * dist;
            let ty = mover.y + dy * dist;
            if !in_bounds(tx, ty) { break; }
            // Impassable squares: cannot move to or slide through them.
            if !tpl.ghostwalk
                && !rules.impassable_squares.is_empty()
                && rules.impassable_squares.contains(&(tx, ty))
            { break; }
            if !is_path_clear(board, rules, mover, &tpl, tx, ty, dir_hop_allowed, effective_player) { break; }

            if let Some(target) = piece_occupying(board, rules, tx, ty) {
                let is_landing = if exact_flag {
                    if repeating { exact_dist != 0 && dist % exact_dist == 0 }
                    else { dist == exact_dist }
                } else { true };
                if is_landing && !cannot_be_captured(rules, target) {
                    if target.player != effective_player
                        && tpl.can_capture_enemy_on_move
                        && can_capture_in_dir
                        && !global_first_move_capture_block
                    {
                        push(out, tx, ty, Some(target.id));
                    } else if target.player == effective_player && tpl.can_capture_allies {
                        push(out, tx, ty, Some(target.id));
                    }
                }
                if !dir_hop_allowed || !can_hop_over(target, effective_player, &tpl) { break; }
            } else {
                let is_landing = if exact_flag {
                    if repeating { exact_dist != 0 && dist % exact_dist == 0 }
                    else { dist == exact_dist }
                } else { true };
                if is_landing && !capture_only {
                    push(out, tx, ty, None);
                }
            }
        }
    };

    // -------- standard 8-direction movement --------
    let rep_m = tpl.repeating_movement;
    for d in DIR_NAMES {
        let v = directional_movement(&tpl, d);
        if v == 0 { continue; }
        let (dx, dy) = dir_vec(d, is_player2);
        let exact = directional_movement_exact(&tpl, d);
        // Track en passant creation for first-N restricted multi-square directional moves.
        let avail = directional_movement_available_for(&tpl, d);
        if tpl.can_en_passant && move_count == 0 && avail > 0 && v.abs() > 1 {
            let before = out.len();
            check_dir(&mut out, dx, dy, v, Some(d), exact, rep_m && exact, false);
            for mv in out[before..].iter_mut() {
                let dist_y = (mv.to.y - mv.from.y).abs();
                let dist_x = (mv.to.x - mv.from.x).abs();
                if dist_y > 1 || dist_x > 1 {
                    mv.creates_en_passant = true;
                }
            }
        } else {
            check_dir(&mut out, dx, dy, v, Some(d), exact, rep_m && exact, false);
        }
    }

    // -------- additionalMovements from special_scenario_moves --------
    if let Some(s) = &tpl.special_scenario_moves {
        if let Ok(parsed) = serde_json::from_str::<Value>(s) {
            if let Some(am) = parsed.get("additionalMovements").and_then(|v| v.as_object()) {
                for (dir, opts) in am {
                    let (dx, dy) = dir_vec(dir, is_player2);
                    if dx == 0 && dy == 0 { continue; }
                    if let Some(arr) = opts.as_array() {
                        for opt in arr {
                            let avail = opt.get("availableForMoves").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
                            let first_only = opt.get("firstMoveOnly").and_then(|x| x.as_bool()).unwrap_or(false);
                            if avail > 0 && move_count >= avail { continue; }
                            if first_only && move_count > 0 { continue; }
                            if block_first_move && (avail > 0 || first_only) { continue; }

                            let mut max_dist = opt.get("value").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
                            let infinite = opt.get("infinite").and_then(|x| x.as_bool()).unwrap_or(false);
                            let exact = opt.get("exact").and_then(|x| x.as_bool()).unwrap_or(false);
                            if infinite { max_dist = 99; }
                            if exact { max_dist = -max_dist.abs(); }
                            if max_dist != 0 {
                                // Mark creates_en_passant for first-move multi-square advances.
                                let is_first_move_multi =
                                    tpl.can_en_passant
                                    && move_count == 0
                                    && (avail > 0 || first_only)
                                    && max_dist.abs() > 1;
                                if is_first_move_multi {
                                    let before = out.len();
                                    check_dir(&mut out, dx, dy, max_dist, Some(dir), exact, false, false);
                                    for mv in out[before..].iter_mut() {
                                        let dist_y = (mv.to.y - mv.from.y).abs();
                                        let dist_x = (mv.to.x - mv.from.x).abs();
                                        if dist_y > 1 || dist_x > 1 {
                                            mv.creates_en_passant = true;
                                        }
                                    }
                                } else {
                                    check_dir(&mut out, dx, dy, max_dist, Some(dir), exact, false, false);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // -------- capture-only directions --------
    if has_any_capture_dir {
        let rep_c = tpl.repeating_capture;
        for d in DIR_NAMES {
            let cap = directional_capture(&tpl, d);
            let mov = directional_movement(&tpl, d);
            if cap == 0 || mov != 0 { continue; }
            let (dx, dy) = dir_vec(d, is_player2);
            let exact = directional_capture_exact(&tpl, d);
            check_dir(&mut out, dx, dy, cap, None, exact, rep_c && exact, true);
        }
    }

    // -------- ratio (knight) jumps --------
    let r1 = tpl.ratio_movement_1;
    let r2 = tpl.ratio_movement_2;
    if r1 > 0 && r2 > 0 {
        let ratio_offsets: [(i32, i32); 8] = [
            (r1, r2), (r1, -r2), (-r1, r2), (-r1, -r2),
            (r2, r1), (r2, -r1), (-r2, r1), (-r2, -r1),
        ];
        let no_hop = !tpl.ghostwalk && !tpl.can_hop_over_allies && !tpl.can_hop_over_enemies;
        for (dx, dy) in ratio_offsets.iter().copied() {
            let tx = mover.x + dx;
            let ty = mover.y + dy;
            if !in_bounds(tx, ty) { continue; }
            if !ratio_path_ok(board, rules, mover, &tpl, dx, dy, tx, ty, no_hop, effective_player) { continue; }
            if let Some(target) = piece_occupying(board, rules, tx, ty) {
                if !cannot_be_captured(rules, target) {
                    if target.player != effective_player && tpl.can_capture_enemy_on_move {
                        push(&mut out, tx, ty, Some(target.id));
                    } else if target.player == effective_player && tpl.can_capture_allies {
                        push(&mut out, tx, ty, Some(target.id));
                    }
                }
            } else {
                push(&mut out, tx, ty, None);
            }
        }
        // Repeating ratio: multiples of each L-jump.
        if tpl.repeating_ratio {
            let max_k = if tpl.max_ratio_iterations == -1 {
                bw.max(bh)
            } else {
                tpl.max_ratio_iterations.max(1)
            };
            for (dx, dy) in ratio_offsets.iter().copied() {
                for k in 2..=max_k {
                    let tx = mover.x + dx * k;
                    let ty = mover.y + dy * k;
                    if !in_bounds(tx, ty) { break; }
                    if !tpl.ghostwalk {
                        let mut intermediates_clear = true;
                        for j in 1..k {
                            let ix = mover.x + dx * j;
                            let iy = mover.y + dy * j;
                            if let Some(b) = piece_occupying_excluding(board, rules, ix, iy, mover.id) {
                                let _ = b;
                                intermediates_clear = false;
                                break;
                            }
                        }
                        if !intermediates_clear { break; }
                    }
                    if let Some(target) = piece_occupying(board, rules, tx, ty) {
                        if !cannot_be_captured(rules, target) {
                            if target.player != effective_player && tpl.can_capture_enemy_on_move {
                                push(&mut out, tx, ty, Some(target.id));
                            } else if target.player == effective_player && tpl.can_capture_allies {
                                push(&mut out, tx, ty, Some(target.id));
                            }
                        }
                        break;
                    } else {
                        push(&mut out, tx, ty, None);
                    }
                }
            }
        }
    }

    // -------- castling --------
    if tpl.can_castle && mover.move_count == 0 {
        let castle_dist = if tpl.castling_distance > 0 { tpl.castling_distance } else { 2 };
        let has_check_rule = tpl.has_check_rule || tpl.has_checkmate_rule;

        // We don't currently store castling partner ids in the protocol;
        // detect partners by their position relative to the king and the
        // `can_castle` capability would need a partner table. As a fallback,
        // any unmoved friendly piece sitting on the same row that the king
        // would land next to is treated as a partner. Two-sided.
        for side in [-1i32, 1] {
            let target_x = mover.x + side * castle_dist;
            if !in_bounds(target_x, mover.y) { continue; }

            // Find the nearest unmoved friendly piece on this row in this dir.
            let partner = board.pieces.iter()
                .filter(|p| p.id != mover.id
                    && p.player == mover.player
                    && p.move_count == 0
                    && p.y == mover.y
                    && (p.x - mover.x).signum() == side)
                .min_by_key(|p| (p.x - mover.x).abs());
            let partner = match partner { Some(p) => p, None => continue };

            let dist_to_partner = (partner.x - mover.x) * side;
            let close_range = dist_to_partner > 0 && dist_to_partner <= castle_dist;

            let mut path_clear = true;
            {
                // Scan every square from mover (exclusive) to the scan boundary
                // (inclusive). For close_range (rook within castle_dist), scan up
                // to target_x. For far rook, scan up to just before the rook.
                // The partner/rook is exempt — it moves out of the way.
                let scan_last = if close_range { target_x } else { partner.x - side };
                let mut x = mover.x + side;
                loop {
                    // Impassable squares block the castling path.
                    if !tpl.ghostwalk
                        && !rules.impassable_squares.is_empty()
                        && rules.impassable_squares.contains(&(x, mover.y))
                    {
                        path_clear = false;
                        break;
                    }
                    if let Some(occ) = piece_occupying(board, rules, x, mover.y) {
                        if occ.id != partner.id {
                            path_clear = false;
                            break;
                        }
                    }
                    if x == scan_last { break; }
                    x += side;
                }
            }

            if path_clear && has_check_rule {
                // Any square the king crosses must not be under enemy attack.
                let mut x = mover.x;
                let end = mover.x + side * castle_dist;
                let step = side;
                loop {
                    if square_attacked_by(board, rules, x, mover.y, mover.player, mover.current_hp) {
                        path_clear = false; break;
                    }
                    if x == end { break; }
                    x += step;
                }
            }

            if path_clear {
                out.push(Move {
                    piece_id: mover.id,
                    from: Coord { x: mover.x, y: mover.y },
                    to: Coord { x: target_x, y: mover.y },
                    capture: None,
                    partner: Some(partner.id),
                    is_castling: true,
                    is_promotion: false,
                    promote_to: None,
                    creates_en_passant: false,
                    hp_damage: 0,
                    attacker_dies: false,
                    has_trample: tpl.trample,
                    trample_radius: tpl.trample_radius,
                    area_radius: tpl.attack_radius,
                    burn_damage: 0,
                    burn_duration: 0,
                });
            }
        }
    }

    // -------- step-by-step movement (king-style, up to N squares) --------
    // Mirrors `canReachStepByStep` and the step-by-step branch in
    // `isValidTargetSquare` in server/game-socket.js. The piece walks one
    // square at a time (8 directions, or 4 cardinal if value is negative)
    // and may travel up to |value| squares total. Intermediate squares
    // must be empty; the final square may be empty (move) or contain an
    // enemy piece (capture, when `can_capture_enemy_on_move` is true).
    //
    // CRITICAL: without this, any piece configured with ONLY step-by-step
    // movement (the common checkers-king pattern) generates zero moves
    // and the trainer stalemates almost every game in such variants.
    let step_value_raw = tpl.step_by_step_movement_value;
    if step_value_raw != 0 && !global_first_move_block {
        let max_steps = step_value_raw.abs();
        let no_diagonal = step_value_raw < 0;
        let step_dirs: &[(i32, i32)] = if no_diagonal {
            &[(0, -1), (0, 1), (-1, 0), (1, 0)]
        } else {
            &[(0, -1), (0, 1), (-1, 0), (1, 0),
              (-1, -1), (1, -1), (-1, 1), (1, 1)]
        };
        // BFS over the empty-square graph rooted at the mover's current
        // position. Visited squares cap distance traveled at max_steps.
        use std::collections::VecDeque;
        let mut visited: HashMap<(i32, i32), i32> = HashMap::new();
        visited.insert((mover.x, mover.y), 0);
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        queue.push_back((mover.x, mover.y));
        while let Some((cx, cy)) = queue.pop_front() {
            let dist = *visited.get(&(cx, cy)).unwrap_or(&0);
            if dist >= max_steps { continue; }
            for (dx, dy) in step_dirs.iter() {
                let nx = cx + dx;
                let ny = cy + dy;
                if !in_bounds(nx, ny) { continue; }
                if visited.contains_key(&(nx, ny)) { continue; }
                if (nx, ny) == (mover.x, mover.y) { continue; }
                let occupant = piece_occupying_excluding(board, rules, nx, ny, mover.id);
                match occupant {
                    None => {
                        // Empty square reachable as a move.
                        visited.insert((nx, ny), dist + 1);
                        queue.push_back((nx, ny));
                        // Multi-tile fit + dest-clear filter applied below.
                        let pw = tpl.piece_width.max(1);
                        let ph = tpl.piece_height.max(1);
                        if does_piece_fit_on_board(nx, ny, pw, ph, bw, bh)
                            && is_destination_clear(board, rules, mover, &tpl, nx, ny, effective_player)
                        {
                            push(&mut out, nx, ny, None);
                        }
                    }
                    Some(target) => {
                        // Occupied: cannot pass through, but may be captured
                        // as a final destination if the piece can capture
                        // on move and the target is enemy & capturable.
                        if target.player != effective_player
                            && tpl.can_capture_enemy_on_move
                            && !cannot_be_captured(rules, target)
                        {
                            push(&mut out, nx, ny, Some(target.id));
                        }
                    }
                }
            }
        }
    }

    // -------- step-by-step CAPTURE (separate range, capture only) --------
    let step_capture_raw = tpl.step_by_step_capture;
    if step_capture_raw != 0 && !global_first_move_capture_block {
        let max_steps = step_capture_raw.abs();
        let no_diagonal = step_capture_raw < 0;
        let step_dirs: &[(i32, i32)] = if no_diagonal {
            &[(0, -1), (0, 1), (-1, 0), (1, 0)]
        } else {
            &[(0, -1), (0, 1), (-1, 0), (1, 0),
              (-1, -1), (1, -1), (-1, 1), (1, 1)]
        };
        use std::collections::VecDeque;
        let mut visited: HashMap<(i32, i32), i32> = HashMap::new();
        visited.insert((mover.x, mover.y), 0);
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        queue.push_back((mover.x, mover.y));
        while let Some((cx, cy)) = queue.pop_front() {
            let dist = *visited.get(&(cx, cy)).unwrap_or(&0);
            if dist >= max_steps { continue; }
            for (dx, dy) in step_dirs.iter() {
                let nx = cx + dx;
                let ny = cy + dy;
                if !in_bounds(nx, ny) { continue; }
                if visited.contains_key(&(nx, ny)) { continue; }
                if (nx, ny) == (mover.x, mover.y) { continue; }
                if let Some(target) = piece_occupying_excluding(board, rules, nx, ny, mover.id) {
                    if target.player != effective_player
                        && !cannot_be_captured(rules, target)
                    {
                        push(&mut out, nx, ny, Some(target.id));
                    }
                    // Stop traversal at any occupied square.
                } else {
                    visited.insert((nx, ny), dist + 1);
                    queue.push_back((nx, ny));
                }
            }
        }
    }

    // -------- custom_movement_squares --------
    if let Some(s) = &tpl.custom_movement_squares {
        if let Ok(arr) = serde_json::from_str::<Value>(s) {
            if let Some(list) = arr.as_array() {
                for sq in list {
                    let col = sq.get("col").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
                    let row = sq.get("row").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
                    let (ox, oy) = if is_player2 { (-col, -row) } else { (col, row) };
                    let tx = mover.x + ox;
                    let ty = mover.y + oy;
                    if !in_bounds(tx, ty) { continue; }
                    if out.iter().any(|m| m.to.x == tx && m.to.y == ty) { continue; }
                    if let Some(target) = piece_occupying(board, rules, tx, ty) {
                        if !cannot_be_captured(rules, target) {
                            if target.player != effective_player && tpl.can_capture_enemy_on_move {
                                push(&mut out, tx, ty, Some(target.id));
                            } else if target.player == effective_player && tpl.can_capture_allies {
                                push(&mut out, tx, ty, Some(target.id));
                            }
                        }
                    } else {
                        push(&mut out, tx, ty, None);
                    }
                }
            }
        }
    }

    // -------- custom_attack_squares (capture-only) --------
    if let Some(s) = &tpl.custom_attack_squares {
        if let Ok(arr) = serde_json::from_str::<Value>(s) {
            if let Some(list) = arr.as_array() {
                for sq in list {
                    let col = sq.get("col").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
                    let row = sq.get("row").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
                    let (ox, oy) = if is_player2 { (-col, -row) } else { (col, row) };
                    let tx = mover.x + ox;
                    let ty = mover.y + oy;
                    if !in_bounds(tx, ty) { continue; }
                    if out.iter().any(|m| m.to.x == tx && m.to.y == ty) { continue; }
                    if let Some(target) = piece_occupying(board, rules, tx, ty) {
                        if !cannot_be_captured(rules, target)
                            && target.player != effective_player {
                            push(&mut out, tx, ty, Some(target.id));
                        }
                    }
                }
            }
        }
    }

    // -------- multi-tile filter --------
    if tpl.piece_width > 1 || tpl.piece_height > 1 {
        out.retain(|mv| {
            does_piece_fit_on_board(mv.to.x, mv.to.y, tpl.piece_width, tpl.piece_height, bw, bh)
                && is_destination_clear(board, rules, mover, &tpl, mv.to.x, mv.to.y, effective_player)
        });
    }

    // -------- promotion flag (back-rank + custom promotion squares) --------
    // Mirrors checkPromotionEligibility in game-socket.js:
    //   if promotion_squares_string / asPromotion squares are configured,
    //   use those; otherwise fall back to the back-rank (row 0 for P1, row
    //   bh-1 for P2) so standard-chess-style games still work.
    // NOTE: en passant captures are added BEFORE this block so they can also
    // receive the is_promotion flag when they land on a promotion square.

    // -------- en passant capture --------
    // Mirrors the en passant validation in game-socket.js:
    //   same row as victim, |dx|=1, same piece_id, enemy, diagonal attack valid.
    if tpl.can_en_passant {
        if let Some(ref ept) = board.en_passant_target {
            if let Some(victim) = board.pieces.iter().find(|p| p.id == ept.victim_id) {
                // The capturing piece must be on the same row as the victim,
                // one file to either side, and the victim must be the enemy.
                if victim.player != effective_player
                    && victim.piece_id == mover.piece_id
                    && mover.y == victim.y
                    && (mover.x - victim.x).abs() == 1
                    && in_bounds(ept.capture_square.x, ept.capture_square.y)
                {
                    out.push(Move {
                        piece_id: mover.id,
                        from: Coord { x: mover.x, y: mover.y },
                        to: Coord { x: ept.capture_square.x, y: ept.capture_square.y },
                        capture: Some(ept.victim_id),
                        partner: None,
                        is_castling: false,
                        is_promotion: false,
                        promote_to: None,
                        creates_en_passant: false,
                        hp_damage: tpl.attack_damage.max(1),
                        attacker_dies: tpl.die_on_capture,
                        has_trample: tpl.trample,
                        trample_radius: tpl.trample_radius,
                        area_radius: tpl.attack_radius,
                        burn_damage: tpl.burn_damage,
                        burn_duration: tpl.burn_duration,
                    });
                }
            }
        }
    }

    if tpl.can_promote {
        let promo_y = if is_player2 { bh - 1 } else { 0 };
        // Collect indices of moves that land on a promotion square.
        let promo_indices: Vec<usize> = out.iter().enumerate()
            .filter(|(_, mv)| {
                let on_back_rank = mv.to.y == promo_y;
                let on_custom_square = !rules.promotion_squares.is_empty()
                    && rules.promotion_squares.iter().any(|&(px, py)| px == mv.to.x && py == mv.to.y);
                on_back_rank || on_custom_square
            })
            .map(|(i, _)| i)
            .collect();

        if !promo_indices.is_empty() {
            // Respect the per-placement wizard flags on the PROMOTING piece:
            //   tpl.can_promote_to_checkmate — allow targets with ends_game_on_checkmate
            //   tpl.can_promote_to_capture   — allow targets with ends_game_on_capture
            // Both default to false, so royal/game-ending targets are excluded
            // unless the game designer explicitly enabled them for this piece.
            let target_allowed = |t: &PieceTemplate| -> bool {
                if t.ends_game_on_checkmate && !tpl.can_promote_to_checkmate { return false; }
                if t.ends_game_on_capture   && !tpl.can_promote_to_capture   { return false; }
                // limit_promote_*_to_original: cannot promote to this type if
                // the owner already has as many (or more) as they started with.
                if t.ends_game_on_checkmate && tpl.limit_promote_checkmate_to_original {
                    if promotion_count_exceeds_original(board, rules, mover.player, t.real_piece_id) { return false; }
                }
                if t.ends_game_on_capture && tpl.limit_promote_capture_to_original {
                    if promotion_count_exceeds_original(board, rules, mover.player, t.real_piece_id) { return false; }
                }
                true
            };

            // Configured path (promotion_pieces_ids set by the game designer):
            //   Generate ONE Move per valid target so MCTS can evaluate each
            //   option in context — e.g. "promote to Knight for instant checkmate"
            //   vs "promote to Queen for positional advantage". UCT will naturally
            //   favour the branch that leads to more wins.
            //
            // Fallback (no configured list):
            //   Pick the SINGLE best target by mobility-based power score.
            //   No curated intent here, so we keep the MCTS tree lean.
            let targets: Vec<i64> = if !tpl.promotion_pieces_ids.is_empty() {
                tpl.promotion_pieces_ids.iter()
                    .filter(|&&id| {
                        rules.piece(id)
                            .map(|t| target_allowed(t))
                            .unwrap_or(false)
                    })
                    .copied()
                    .collect()
            } else {
                let best = rules.pieces.values()
                    .filter(|t| t.id != tpl.id && !t.can_promote && target_allowed(t))
                    .max_by_key(|t| promotion_power_score(*t));
                match best {
                    Some(t) => vec![t.id],
                    None    => vec![],
                }
            };

            // Replace each promotable base move.
            // Empty targets with no configured list → promote_to = None
            //   (selfplay.rs treats this as instant win under promotion_condition).
            // Otherwise: one Move clone per target (configured) or one Move
            //   with the single best id (fallback).
            // Process in reverse so removals don't shift later indices.
            let mut extra: Vec<Move> = Vec::new();
            for &idx in promo_indices.iter().rev() {
                let base = out.remove(idx);
                if targets.is_empty() {
                    let mut mv = base;
                    mv.is_promotion = true;
                    extra.push(mv);
                } else {
                    for &target_id in &targets {
                        let mut mv = base.clone();
                        mv.is_promotion = true;
                        mv.promote_to = Some(target_id);
                        extra.push(mv);
                    }
                }
            }
            out.extend(extra);
        }
    }

    // Impassable squares: pieces cannot land on impassable squares (unless ghostwalk).
    // Path-through blocking is already handled in is_path_clear and check_dir.
    if !tpl.ghostwalk && !rules.impassable_squares.is_empty() {
        out.retain(|mv| !rules.impassable_squares.contains(&(mv.to.x, mv.to.y)));
    }

    // Restriction zone filter: once a piece with cannot_move_outside_zone is
    // standing on a zone square it may only move to other zone squares (locked in).
    // A piece that starts outside the zone moves freely until it steps onto one.
    if tpl.cannot_move_outside_zone && !rules.restriction_zone_squares.is_empty() {
        if rules.restriction_zone_squares.contains(&(mover.x, mover.y)) {
            out.retain(|mv| rules.restriction_zone_squares.contains(&(mv.to.x, mv.to.y)));
        }
    }

    out
}

/// Compute a mobility-based power score for use when ranking promotion targets.
/// Higher = better promotion choice. What matters is relative ordering:
///   Queen (8 sliding dirs): ~43  |  Rook (4 cardinal sliding): ~23
///   Bishop (4 diagonal sliding): ~17  |  Knight (ratio): ~6
///
/// Royal/game-ending pieces are filtered at the call site using the wizard
/// flags (can_promote_to_checkmate / can_promote_to_capture), so no artificial
/// score cap is applied here — a powerful custom royal deserves its full score.
fn promotion_power_score(tpl: &PieceTemplate) -> i32 {
    let mut score: i32 = 0;

    // --- Directional movement ---
    // Repeating (sliding) in a direction: 5 pts base.
    // Non-repeating: 1–4 pts scaled by max range.
    let cardinal_dirs = [
        tpl.up_movement, tpl.down_movement, tpl.left_movement, tpl.right_movement,
    ];
    let diagonal_dirs = [
        tpl.up_left_movement, tpl.up_right_movement,
        tpl.down_left_movement, tpl.down_right_movement,
    ];

    let mut has_cardinal = false;
    let mut has_diagonal = false;
    let mut infinite_diagonal_count = 0i32;

    for &d in &cardinal_dirs {
        if d == 0 { continue; }
        has_cardinal = true;
        if tpl.repeating_movement {
            score += 5;
        } else {
            score += d.clamp(1, 4);
        }
    }
    for &d in &diagonal_dirs {
        if d == 0 { continue; }
        has_diagonal = true;
        if tpl.repeating_movement {
            score += 5;
            infinite_diagonal_count += 1;
        } else {
            score += d.clamp(1, 4);
        }
    }

    // Full board coverage bonus: cardinal sliders can reach every square.
    // Diagonal-only pieces are color-bound (permanently locked off half the board).
    if has_cardinal && has_diagonal {
        score += 3; // queen-like: all squares reachable
    } else if has_cardinal {
        score += 2; // rook-like: all squares reachable via axes
    } else if has_diagonal && !has_cardinal {
        // Bishop-like color-binding penalty: stronger the diagonals, bigger the
        // opportunity cost of never reaching the other color.
        score -= 2 + infinite_diagonal_count;
    }

    // --- Ratio (knight-like) movement ---
    if tpl.ratio_movement_1 != 0 && tpl.ratio_movement_2 != 0 {
        score += 6;
        if tpl.repeating_ratio { score += 4; }
    }

    // --- Step-by-step movement ---
    let step = tpl.step_by_step_movement_value.abs();
    if step > 0 {
        score += step.clamp(1, 6);  // 1-step ≈ limited king; 6-step ≈ wide coverage
    }

    // --- Custom movement squares ---
    if let Some(s) = &tpl.custom_movement_squares {
        let count = s.matches("\"col\"").count() as i32;
        score += count.clamp(0, 8);
    }

    score.max(1)
}

/// Returns true when the owner already has at least as many pieces of the
/// given `real_piece_id` type as were in the starting position — used to
/// enforce `limit_promote_checkmate_to_original` /
/// `limit_promote_capture_to_original`.
fn promotion_count_exceeds_original(
    board: &Board,
    rules: &Rules,
    player: i32,
    real_target_id: i64,
) -> bool {
    let original = rules.starting_positions.iter()
        .filter(|sp| sp.player_number == player && {
            rules.piece(sp.piece_id)
                .map(|t| t.real_piece_id == real_target_id || t.id == real_target_id)
                .unwrap_or(false)
        })
        .count();
    let current = board.pieces.iter()
        .filter(|p| p.player == player && {
            rules.piece(p.piece_id)
                .map(|t| t.real_piece_id == real_target_id || t.id == real_target_id)
                .unwrap_or(false)
        })
        .count();
    current >= original
}

fn ratio_path_ok(    board: &Board,
    rules: &Rules,
    mover: &PieceOnBoard,
    tpl: &PieceTemplate,
    dx: i32, dy: i32,
    target_x: i32, target_y: i32,
    no_hop_ability: bool,
    effective_player: i32,
) -> bool {
    let abs_dx = dx.abs();
    let abs_dy = dy.abs();
    let primary_is_x = abs_dx > abs_dy;
    let primary_amt = abs_dx.max(abs_dy);
    let secondary_amt = abs_dx.min(abs_dy);
    let primary_dir = if primary_is_x { dx.signum() } else { 0 };
    let secondary_dir = if primary_is_x { 0 } else { dy.signum() };
    let tertiary_dir = if primary_is_x { dy.signum() } else { dx.signum() };

    let blocked = |x: i32, y: i32| -> bool {
        if let Some(b) = piece_occupying_excluding(board, rules, x, y, mover.id) {
            if no_hop_ability { return true; }
            return !can_hop_over(b, effective_player, tpl);
        }
        false
    };

    // Path 1: primary direction first
    let mut p1 = true;
    for i in 1..=primary_amt {
        let cx = mover.x + if primary_is_x { primary_dir * i } else { 0 };
        let cy = mover.y + if primary_is_x { 0 } else { secondary_dir * i };
        if (cx != target_x || cy != target_y) && blocked(cx, cy) { p1 = false; break; }
    }
    if p1 {
        for i in 1..=secondary_amt {
            let cx = mover.x + if primary_is_x { primary_dir * primary_amt } else { tertiary_dir * i };
            let cy = mover.y + if primary_is_x { tertiary_dir * i } else { secondary_dir * primary_amt };
            if (cx != target_x || cy != target_y) && blocked(cx, cy) { p1 = false; break; }
        }
    }

    // Path 2: secondary direction first
    let mut p2 = true;
    for i in 1..=secondary_amt {
        let cx = mover.x + if primary_is_x { 0 } else { tertiary_dir * i };
        let cy = mover.y + if primary_is_x { tertiary_dir * i } else { 0 };
        if (cx != target_x || cy != target_y) && blocked(cx, cy) { p2 = false; break; }
    }
    if p2 {
        for i in 1..=primary_amt {
            let cx = mover.x + if primary_is_x { primary_dir * i } else { tertiary_dir * secondary_amt };
            let cy = mover.y + if primary_is_x { tertiary_dir * secondary_amt } else { secondary_dir * i };
            if (cx != target_x || cy != target_y) && blocked(cx, cy) { p2 = false; break; }
        }
    }

    p1 || p2
}

/// Whether square (x,y) is attacked by any opponent of `our_player`.
/// Uses a recursion-safe shallow check: for each enemy piece, generate its
/// pseudo-legal moves and see if any lands on the target square.
/// To prevent infinite recursion through castling-with-check-rule paths,
/// we temporarily skip the moving piece's `can_castle` flag inside the
/// recursive call by inspecting moves only â€” castling moves never threaten
/// arbitrary squares anyway, so this is safe.
fn square_attacked_by(board: &Board, rules: &Rules, x: i32, y: i32, our_player: i32, target_hp: i32) -> bool {
    for enemy in board.pieces.iter().filter(|p| p.player != our_player && !p.is_neutral) {
        // Skip the king-style enemy's own castling logic to avoid recursion.
        let enemy_clone = enemy.clone();
        let enemy_moves = pseudo_moves_no_castle(board, rules, &enemy_clone);
        if enemy_moves.iter().any(|m| {
            m.to.x == x && m.to.y == y
            && (m.hp_damage == 0 || target_hp <= m.hp_damage)
        }) {
            return true;
        }
    }
    false
}

fn pseudo_moves_no_castle(board: &Board, rules: &Rules, p: &PieceOnBoard) -> Vec<Move> {
    let saved = rules.piece(p.piece_id).cloned();
    if let Some(t) = saved {
        if t.can_castle {
            // Build a temporary rules-like view by cloning the template with castling off.
            let mut tmp = t.clone();
            tmp.can_castle = false;
            let mut tmp_rules_pieces = rules.pieces.clone();
            tmp_rules_pieces.insert(p.piece_id, tmp);
            let tmp_rules = Rules {
                game: rules.game.clone(),
                pieces: tmp_rules_pieces,
                starting_positions: rules.starting_positions.clone(),
                control_squares: rules.control_squares.clone(),
                control_half_turns_required: rules.control_half_turns_required,
                promotion_squares: rules.promotion_squares.clone(),
                range_squares: rules.range_squares.clone(),
                range_square_bonuses: rules.range_square_bonuses.clone(),
                impassable_squares: rules.impassable_squares.clone(),
                restriction_zone_squares: rules.restriction_zone_squares.clone(),
                disable_first_move_here_squares: rules.disable_first_move_here_squares.clone(),
                restrict_first_move_to_custom_squares: rules.restrict_first_move_to_custom_squares.clone(),
            };
            return moves_for(board, &tmp_rules, p);
        }
    }
    moves_for(board, rules, p)
}

// ---------- legality (don't leave own royals in check) ----------

/// True if a piece template (combined with its game-level mate_piece
/// designation) should be treated as "royal" — meaning the side loses if it
/// is captured / checkmated. Mirrors the JS server's checkForCheck which
/// keys off `ends_game_on_checkmate` (placement-level flag) plus the
/// game-level `mate_piece` override.
pub fn is_royal_piece(rules: &Rules, piece_id: i64) -> bool {
    let tpl = match rules.piece(piece_id) { Some(t) => t, None => return false };
    if tpl.is_royal
        || tpl.has_check_rule
        || tpl.has_checkmate_rule
        || tpl.ends_game_on_checkmate
        || tpl.ends_game_on_capture
    {
        return true;
    }
    if let Some(mp) = rules.game.mate_piece {
        if mp == piece_id { return true; }
    }
    false
}

/// Returns true if our side has any piece marked royal / has_check_rule.
fn has_royal(board: &Board, rules: &Rules, player: i32) -> bool {
    board.pieces.iter().any(|p| p.player == player && is_royal_piece(rules, p.piece_id))
}

/// True if the side `player` is in check.
///
/// Standard mode (`mate_condition_requires_all == false`): returns true as
/// soon as **any** royal piece is under lethal attack — the traditional
/// single-king rule.
///
/// Requires-all mode (`mate_condition_requires_all == true`): returns true
/// only when **every** royal piece on this side is simultaneously under lethal
/// attack. Used for multi-king variants where the loss condition is "all your
/// royals are threatened at once". Mirrors `checkForCheck` in game-socket.js.
pub fn in_check(board: &Board, rules: &Rules, player: i32) -> bool {
    let requires_all = rules.game.mate_condition_requires_all;

    let royals: Vec<&PieceOnBoard> = board.pieces.iter()
        .filter(|p| p.player == player && is_royal_piece(rules, p.piece_id))
        .collect();

    if royals.is_empty() { return false; }

    for p in &royals {
        let (pw, ph) = rules.piece(p.piece_id)
            .map(|t| (t.piece_width.max(1), t.piece_height.max(1)))
            .unwrap_or((1, 1));
        let piece_attacked = (0..ph).any(|sdy| {
            (0..pw).any(|sdx| {
                square_attacked_by(board, rules, p.x + sdx, p.y + sdy, player, p.current_hp)
            })
        });
        if requires_all {
            // Every royal must be attacked — short-circuit if any is safe.
            if !piece_attacked { return false; }
        } else {
            // Any royal attacked is enough.
            if piece_attacked { return true; }
        }
    }

    // In requires_all mode: if we get here, all royals were attacked.
    // In standard mode: if we get here, no royal was attacked.
    requires_all
}

/// Pseudo-legal moves for the side to move.
pub fn pseudo_legal(board: &Board, rules: &Rules) -> Vec<Move> {
    let mut out = Vec::new();
    // Include the active player's pieces AND neutral pieces (is_neutral=true, player=0),
    // since either player can move neutral pieces on their turn.
    for p in board.pieces.iter().filter(|p| p.player == board.turn || p.is_neutral) {
        out.extend(moves_for(board, rules, p));
    }
    out
}

/// Legal moves (filter out any move that leaves us in check, only when
/// we have a royal piece).
pub fn legal_moves(board: &Board, rules: &Rules) -> Vec<Move> {
    let pseudo = pseudo_legal(board, rules);
    // The check-legality filter (drop moves that leave a royal in check) only
    // applies when mate_condition is enabled. This mirrors the live server's
    // getAllLegalMovesForPlayer, which only calls wouldMoveLeaveInCheck when
    // gameType.mate_condition === true. Without this gate, capture_condition
    // games (e.g. Knightfall) incorrectly treat ends_game_on_capture pieces as
    // "must be protected from attack", which filters nearly every move and
    // causes false stalemates throughout self-play.
    let mut legal: Vec<Move> = if !rules.game.mate_condition || !has_royal(board, rules, board.turn) {
        pseudo
    } else {
        let me = board.turn;
        let mut filtered = Vec::with_capacity(pseudo.len());
        for mv in pseudo {
            let mut next = board.clone();
            let _ = next.apply(&mv, rules);
            if !in_check(&next, rules, me) {
                filtered.push(mv);
            }
        }
        filtered
    };

    // forced_capture_condition: if any capturing move is available, the
    // side to move MUST play a capture. Mirrors server/game-socket.js'
    // forced-capture rejection. Without this, AI training plays a
    // strictly different game than the live server, which skews opening
    // book + model toward illegal-at-runtime lines and makes stalemate
    // appear far more often than it should in variants like checkers.
    if rules.game.forced_capture_condition && legal.iter().any(|m| m.capture.is_some()) {
        legal.retain(|m| m.capture.is_some());
    }

    legal
}
