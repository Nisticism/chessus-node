//! Compact mutable board state for self-play.
//!
//! A `Board` owns a flat `Vec<Option<PieceOnBoard>>` indexed by
//! `y * width + x`, plus a `Vec<PieceOnBoard>` of all live pieces for fast
//! iteration. Cloning is cheap and used heavily by MCTS rollouts.

use crate::rules::Rules;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Coord {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PieceOnBoard {
    /// Stable per-board identity; assigned at board init.
    pub id: u32,
    pub piece_id: i64,
    pub player: i32,
    pub x: i32,
    pub y: i32,
    pub move_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Move {
    pub piece_id: u32,
    pub from: Coord,
    pub to: Coord,
    pub capture: Option<u32>,
    /// e.g. castling target rook id
    pub partner: Option<u32>,
    pub is_castling: bool,
    pub is_promotion: bool,
    pub promote_to: Option<i64>,
    /// When true, this move creates an en passant target on the board.
    /// Board::apply() uses this to set en_passant_target. Set by the
    /// move generator for first-move multi-square advances on pieces
    /// with can_en_passant.
    #[serde(default)]
    pub creates_en_passant: bool,
}

/// En passant target — set after a piece makes a multi-square first-move
/// advance (e.g. pawn double-step). Valid for exactly one half-turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnPassantTarget {
    /// Board instance id of the piece that is vulnerable to en passant.
    pub victim_id: u32,
    /// Current board position of the vulnerable piece.
    pub victim_pos: Coord,
    /// The square the capturing piece moves to (the "passed through" square).
    pub capture_square: Coord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub width: i32,
    pub height: i32,
    pub pieces: Vec<PieceOnBoard>,
    /// Whose turn it is (1 or 2).
    pub turn: i32,
    /// Move counter for draw-by-N-moves-without-capture detection.
    pub plies_since_capture: u32,
    pub ply: u32,
    #[serde(default)]
    pub next_id: u32,
    /// Consecutive half-turns each player (index 0 = player 1, index 1 = player 2)
    /// has held enough control squares. Compared against Rules::control_half_turns_required.
    /// Reset to 0 the moment a player drops below the required square count.
    #[serde(default)]
    pub control_half_turns: [u32; 2],
    /// En passant target — set after a piece's first-move multi-square advance.
    /// Valid for exactly one half-turn (cleared at the start of every apply()).
    #[serde(default)]
    pub en_passant_target: Option<EnPassantTarget>,
}

impl Board {
    pub fn from_rules(rules: &Rules) -> Self {
        let mut b = Self {
            width: rules.board_width(),
            height: rules.board_height(),
            pieces: Vec::with_capacity(rules.starting_positions.len()),
            turn: 1,
            plies_since_capture: 0,
            ply: 0,
            next_id: 0,
            control_half_turns: [0; 2],
            en_passant_target: None,
        };
        for sp in &rules.starting_positions {
            let id = b.next_id;
            b.next_id += 1;
            b.pieces.push(PieceOnBoard {
                id,
                piece_id: sp.piece_id,
                player: sp.player_number,
                x: sp.x,
                y: sp.y,
                move_count: 0,
            });
        }
        b
    }

    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.width && y < self.height
    }

    pub fn at(&self, x: i32, y: i32) -> Option<&PieceOnBoard> {
        self.pieces.iter().find(|p| p.x == x && p.y == y)
    }

    pub fn at_idx(&self, x: i32, y: i32) -> Option<usize> {
        self.pieces.iter().position(|p| p.x == x && p.y == y)
    }

    pub fn apply(&mut self, mv: &Move) {
        // En passant targets are only valid for exactly one half-turn.
        // Always clear at the start of apply() before possibly setting a new one.
        self.en_passant_target = None;

        // Remove captured piece (if any) before moving.
        // For en passant the captured piece is NOT at mv.to — it is at its own
        // position — but we remove by id so the position doesn't matter.
        if let Some(cap_id) = mv.capture {
            if let Some(idx) = self.pieces.iter().position(|p| p.id == cap_id) {
                self.pieces.remove(idx);
            }
            self.plies_since_capture = 0;
        } else {
            self.plies_since_capture += 1;
        }
        // Move the moving piece.
        if let Some(piece) = self.pieces.iter_mut().find(|p| p.id == mv.piece_id) {
            piece.x = mv.to.x;
            piece.y = mv.to.y;
            piece.move_count += 1;
            if mv.is_promotion {
                if let Some(new_pid) = mv.promote_to {
                    piece.piece_id = new_pid;
                }
            }
        }
        // Set a new en passant target if this move creates one.
        // The capture square is one step from the starting square in the
        // direction of movement (the square the piece "passed through").
        if mv.creates_en_passant {
            let sign_y = (mv.to.y - mv.from.y).signum();
            let cap_sq = Coord {
                x: mv.to.x,
                y: mv.from.y + sign_y,
            };
            self.en_passant_target = Some(EnPassantTarget {
                victim_id: mv.piece_id,
                victim_pos: Coord { x: mv.to.x, y: mv.to.y },
                capture_square: cap_sq,
            });
        }
        // Handle castling partner (rook hops adjacent to king on the king's other side).
        if mv.is_castling {
            if let Some(partner_id) = mv.partner {
                if let (Some(king), Some(rook_idx)) = (
                    self.pieces.iter().find(|p| p.id == mv.piece_id).cloned(),
                    self.pieces.iter().position(|p| p.id == partner_id),
                ) {
                    // Rook lands on the square the king crossed.
                    let dir = (mv.to.x - mv.from.x).signum();
                    if dir != 0 {
                        let rook = &mut self.pieces[rook_idx];
                        rook.x = king.x - dir;
                        rook.move_count += 1;
                    }
                }
            }
        }
        self.turn = if self.turn == 1 { 2 } else { 1 };
        self.ply += 1;
    }
}
