//! UCT (Upper-Confidence-bound applied to Trees) Monte-Carlo Tree Search
//! with biased rollouts and a material-balance leaf evaluator.
//!
//! Architecture (current / Phase 1):
//!   * **Rollout play** — pseudo-legal moves selected by `pick_rollout_move`,
//!     which uses a priority-tiered bias (promotion → control squares → range
//!     squares → captures → forward advance → random).  Not purely random.
//!   * **Leaf evaluation** — if the rollout cap is reached before a terminal,
//!     `material_heuristic` returns `GameResult::Value(f64)` (material balance
//!     in [-1, 1]).  Backprop handles this as a partial signal so information
//!     is never wasted even when games don't complete.
//!   * **No neural network** — the biases and the material heuristic are
//!     hand-crafted, not learned.
//!
//! Phase 2 replaces `material_heuristic` with a trained value-net query and
//! adds a policy-net prior to the UCT score, which is the standard AlphaZero
//! improvement path.

use crate::board::{Board, Move};
use crate::moves::{in_check, is_royal_piece, legal_moves, pseudo_legal};
use crate::rules::Rules;
use rand::seq::SliceRandom;
use rand::Rng;
use rand_xoshiro::Xoshiro256PlusPlus;

const C_UCT: f64 = 1.41421356; // sqrt(2)

#[derive(Debug)]
struct Node {
    visits: u32,
    /// Sum of rewards from the perspective of the side that just moved
    /// to *reach* this node. Range [-1, 1] per simulation.
    value_sum: f64,
    /// Untried moves at this node (drained as children are expanded).
    untried: Vec<Move>,
    /// (move_used_to_reach_child, child_index)
    children: Vec<(Move, usize)>,
    parent: Option<usize>,
    /// Side to move at this node (1 or 2).
    side_to_move: i32,
}

pub struct Mcts {
    pub iterations: u32,
    /// Hard cap on rollout depth so a runaway position cannot stall.
    pub rollout_cap: u32,
}

impl Mcts {
    pub fn new(iterations: u32) -> Self {
        Self {
            iterations,
            rollout_cap: 200,
        }
    }

    /// Choose a move for `board.turn` using `iterations` simulations.
    pub fn choose(
        &self,
        rng: &mut Xoshiro256PlusPlus,
        board: &Board,
        rules: &Rules,
    ) -> Option<Move> {
        let root_moves = legal_moves(board, rules);
        if root_moves.is_empty() {
            return None;
        }
        let root_side = board.turn;
        let mut nodes: Vec<Node> = Vec::with_capacity(self.iterations as usize + 16);
        nodes.push(Node {
            visits: 0,
            value_sum: 0.0,
            untried: root_moves,
            children: Vec::new(),
            parent: None,
            side_to_move: root_side,
        });

        for _ in 0..self.iterations {
            // ---- Selection ----
            let mut path: Vec<usize> = vec![0];
            let mut state = board.clone();
            let mut node_idx = 0usize;
            loop {
                let n = &nodes[node_idx];
                if !n.untried.is_empty() || n.children.is_empty() {
                    break;
                }
                let parent_visits = n.visits as f64;
                let mut best_child = 0usize;
                let mut best_score = f64::MIN;
                for (i, (_, ci)) in n.children.iter().enumerate() {
                    let c = &nodes[*ci];
                    let exploit = if c.visits == 0 {
                        0.0
                    } else {
                        c.value_sum / c.visits as f64
                    };
                    let explore = C_UCT * (parent_visits.ln() / (c.visits as f64 + 1.0)).sqrt();
                    let score = exploit + explore;
                    if score > best_score {
                        best_score = score;
                        best_child = i;
                    }
                }
                let (mv, ci) = nodes[node_idx].children[best_child].clone();
                let _ = state.apply(&mv, rules);
                node_idx = ci;
                path.push(node_idx);
            }

            // ---- Expansion ----
            let mut leaf_side_to_move = nodes[node_idx].side_to_move;
            if !nodes[node_idx].untried.is_empty() {
                let i = rng.gen_range(0..nodes[node_idx].untried.len());
                let mv = nodes[node_idx].untried.swap_remove(i);
                let _ = state.apply(&mv, rules);
                let next_legal = legal_moves(&state, rules);
                let new_idx = nodes.len();
                let new_side = state.turn;
                nodes.push(Node {
                    visits: 0,
                    value_sum: 0.0,
                    untried: next_legal,
                    children: Vec::new(),
                    parent: Some(node_idx),
                    side_to_move: new_side,
                });
                nodes[node_idx].children.push((mv, new_idx));
                node_idx = new_idx;
                path.push(node_idx);
                leaf_side_to_move = new_side;
            }

            // ---- Simulation (random rollout) ----
            let result = rollout(&mut state, rules, rng, self.rollout_cap);

            // ---- Backprop ----
            // `result` is from the perspective of `leaf_side_to_move`'s opponent
            // (i.e. the player who just moved to reach this leaf). Convert per
            // node: a node's stored value is from the perspective of the side
            // that *just* moved to land in that node, which equals `3 - side_to_move`.
            let _ = leaf_side_to_move; // silence unused if cap path
            for &n_idx in path.iter() {
                let n = &mut nodes[n_idx];
                let side_just_moved = if n.side_to_move == 1 { 2 } else { 1 };
                let reward = match result {
                    GameResult::Win(p) if p == side_just_moved => 1.0,
                    GameResult::Win(_) => -1.0,
                    GameResult::Draw => 0.0,
                    GameResult::Value(v) => {
                        // v is from player 1's perspective; flip sign for player 2.
                        if side_just_moved == 1 { v } else { -v }
                    }
                };
                n.visits += 1;
                n.value_sum += reward;
            }
        }

        // Pick child with most visits (robust child).
        let root = &nodes[0];
        root.children
            .iter()
            .max_by_key(|(_, ci)| nodes[*ci].visits)
            .map(|(mv, _)| mv.clone())
    }
}

