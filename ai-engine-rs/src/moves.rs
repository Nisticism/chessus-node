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

fn parse_squares_map(s: &Option<String>) -> Option<HashMap<String, Value>> {
    let raw = s.as_ref()?;
    let v: Value = serde_json::from_str(raw).ok()?;
    let obj = v.as_object()?;
    Some(obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
}

/// Mirrors `shouldBlockFirstMoveAbilities`. The `piece` here is the
/// on-board piece (we need its x/y).
fn should_block_first_move_abilities(p: &PieceOnBoard, rules: &Rules) -> bool {
    let map = match parse_squares_map(&rules.game.special_squares_string) {
        Some(m) => m,
        None => return false,
    };
    let current_key = format!("{},{}", p.y, p.x);
    if let Some(cfg) = map.get(&current_key) {
        if cfg.get("disableFirstMoveHere").and_then(|v| v.as_bool()).unwrap_or(false) {
            return true;
        }
    }
    let mut restrict_exists = false;
    let mut on_allowed_square = false;
    for (key, cfg) in &map {
        if cfg.get("restrictFirstMoveToCustom").and_then(|v| v.as_bool()).unwrap_or(false) {
            restrict_exists = true;
            if key == &current_key {
                on_allowed_square = true;
            }
        }
    }
    restrict_exists && !on_allowed_square
}

/// Combine `range_squares_string` with `special_squares_string` entries
/// flagged `asRange`. Returns key -> bonus.
fn collect_range_squares(rules: &Rules) -> HashMap<String, i32> {
    let mut out: HashMap<String, i32> = HashMap::new();
    if let Some(map) = parse_squares_map(&rules.game.range_squares_string) {
        for (k, v) in map {
            let bonus = v.get("rangeBonus").and_then(|x| x.as_i64()).unwrap_or(1) as i32;
            out.insert(k, bonus);
        }
    }
    if let Some(map) = parse_squares_map(&rules.game.special_squares_string) {
        for (k, v) in map {
            let as_range = v.get("asRange").and_then(|x| x.as_bool()).unwrap_or(false);
            if as_range && !out.contains_key(&k) {
                let bonus = v.get("rangeBonus").and_then(|x| x.as_i64()).unwrap_or(1) as i32;
                out.insert(k, bonus);
            }
        }
    }
    out
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

fn piece_at<'a>(board: &'a Board, x: i32, y: i32) -> Option<&'a PieceOnBoard> {
    board.pieces.iter().find(|p| p.x == x && p.y == y)
}

