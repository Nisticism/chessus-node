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
        // Remove captured piece (if any) before moving.
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