#[derive(Clone, Copy, Debug)]
pub enum GameResult {
    Win(i32),
    Draw,
    /// Material-balance estimate at rollout cap, from player 1's perspective.
    /// Range: -1.0 (player 2 dominates) to +1.0 (player 1 dominates).
    Value(f64),
}

/// Compute a material-balance heuristic when the rollout cap is reached.
/// Returns Win/Draw only when one side has no pieces; otherwise Value(v)
/// with v in [-1, 1] from player 1's perspective.
fn material_heuristic(state: &Board, rules: &Rules) -> GameResult {
    let mut p1_val: f64 = 0.0;
    let mut p2_val: f64 = 0.0;
    for p in &state.pieces {
        let v = rules.piece(p.piece_id).map(|t| {
            let base = t.piece_value as f64;
            // Treat key-piece targets as higher value so the search
            // actively hunts them even in the shallow heuristic.
            if t.ends_game_on_capture { base + 10.0 } else { base }
        }).unwrap_or(1.0);
        if p.player == 1 { p1_val += v; } else { p2_val += v; }
    }
    let total = p1_val + p2_val;
    if total <= 0.0 {
        return GameResult::Draw;
    }
    GameResult::Value((p1_val - p2_val) / total)
}

/// Apply random moves until terminal or cap reached.
///
/// Performance note: rollouts intentionally use *pseudo-legal* moves rather
/// than the full check-filtered legal-move set. The legality filter is
/// quadratic-ish in piece count (apply each move, then `in_check` scans every
/// opponent attack), and at 200-iter MCTS × 200-ply rollouts it dominates
/// the entire training cost. Instead, we treat a move that captures an
/// opposing royal piece as an immediate win (which is exactly what would
/// happen one ply later under full legality anyway), and only fall back to
/// the legal-move set when no pseudo move is available, to distinguish
/// stalemate from checkmate.
pub fn rollout(
    state: &mut Board,
    rules: &Rules,
    rng: &mut Xoshiro256PlusPlus,
    cap: u32,
) -> GameResult {
    rollout_with_reason(state, rules, rng, cap).0
}