fn piece_at_excluding<'a>(board: &'a Board, x: i32, y: i32, exclude_id: u32) -> Option<&'a PieceOnBoard> {
    board.pieces.iter().find(|p| p.x == x && p.y == y && p.id != exclude_id)
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
    mover: &PieceOnBoard,
    tpl: &PieceTemplate,
    to_x: i32, to_y: i32,
    allow_hop: bool,
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
                if let Some(blocker) = piece_at_excluding(board, x, y, mover.id) {
                    if !allow_hop || !can_hop_over(blocker, mover.player, tpl) {
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
) -> bool {
    let pw = tpl.piece_width.max(1);
    let ph = tpl.piece_height.max(1);
    for sdy in 0..ph {
        for sdx in 0..pw {
            if let Some(o) = piece_at_excluding(board, to_x + sdx, to_y + sdy, mover.id) {
                if o.player == mover.player { return false; }
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

    // Range-square bonus.
    let range_map = collect_range_squares(rules);
    let key = format!("{},{}", mover.y, mover.x);
    let tpl = if let Some(&bonus) = range_map.get(&key) {
        apply_range_bonus_to_template(&raw_tpl, bonus)
    } else {
        raw_tpl
    };

    let bw = board.width;
    let bh = board.height;
    let in_bounds = |x: i32, y: i32| x >= 0 && y >= 0 && x < bw && y < bh;
    let is_player2 = mover.player == 2;

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
            if !is_path_clear(board, mover, &tpl, tx, ty, dir_hop_allowed) { break; }

            if let Some(target) = piece_at(board, tx, ty) {
                let is_landing = if exact_flag {
                    if repeating { exact_dist != 0 && dist % exact_dist == 0 }
                    else { dist == exact_dist }
                } else { true };
                if is_landing && !cannot_be_captured(rules, target) {
                    if target.player != mover.player
                        && tpl.can_capture_enemy_on_move
                        && can_capture_in_dir
                        && !global_first_move_capture_block
                    {
                        push(out, tx, ty, Some(target.id));
                    } else if target.player == mover.player && tpl.can_capture_allies {
                        push(out, tx, ty, Some(target.id));
                    }
                }
                if !dir_hop_allowed || !can_hop_over(target, mover.player, &tpl) { break; }
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
        check_dir(&mut out, dx, dy, v, Some(d), exact, rep_m && exact, false);
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
                                check_dir(&mut out, dx, dy, max_dist, Some(dir), exact, false, false);
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
            if !ratio_path_ok(board, mover, &tpl, dx, dy, tx, ty, no_hop) { continue; }
            if let Some(target) = piece_at(board, tx, ty) {
                if !cannot_be_captured(rules, target) {
                    if target.player != mover.player && tpl.can_capture_enemy_on_move {
                        push(&mut out, tx, ty, Some(target.id));
                    } else if target.player == mover.player && tpl.can_capture_allies {
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
                            if let Some(b) = piece_at_excluding(board, ix, iy, mover.id) {
                                let _ = b;
                                intermediates_clear = false;
                                break;
                            }
                        }
                        if !intermediates_clear { break; }
                    }
                    if let Some(target) = piece_at(board, tx, ty) {
                        if !cannot_be_captured(rules, target) {
                            if target.player != mover.player && tpl.can_capture_enemy_on_move {
                                push(&mut out, tx, ty, Some(target.id));
                            } else if target.player == mover.player && tpl.can_capture_allies {
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
            if close_range {
                if let Some(occ) = piece_at(board, target_x, mover.y) {
                    if occ.id != partner.id { path_clear = false; }
                }
            } else {
                let mut x = mover.x + side;
                while x != partner.x {
                    if piece_at_excluding(board, x, mover.y, mover.id).is_some() {
                        path_clear = false; break;
                    }
                    x += side;
                }
            }

            if path_clear && has_check_rule {
                // Any square the king crosses must not be under enemy attack.
                let mut x = mover.x;
                let end = mover.x + side * castle_dist;
                let step = side;
                loop {
                    if square_attacked_by(board, rules, x, mover.y, mover.player) {
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
                });
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
                    if let Some(target) = piece_at(board, tx, ty) {
                        if !cannot_be_captured(rules, target) {
                            if target.player != mover.player && tpl.can_capture_enemy_on_move {
                                push(&mut out, tx, ty, Some(target.id));
                            } else if target.player == mover.player && tpl.can_capture_allies {
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
                    if let Some(target) = piece_at(board, tx, ty) {
                        if !cannot_be_captured(rules, target)
                            && target.player != mover.player {
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
                && is_destination_clear(board, rules, mover, &tpl, mv.to.x, mv.to.y)
        });
    }

    // -------- promotion flag (back-rank) --------
    if tpl.can_promote {
        let promo_y = if is_player2 { bh - 1 } else { 0 };
        for mv in out.iter_mut() {
            if mv.to.y == promo_y {
                mv.is_promotion = true;
            }
        }
    }

    out
}

fn ratio_path_ok(
    board: &Board,
    mover: &PieceOnBoard,
    tpl: &PieceTemplate,
    dx: i32, dy: i32,
    target_x: i32, target_y: i32,
    no_hop_ability: bool,
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
        if let Some(b) = piece_at_excluding(board, x, y, mover.id) {
            if no_hop_ability { return true; }
            return !can_hop_over(b, mover.player, tpl);
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
fn square_attacked_by(board: &Board, rules: &Rules, x: i32, y: i32, our_player: i32) -> bool {
    for enemy in board.pieces.iter().filter(|p| p.player != our_player) {
        // Skip the king-style enemy's own castling logic to avoid recursion.
        let enemy_clone = enemy.clone();
        let enemy_moves = pseudo_moves_no_castle(board, rules, &enemy_clone);
        if enemy_moves.iter().any(|m| m.to.x == x && m.to.y == y) {
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

/// True if any of our royal pieces are currently under attack.
pub fn in_check(board: &Board, rules: &Rules, player: i32) -> bool {
    for p in board.pieces.iter().filter(|p| p.player == player) {
        if !is_royal_piece(rules, p.piece_id) { continue; }
        if square_attacked_by(board, rules, p.x, p.y, player) { return true; }
    }
    false
}

/// Pseudo-legal moves for the side to move.
pub fn pseudo_legal(board: &Board, rules: &Rules) -> Vec<Move> {
    let mut out = Vec::new();
    for p in board.pieces.iter().filter(|p| p.player == board.turn) {
        out.extend(moves_for(board, rules, p));
    }
    out
}

/// Legal moves (filter out any move that leaves us in check, only when
/// we have a royal piece).
pub fn legal_moves(board: &Board, rules: &Rules) -> Vec<Move> {
    let pseudo = pseudo_legal(board, rules);
    if !has_royal(board, rules, board.turn) {
        return pseudo;
    }
    let me = board.turn;
    let mut legal = Vec::with_capacity(pseudo.len());
    for mv in pseudo {
        let mut next = board.clone();
        next.apply(&mv);
        if !in_check(&next, rules, me) {
            legal.push(mv);
        }
    }
    legal
}
