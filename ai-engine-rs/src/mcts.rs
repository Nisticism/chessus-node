//! UCT (Upper-Confidence-bound applied to Trees) Monte-Carlo Tree Search
//! with random rollouts.
//!
//! No neural network yet — this is the "scaffold" version that produces
//! genuinely-learning self-play games (since stronger MCTS thinking improves
//! with more iterations even without a learned policy/value net). Phase 2
//! replaces `rollout` with a value-net query and the prior with a
//! policy-net softmax.

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
                state.apply(&mv);
                node_idx = ci;
                path.push(node_idx);
            }

            // ---- Expansion ----
            let mut leaf_side_to_move = nodes[node_idx].side_to_move;
            if !nodes[node_idx].untried.is_empty() {
                let i = rng.gen_range(0..nodes[node_idx].untried.len());
                let mv = nodes[node_idx].untried.swap_remove(i);
                state.apply(&mv);
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
                return (GameResult::Draw, EndReason::Stalemate);
            }
            // Pseudo was empty but legal isn't (shouldn't happen, but be safe).
            let mv = legal.choose(rng).unwrap().clone();
            state.apply(&mv);
            continue;
        }

        // Heuristic: prefer captures so rollouts decide faster, and *strongly*
        // prefer royal captures (which terminate the game).
        let mut royal_target: Option<i32> = None;
        for m in &moves {
            if let Some(cap_id) = m.capture {
                if let Some(target) = state.pieces.iter().find(|p| p.id == cap_id) {
                    if is_royal_piece(rules, target.piece_id) {
                        royal_target = Some(target.player);
                        break;
                    }
                }
            }
        }
        if royal_target.is_some() {
            // Capturing the opponent's royal is an immediate, decisive win.
            return (GameResult::Win(mover), EndReason::RoyalCapture);
        }
        let captures: Vec<&Move> = moves.iter().filter(|m| m.capture.is_some()).collect();
        let mv = if !captures.is_empty() && rng.gen_bool(0.5) {
            (*captures.choose(rng).unwrap()).clone()
        } else {
            moves.choose(rng).unwrap().clone()
        };
        state.apply(&mv);
        if let Some(limit) = rules.game.draw_move_limit {
            if state.plies_since_capture as i32 >= limit * 2 {
                return (GameResult::Draw, EndReason::MoveLimit);
            }
        }
    }
    (GameResult::Draw, EndReason::RolloutCap)
}