/// Same as `rollout` but also returns the [`EndReason`] that terminated the
/// rollout. Used by self-play so the trainer can report *why* a game drew.
pub fn rollout_with_reason(
    state: &mut Board,
    rules: &Rules,
    rng: &mut Xoshiro256PlusPlus,
    cap: u32,
) -> (GameResult, crate::protocol::EndReason) {
    use crate::protocol::EndReason;
    for _ in 0..cap {
        let mover = state.turn;
        let moves = pseudo_legal(state, rules);
        if moves.is_empty() {
            // Fall back to the (slow) legality filter only at terminals so
            // we can correctly distinguish stalemate from checkmate.
            let legal = legal_moves(state, rules);
            if legal.is_empty() {
                if rules.game.mate_condition && in_check(state, rules, state.turn) {
                    return (
                        GameResult::Win(if state.turn == 1 { 2 } else { 1 }),
                        EndReason::Checkmate,
                    );
                }
                if rules.game.stalemate_win_condition {
                    return (GameResult::Win(state.turn), EndReason::StalemateWin);
                }
                if rules.game.no_moves_condition {
                    return (
                        GameResult::Win(if state.turn == 1 { 2 } else { 1 }),
                        EndReason::NoMovesLoss,
                    );
                }
                return (GameResult::Draw, EndReason::Stalemate);
            }
            // Pseudo was empty but legal isn't (shouldn't happen, but be safe).
            let mv = legal.choose(rng).unwrap().clone();
            let _ = state.apply(&mv, rules);
            continue;
        }

        // Heuristic: prefer captures so rollouts decide faster, and *strongly*
        // prefer royal captures (which terminate the game). Only short-circuit
        // when requires_all is NOT set — if all ends_game_on_capture pieces must
        // be removed, one royal capture doesn't end the game; fall through so
        // the capture_condition check can evaluate the remaining pieces.
        if !rules.game.capture_condition_requires_all {
            let mut royal_target: Option<i32> = None;
            for m in &moves {
                if let Some(cap_id) = m.capture {
                    if let Some(target) = state.pieces.iter().find(|p| p.id == cap_id) {
                        if is_royal_piece(rules, target.piece_id) {
                            // Only short-circuit if the attack will actually kill the target.
                            // With HP > 1, an attack that doesn't kill is not a win yet.
                            let would_kill = m.hp_damage == 0 || target.current_hp <= m.hp_damage;
                            if would_kill {
                                royal_target = Some(target.player);
                                break;
                            }
                        }
                    }
                }
            }
            if royal_target.is_some() {
                // Capturing the opponent's royal is an immediate, decisive win.
                return (GameResult::Win(mover), EndReason::RoyalCapture);
            }
        }

        let mv = pick_rollout_move(&moves, state, rules, rng, mover, false).clone();
        let captured_id = mv.capture;
        let rollout_result = state.apply(&mv, rules);
        let had_kill = rollout_result.any_killed();
        // capture_condition: evaluate win after every kill.
        if rules.game.capture_condition && (had_kill || captured_id.is_some()) {
            let requires_all = rules.game.capture_condition_requires_all;
            let check_side_gone = |player: i32| -> bool {
                if let Some(cp_id) = rules.game.capture_piece {
                    !state.pieces.iter().any(|p| p.player == player
                        && (p.piece_id == cp_id
                            || rules.piece(p.piece_id)
                                .map(|t| t.real_piece_id == cp_id || t.id == cp_id)
                                .unwrap_or(false)))
                } else if requires_all {
                    !state.pieces.iter().any(|p| p.player == player
                        && rules.piece(p.piece_id)
                            .map(|t| t.ends_game_on_capture)
                            .unwrap_or(false))
                } else {
                    !state.pieces.iter().any(|p| p.player == player)
                }
            };
            let p1_gone = check_side_gone(1);
            let p2_gone = check_side_gone(2);
            if p1_gone && p2_gone {
                return (GameResult::Draw, EndReason::CaptureCondition);
            } else if p1_gone {
                return (GameResult::Win(2), EndReason::CaptureCondition);
            } else if p2_gone {
                return (GameResult::Win(1), EndReason::CaptureCondition);
            }
        }
        // squares_condition: update consecutive holding counter; check for winner.
        if rules.game.squares_condition && !rules.control_squares.is_empty() {
            update_control_tracking(state, rules);
            if let Some(winner) = check_squares_winner(state, rules) {
                return (GameResult::Win(winner), EndReason::SquaresCondition);
            }
        }
        if let Some(limit) = rules.game.draw_move_limit {
            if state.plies_since_capture as i32 >= limit * 2 {
                return (GameResult::Draw, EndReason::MoveLimit);
            }
        }
    }
    (material_heuristic(state, rules), EndReason::RolloutCap)
}

