//! Simultaneous-turns self-play.
//!
//! Mirrors the live-game `resolveSimulRound` behavior in
//! `server/game-socket.js`, simplified for AI-vs-AI training:
//!
//! * No human confirmation, no stage-mode, no socket buffering — both
//!   sides just call MCTS independently from the same starting board
//!   each round and we resolve the two moves together.
//! * Same-square cancellations are detected and counted toward the
//!   `simul_turns_draw_after_cancellations` threshold.
//! * Swap moves (each piece lands on the other's source square) are
//!   handled atomically so neither piece is reported as captured.
//! * "Safely moving" pieces — those whose move is a non-capture — escape
//!   any incoming capture attempt, matching the live server bugfix.
//! * Post-resolution checks fire in the same priority order as the live
//!   server: cancellation draw → simul-capture draw → simul-checkmate
//!   draw → standard win conditions.

use crate::board::{Board, Move, PieceOnBoard};
use crate::mcts::{check_squares_winner, update_control_tracking, GameResult, Mcts};
use crate::moves::{in_check, is_royal_piece, legal_moves};
use crate::protocol::EndReason;
use crate::rules::Rules;
use rand_xoshiro::Xoshiro256PlusPlus;
use std::collections::HashMap;

/// Outcome of a complete simul-turns game, used by selfplay.rs.
pub struct SimulOutcome {
    pub result: GameResult,
    pub end_reason: EndReason,
    pub moves_played: u32,
    pub move_lines: Vec<String>,
}

/// Hard cap on simul rounds before we declare an indeterminate draw.
/// One round is two moves so this is effectively the standard 400-ply cap.
const SIMUL_ROUND_CAP: u32 = 200;