/// Aggressive variant of [`rollout_with_reason`] used by self-play past the
/// 400-ply cap. Differences from the regular rollout:
///   * always takes a capture when one is available (vs. 50/50)
///   * among non-capture moves, biases toward moves whose destination is
///     further from the moving player's home edge — this is a cheap proxy
///     for "advance promotable pieces toward their promotion rank" that
///     doesn't require parsing promotion-square JSON for every variant.
///   * also honors the fifty-move draw rule and a lightweight royals-only
///     insufficient-material check so forced draw conditions can still
///     fire inside the rollout.
pub fn rollout_with_reason_aggressive(
    state: &mut Board,
    rules: &Rules,
    rng: &mut Xoshiro256PlusPlus,
    cap: u32,
) -> (GameResult, crate::protocol::EndReason) {
    use crate::protocol::EndReason;
    let board_height = rules.board_height();
    for _ in 0..cap {
        // Insufficient-material check inside the rollout too — in mate-only
        // variants, once only royals remain nothing can force a result.
        if rules.game.mate_condition
            && !state.pieces.is_empty()
            && state.pieces.iter().all(|p| is_royal_piece(rules, p.piece_id))
        {
            return (GameResult::Draw, EndReason::InsufficientMaterial);
        }

        let mover = state.turn;
        let moves = pseudo_legal(state, rules);
        if moves.is_empty() {
            let legal = legal_moves(state, rules);
            if legal.is_empty() {
                if rules.game.mate_condition && in_check(state, rules, state.turn) {
                    return (
                        GameResult::Win(if state.turn == 1 { 2 } else { 1 }),
                        EndReason::Checkmate,
                    );
                }
                if rules.game.stalemate_win_condition {
                    return (GameResult::Win(state.turn), EndReason::StalemateWin);
                }
                if rules.game.no_moves_condition {
                    return (
                        GameResult::Win(if state.turn == 1 { 2 } else { 1 }),
                        EndReason::NoMovesLoss,
                    );
                }
                return (GameResult::Draw, EndReason::Stalemate);
            }
            let mv = legal.choose(rng).unwrap().clone();
            let _ = state.apply(&mv, rules);
            continue;
        }

        // Prioritize royal captures (decisive). Only meaningful in
        // non-mate_condition variants — in mate_condition games the
        // self-play loop rewrites this outcome to an indeterminate draw.
        // Skip the short-circuit when requires_all is set — one royal capture
        // doesn't end the game, so we must not report it as a decisive win.
        if !rules.game.capture_condition_requires_all {
            for m in &moves {
                if let Some(cap_id) = m.capture {
                    if let Some(target) = state.pieces.iter().find(|p| p.id == cap_id) {
                        if is_royal_piece(rules, target.piece_id) {
                            // Only short-circuit if the attack will actually kill (HP check).
                            let would_kill = m.hp_damage == 0 || target.current_hp <= m.hp_damage;
                            if would_kill {
                                return (GameResult::Win(mover), EndReason::RoyalCapture);
                            }
                        }
                    }
                }
            }
        }

        // If squares_condition is active, bias strongly (80%) toward moves
        // that land on a control square, overriding the aggressive capture preference.
        let mv = pick_rollout_move(&moves, state, rules, rng, mover, true).clone();
        let _ = board_height; // reserved for future promotion-square heuristics
        let captured_id = mv.capture;
        let rollout_result2 = state.apply(&mv, rules);
        let had_kill2 = rollout_result2.any_killed();
        // capture_condition: evaluate win after every kill.
        if rules.game.capture_condition && (had_kill2 || captured_id.is_some()) {
            let requires_all = rules.game.capture_condition_requires_all;
            let check_side_gone = |player: i32| -> bool {
                if let Some(cp_id) = rules.game.capture_piece {
                    !state.pieces.iter().any(|p| p.player == player
                        && (p.piece_id == cp_id
                            || rules.piece(p.piece_id)
                                .map(|t| t.real_piece_id == cp_id || t.id == cp_id)
                                .unwrap_or(false)))
                } else if requires_all {
                    !state.pieces.iter().any(|p| p.player == player
                        && rules.piece(p.piece_id)
                            .map(|t| t.ends_game_on_capture)
                            .unwrap_or(false))
                } else {
                    !state.pieces.iter().any(|p| p.player == player)
                }
            };
            let p1_gone = check_side_gone(1);
            let p2_gone = check_side_gone(2);
            if p1_gone && p2_gone {
                return (GameResult::Draw, EndReason::CaptureCondition);
            } else if p1_gone {
                return (GameResult::Win(2), EndReason::CaptureCondition);
            } else if p2_gone {
                return (GameResult::Win(1), EndReason::CaptureCondition);
            }
        }
        // squares_condition: update consecutive holding counter; check for winner.
        if rules.game.squares_condition && !rules.control_squares.is_empty() {
            update_control_tracking(state, rules);
            if let Some(winner) = check_squares_winner(state, rules) {
                return (GameResult::Win(winner), EndReason::SquaresCondition);
            }
        }
        if let Some(limit) = rules.game.draw_move_limit {
            if state.plies_since_capture as i32 >= limit * 2 {
                return (GameResult::Draw, EndReason::MoveLimit);
            }
        }
    }
    (material_heuristic(state, rules), EndReason::RolloutCap)
}