pub fn play_simul_game(
    board: &mut Board,
    rules: &Rules,
    mcts: &Mcts,
    rng: &mut Xoshiro256PlusPlus,
    log_moves: bool,
) -> SimulOutcome {
    let mut moves_played: u32 = 0;
    let mut move_lines: Vec<String> = Vec::new();
    let mut cancellation_count: i32 = 0;
    let cancel_threshold = rules.game.simul_turns_draw_after_cancellations.max(0);
    let mut position_history: HashMap<String, u32> = HashMap::new();
    position_history.insert(crate::book::position_signature(board, rules), 1);
    let mut consecutive_no_moves: u32 = 0;

    let (result, end_reason) = loop {
        if moves_played / 2 >= SIMUL_ROUND_CAP {
            break (GameResult::Draw, EndReason::MoveCapRollout);
        }

        // Each side picks a move from the SAME board state. We clone the
        // board and force-set turn so the MCTS root believes it is that
        // player's turn. Captures and royal-king assumptions inside MCTS
        // remain relative to the cloned board's `turn`.
        let p1_move = pick_for_player(board, rules, mcts, rng, 1);
        let p2_move = pick_for_player(board, rules, mcts, rng, 2);

        // ---- No-legal-moves handling ----
        // If both sides have no legal moves: standard end-of-game checks
        // (mirrors the legal_moves==empty branch in standard self-play).
        if p1_move.is_none() && p2_move.is_none() {
            // Apply the same priority chain as the standard loop, but for
            // both sides at once.
            let p1_in_check = in_check(board, rules, 1);
            let p2_in_check = in_check(board, rules, 2);
            if rules.game.mate_condition && p1_in_check && p2_in_check {
                // Both checkmated — simul-checkmate draw if enabled, else
                // pick neither (draw).
                break (GameResult::Draw, EndReason::SimultaneousCheckmateDraw);
            }
            if rules.game.mate_condition && p1_in_check {
                break (GameResult::Win(2), EndReason::Checkmate);
            }
            if rules.game.mate_condition && p2_in_check {
                break (GameResult::Win(1), EndReason::Checkmate);
            }
            if rules.game.stalemate_win_condition {
                // Both stuck — declare draw rather than picking one winner.
                break (GameResult::Draw, EndReason::StalemateWin);
            }
            if rules.game.no_moves_condition {
                break (GameResult::Draw, EndReason::NoMovesLoss);
            }
            if rules.game.stalemate_draw_condition {
                break (GameResult::Draw, EndReason::Stalemate);
            }
            consecutive_no_moves += 1;
            if consecutive_no_moves >= 2 {
                break (GameResult::Draw, EndReason::NoMove);
            }
            // No applicable rule — extremely unusual; treat as non-decisive.
            break (GameResult::Draw, EndReason::NoMove);
        }
        consecutive_no_moves = 0;

        // ---- Cancellation: same destination square ----
        let same_dest = match (&p1_move, &p2_move) {
            (Some(a), Some(b)) => a.to == b.to,
            _ => false,
        };
        if same_dest {
            cancellation_count += 1;
            moves_played += 1;
            if log_moves {
                let p1m = p1_move.as_ref().unwrap();
                let p2m = p2_move.as_ref().unwrap();
                move_lines.push(format!(
                    "  R{}. CANCELLED — both targeted {} (P1 {} ; P2 {}) [count {}]",
                    moves_played,
                    coord_to_notation(p1m.to.x, p1m.to.y, rules.board_height()),
                    move_notation(p1m, board, rules),
                    move_notation(p2m, board, rules),
                    cancellation_count,
                ));
            }
            if cancel_threshold > 0 && cancellation_count >= cancel_threshold {
                break (GameResult::Draw, EndReason::CancellationDraw);
            }
            continue;
        }

        // ---- Apply both moves atomically ----
        let p1m = p1_move.as_ref();
        let p2m = p2_move.as_ref();

        // Detect a swap (each piece lands on the other's source square).
        let is_swap = match (p1m, p2m) {
            (Some(a), Some(b)) => a.to == b.from && b.to == a.from,
            _ => false,
        };

        // For move-line logging, capture piece & captured names BEFORE we mutate.
        let p1_log = p1m.map(|m| build_move_line(m, board, rules, 1));
        let p2_log = p2m.map(|m| build_move_line(m, board, rules, 2));

        let mut captured_this_round: Vec<PieceOnBoard> = Vec::new();
        if is_swap {
            // Swap atomically — no captures.
            let (a, b) = (p1m.unwrap(), p2m.unwrap());
            if let Some(idx_a) = board.pieces.iter().position(|p| p.id == a.piece_id) {
                board.pieces[idx_a].x = a.to.x;
                board.pieces[idx_a].y = a.to.y;
                board.pieces[idx_a].move_count += 1;
            }
            if let Some(idx_b) = board.pieces.iter().position(|p| p.id == b.piece_id) {
                board.pieces[idx_b].x = b.to.x;
                board.pieces[idx_b].y = b.to.y;
                board.pieces[idx_b].move_count += 1;
            }
        } else {
            // Build "safely moving" set — pieces whose move is a non-capture
            // escape any incoming capture.
            let mut safely_moving: std::collections::HashSet<u32> =
                std::collections::HashSet::new();
            if let Some(m) = p1m {
                if m.capture.is_none() {
                    safely_moving.insert(m.piece_id);
                }
            }
            if let Some(m) = p2m {
                if m.capture.is_none() {
                    safely_moving.insert(m.piece_id);
                }
            }
            // Process captures first — but skip captures that target a
            // safely-moving piece (the victim moved out of the way this round).
            for mv in [p1m, p2m].iter().flatten() {
                if let Some(cap_id) = mv.capture {
                    if safely_moving.contains(&cap_id) {
                        continue;
                    }
                    if let Some(idx) = board.pieces.iter().position(|p| p.id == cap_id) {
                        captured_this_round.push(board.pieces[idx].clone());
                        board.pieces.remove(idx);
                    }
                }
            }
            // Apply both movements (and promotions). If both pieces target
            // the SAME square but it's not detected as a same-dest cancel
            // (which we already returned from above), this branch never runs.
            for mv in [p1m, p2m].iter().flatten() {
                if let Some(idx) = board.pieces.iter().position(|p| p.id == mv.piece_id) {
                    board.pieces[idx].x = mv.to.x;
                    board.pieces[idx].y = mv.to.y;
                    board.pieces[idx].move_count += 1;
                    if mv.is_promotion {
                        if let Some(new_pid) = mv.promote_to {
                            board.pieces[idx].piece_id = new_pid;
                        }
                    }
                }
            }
        }

        if !captured_this_round.is_empty() {
            board.plies_since_capture = 0;
        } else {
            board.plies_since_capture += 1;
        }
        board.ply += 2;
        // turn is meaningless in simul-turns; leave it alone.
        moves_played += 2;
        if log_moves {
            if let Some(line) = p1_log {
                move_lines.push(format!("  R{}. {}", moves_played, line));
            }
            if let Some(line) = p2_log {
                move_lines.push(format!("        {}", line));
            }
        }

        // ---- End-of-round win/draw checks (in priority order) ----

        // promotion_condition: a piece reached a promotion square.
        if rules.game.promotion_condition {
            let p1_promo = p1m.map(|m| m.is_promotion).unwrap_or(false);
            let p2_promo = p2m.map(|m| m.is_promotion).unwrap_or(false);
            if p1_promo && p2_promo {
                // Both reached a promotion square in the same round — draw.
                break (GameResult::Draw, EndReason::Promotion);
            } else if p1_promo {
                break (GameResult::Win(1), EndReason::Promotion);
            } else if p2_promo {
                break (GameResult::Win(2), EndReason::Promotion);
            }
        }

        // Royal/game-ending captures (mate_condition or capture_condition
        // with ends_game_on_capture pieces).
        if rules.game.mate_condition || rules.game.capture_condition {
            // Did each player capture an opposing royal/game-ending piece?
            let p1_killed_royal = captured_this_round.iter().any(|cap| {
                cap.player == 2 && is_royal_piece(rules, cap.piece_id)
            });
            let p2_killed_royal = captured_this_round.iter().any(|cap| {
                cap.player == 1 && is_royal_piece(rules, cap.piece_id)
            });
            if p1_killed_royal && p2_killed_royal {
                if rules.game.simul_turns_simultaneous_capture_draw {
                    break (GameResult::Draw, EndReason::SimultaneousCaptureDraw);
                }
                // If the draw rule is disabled, fall through to standard
                // capture/checkmate logic below — both sides could end up
                // with no royal, which the standard checks handle as a
                // mutual loss / draw.
            } else if p1_killed_royal {
                if rules.game.mate_condition {
                    break (GameResult::Win(1), EndReason::Checkmate);
                }
                break (GameResult::Win(1), EndReason::CaptureCondition);
            } else if p2_killed_royal {
                if rules.game.mate_condition {
                    break (GameResult::Win(2), EndReason::Checkmate);
                }
                break (GameResult::Win(2), EndReason::CaptureCondition);
            }
        }

        // lose_all_pieces_condition (anti-chess).
        if rules.game.lose_all_pieces_condition && !captured_this_round.is_empty() {
            let p1_count = board.pieces.iter().filter(|p| p.player == 1).count();
            let p2_count = board.pieces.iter().filter(|p| p.player == 2).count();
            if p1_count == 0 && p2_count == 0 {
                break (GameResult::Draw, EndReason::LoseAllPieces);
            } else if p1_count == 0 {
                break (GameResult::Win(1), EndReason::LoseAllPieces);
            } else if p2_count == 0 {
                break (GameResult::Win(2), EndReason::LoseAllPieces);
            }
        }

        // Generic capture_condition (no game-ending royal capture this
        // round, but a configured capture_piece may have been removed).
        if rules.game.capture_condition && !captured_this_round.is_empty() {
            let requires_all = rules.game.capture_condition_requires_all;
            let check_side_gone = |player: i32| -> bool {
                if let Some(cp_id) = rules.game.capture_piece {
                    !board.pieces.iter().any(|p| {
                        p.player == player
                            && (p.piece_id == cp_id
                                || rules
                                    .piece(p.piece_id)
                                    .map(|t| t.real_piece_id == cp_id || t.id == cp_id)
                                    .unwrap_or(false))
                    })
                } else if requires_all {
                    !board.pieces.iter().any(|p| {
                        p.player == player
                            && rules
                                .piece(p.piece_id)
                                .map(|t| t.ends_game_on_capture)
                                .unwrap_or(false)
                    })
                } else {
                    !board.pieces.iter().any(|p| p.player == player)
                }
            };
            let p1_gone = check_side_gone(1);
            let p2_gone = check_side_gone(2);
            if p1_gone && p2_gone {
                break (GameResult::Draw, EndReason::CaptureCondition);
            } else if p1_gone {
                break (GameResult::Win(2), EndReason::CaptureCondition);
            } else if p2_gone {
                break (GameResult::Win(1), EndReason::CaptureCondition);
            }
        }

        // squares_condition: update tracking and check.
        if rules.game.squares_condition && !rules.control_squares.is_empty() {
            update_control_tracking(board, rules);
            if let Some(winner) = check_squares_winner(board, rules) {
                break (GameResult::Win(winner), EndReason::SquaresCondition);
            }
        }

        // Simul-checkmate draw: both sides currently in checkmate (no
        // legal response and in check). We did not detect this above
        // because both sides DID have moves before resolution; check
        // post-resolution.
        if rules.game.mate_condition && rules.game.simul_turns_simultaneous_checkmate_draw {
            let p1_mated = is_in_checkmate(board, rules, 1);
            let p2_mated = is_in_checkmate(board, rules, 2);
            if p1_mated && p2_mated {
                break (GameResult::Draw, EndReason::SimultaneousCheckmateDraw);
            } else if p1_mated {
                break (GameResult::Win(2), EndReason::Checkmate);
            } else if p2_mated {
                break (GameResult::Win(1), EndReason::Checkmate);
            }
        }

        // Insufficient material (mate-only games where only royals remain).
        if rules.game.mate_condition
            && !board.pieces.is_empty()
            && board
                .pieces
                .iter()
                .all(|p| is_royal_piece(rules, p.piece_id))
        {
            break (GameResult::Draw, EndReason::InsufficientMaterial);
        }

        // draw_move_limit (50-move rule analog).
        if let Some(limit) = rules.game.draw_move_limit {
            if board.plies_since_capture as i32 >= limit * 2 {
                break (GameResult::Draw, EndReason::MoveLimit);
            }
        }
        // n-fold repetition.
        if let Some(rep_limit) = rules.game.repetition_draw_count {
            if rep_limit > 1 {
                let sig = crate::book::position_signature(board, rules);
                let count = position_history.entry(sig).and_modify(|c| *c += 1).or_insert(1);
                if (*count) as i32 >= rep_limit {
                    break (GameResult::Draw, EndReason::Repetition);
                }
            }
        }
    };

    SimulOutcome {
        result,
        end_reason,
        moves_played,
        move_lines,
    }
}