// ---------------------------------------------------------------------------
// Control-square helpers (pub so selfplay.rs can call them too).
// ---------------------------------------------------------------------------

/// Update each player's consecutive-control-half-turn counter on `board`.
/// Call this immediately after every `board.apply()` when `squares_condition`
/// is active.  Index 0 = player 1, index 1 = player 2.
pub fn update_control_tracking(board: &mut Board, rules: &Rules) {
    if rules.control_squares.is_empty() {
        return;
    }
    let need = rules.game.squares_count.unwrap_or(rules.control_squares.len() as i32);
    for player_idx in 0..2usize {
        let player = (player_idx as i32) + 1;
        let held = rules
            .control_squares
            .iter()
            .filter(|cs| {
                board.pieces.iter().any(|p| {
                    p.player == player
                        && p.x == cs.x
                        && p.y == cs.y
                        // If requireSpecificPiece is set, only pieces with
                        // can_control_squares = true may claim this square.
                        && (!cs.require_specific_piece
                            || rules
                                .piece(p.piece_id)
                                .map(|t| t.can_control_squares)
                                .unwrap_or(false))
                })
            })
            .count() as i32;
        if held >= need {
            board.control_half_turns[player_idx] += 1;
        } else {
            board.control_half_turns[player_idx] = 0;
        }
    }
}