/// Run MCTS to pick a move for the given player from the current board
/// state. Clones the board and forces `turn = player` so MCTS treats this
/// as the rooted side.
fn pick_for_player(
    board: &Board,
    rules: &Rules,
    mcts: &Mcts,
    rng: &mut Xoshiro256PlusPlus,
    player: i32,
) -> Option<Move> {
    let mut b = board.clone();
    b.turn = player;
    if legal_moves(&b, rules).is_empty() {
        return None;
    }
    mcts.choose(rng, &b, rules)
}

/// True if the player is in check AND has no legal moves.
fn is_in_checkmate(board: &Board, rules: &Rules, player: i32) -> bool {
    if !in_check(board, rules, player) {
        return false;
    }
    let mut b = board.clone();
    b.turn = player;
    legal_moves(&b, rules).is_empty()
}

/// Build a notation string for one move (for the games.txt log).
fn build_move_line(mv: &Move, board: &Board, rules: &Rules, player: i32) -> String {
    format!("[P{}] {}", player, move_notation(mv, board, rules))
}

fn move_notation(mv: &Move, board: &Board, rules: &Rules) -> String {
    let board_height = rules.board_height();
    let piece_name = board
        .pieces
        .iter()
        .find(|p| p.id == mv.piece_id)
        .and_then(|bp| rules.piece(bp.piece_id))
        .map(|t| t.piece_name.as_str())
        .unwrap_or("Piece");
    let captured: Option<String> = mv.capture.and_then(|cap_id| {
        board
            .pieces
            .iter()
            .find(|p| p.id == cap_id)
            .and_then(|cp| rules.piece(cp.piece_id))
            .map(|t| t.piece_name.clone())
    });
    let promo: Option<String> = if mv.is_promotion {
        mv.promote_to
            .and_then(|pid| rules.piece(pid))
            .map(|t| t.piece_name.clone())
    } else {
        None
    };
    let from = coord_to_notation(mv.from.x, mv.from.y, board_height);
    let to = coord_to_notation(mv.to.x, mv.to.y, board_height);
    let sep = if captured.is_some() { "x" } else { "-" };
    let promo_suffix = promo.as_deref().map(|n| format!("={}", n)).unwrap_or_default();
    let mut s = format!("{} {}{}{}{}", piece_name, from, sep, to, promo_suffix);
    if let Some(c) = captured {
        s.push_str(&format!(" (captures {})", c));
    }
    s
}

fn coord_to_notation(x: i32, y: i32, board_height: i32) -> String {
    if x < 0 || y < 0 {
        return "?".to_string();
    }
    let file = if x < 26 {
        (b'a' + x as u8) as char
    } else {
        '?'
    };
    format!("{}{}", file, board_height - y)
}