/// Returns `Some(winner_player)` if `squares_condition` is now satisfied for
/// any player, `None` otherwise.
pub fn check_squares_winner(board: &Board, rules: &Rules) -> Option<i32> {
    if !rules.game.squares_condition || rules.control_squares.is_empty() {
        return None;
    }
    for player_idx in 0..2usize {
        if board.control_half_turns[player_idx] >= rules.control_half_turns_required {
            return Some((player_idx as i32) + 1);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Multi-tier biased move selection (shared by both rollout variants).
// ---------------------------------------------------------------------------

/// Select a move from `moves` using a priority-ordered bias heuristic.
///
/// **Priority order (highest first)**:
///
/// 1. **Promotion** (85 %) — `can_promote` piece lands on a promotion square.
///    Mirrors `checkPromotionEligibility` in game-socket.js.
/// 2. **Control squares** (70 % standard / 80 % aggressive) — any piece lands
///    on a control square when `squares_condition` is active.  Gives MCTS a
///    meaningful gradient for King-of-the-Hill / squares-win variants.
/// 3. **Range squares** (40 %) — any piece lands on a range-bonus square,
///    gaining extra movement distance on its *next* turn.  Mild bias because
///    the benefit is indirect.
/// 4. **Capture** (50 % standard / 100 % aggressive) — speeds up rollout
///    convergence and is correct for most variants.
/// 5. **Forward advance** (aggressive only, 80 %) — among non-capture moves,
///    prefer moves that advance toward the opponent's back rank.  Cheap proxy
///    for "get promotable pieces toward the promotion zone".
/// 6. **Random** — fallthrough.
///
/// Custom squares (entries in `special_squares_string` with multiple flags set)
/// are handled automatically — they appear in both the relevant tier lists
/// (`control_squares`, `range_squares`, etc.) because `Rules` already merged
/// them during construction.
pub fn pick_rollout_move<'a>(
    moves: &'a [Move],
    state: &Board,
    rules: &Rules,
    rng: &mut Xoshiro256PlusPlus,
    mover: i32,
    aggressive: bool,
) -> &'a Move {
    // Tier 1: Promotion — strong bias for games with promotion squares.
    if !rules.promotion_squares.is_empty() {
        let promo: Vec<&Move> = moves
            .iter()
            .filter(|m| {
                rules
                    .promotion_squares
                    .iter()
                    .any(|&(px, py)| m.to.x == px && m.to.y == py)
                    && state
                        .pieces
                        .iter()
                        .any(|p| p.id == m.piece_id
                            && rules
                                .piece(p.piece_id)
                                .map(|t| t.can_promote)
                                .unwrap_or(false))
            })
            .collect();
        if !promo.is_empty() && rng.gen_bool(0.85) {
            return *promo.choose(rng).unwrap();
        }
    }

    // Tier 2: Control squares.
    if rules.game.squares_condition && !rules.control_squares.is_empty() {
        let ctrl: Vec<&Move> = moves
            .iter()
            .filter(|m| {
                rules
                    .control_squares
                    .iter()
                    .any(|cs| m.to.x == cs.x && m.to.y == cs.y)
            })
            .collect();
        let ctrl_bias = if aggressive { 0.8 } else { 0.7 };
        if !ctrl.is_empty() && rng.gen_bool(ctrl_bias) {
            return *ctrl.choose(rng).unwrap();
        }
    }

    // Tier 3: Range squares (positional benefit on next turn).
    if !rules.range_squares.is_empty() {
        let range: Vec<&Move> = moves
            .iter()
            .filter(|m| {
                rules
                    .range_squares
                    .iter()
                    .any(|&(rx, ry)| m.to.x == rx && m.to.y == ry)
            })
            .collect();
        if !range.is_empty() && rng.gen_bool(0.4) {
            return *range.choose(rng).unwrap();
        }
    }

    // Tier 4: Capture preference.
    let captures: Vec<&Move> = moves.iter().filter(|m| m.capture.is_some()).collect();
    if !captures.is_empty() {
        let threshold = if aggressive { 1.0 } else { 0.5 };
        if rng.gen_bool(threshold) {
            return *captures.choose(rng).unwrap();
        }
    }

    // Tier 5: Forward bias (aggressive mode only).
    if aggressive {
        let target_forward = |m: &Move| -> i32 {
            if mover == 1 { m.to.y - m.from.y } else { m.from.y - m.to.y }
        };
        let best_score = moves.iter().map(|m| target_forward(m)).max().unwrap_or(0);
        if rng.gen_bool(0.8) {
            let forward: Vec<&Move> = moves
                .iter()
                .filter(|m| target_forward(m) == best_score)
                .collect();
            if !forward.is_empty() {
                return *forward.choose(rng).unwrap();
            }
        }
    }

    // Tier 6: Random fallthrough.
    moves.choose(rng).unwrap()
}
