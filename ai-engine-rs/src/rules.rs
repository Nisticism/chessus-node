//! Loads a rules.json dump produced by `server/ai/export-game-rules.js`
//! and exposes look-ups used by the move generator.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

pub use crate::protocol::{GameType, PieceTemplate, RulesDoc, StartingPosition};

/// Parse control_squares_string (keyed "y,x") into a list of (x, y) board
/// coordinates and compute how many consecutive half-turns a player must hold
/// enough of those squares to win.
///
/// Returns `(squares, half_turns_required)`.  An empty `squares` vec means
/// the condition is either disabled or not configured.
fn parse_control_squares(game: &GameType) -> (Vec<(i32, i32)>, u32) {
    let s = match game.control_squares_string.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return (vec![], 2),
    };
    let parsed: serde_json::Value = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(_) => return (vec![], 2),
    };
    let obj = match parsed.as_object() {
        Some(o) => o,
        None => return (vec![], 2),
    };
    let mut squares: Vec<(i32, i32)> = Vec::with_capacity(obj.len());
    let mut max_turns_required: u32 = 1;
    for (key, val) in obj.iter() {
        // Key is "y,x" (row,col) — convert to (x, y).
        let mut parts = key.splitn(2, ',');
        if let (Some(row_s), Some(col_s)) = (parts.next(), parts.next()) {
            if let (Ok(row), Ok(col)) = (row_s.parse::<i32>(), col_s.parse::<i32>()) {
                squares.push((col, row));
            }
        }
        if let Some(tr) = val.get("turnsRequired").and_then(|v| v.as_u64()) {
            max_turns_required = max_turns_required.max(tr as u32);
        }
    }
    // Game-socket.js uses `halfTurnsRequired = turnsRequired * 2`.
    let half_turns_required = (max_turns_required * 2).max(1);
    (squares, half_turns_required)
}

/// All rule data for one game variant, indexed for fast access.
pub struct Rules {
    pub game: GameType,
    pub pieces: HashMap<i64, PieceTemplate>,
    pub starting_positions: Vec<StartingPosition>,
    /// Parsed (x, y) coordinates of all control squares.  Empty when
    /// `squares_condition` is off or no squares are configured.
    pub control_squares: Vec<(i32, i32)>,
    /// How many consecutive half-turns a player must hold ≥ `squares_count`
    /// (or all) control squares to win.  Mirrors `halfTurnsRequired` in the
    /// Node game-socket.  Defaults to 2 (one full round).
    pub control_half_turns_required: u32,
}

impl Rules {
    pub fn load(path: &Path) -> Result<Self> {
        let bytes = std::fs::read(path)
            .with_context(|| format!("reading rules file {}", path.display()))?;
        let doc: RulesDoc = serde_json::from_slice(&bytes)
            .with_context(|| format!("parsing rules file {}", path.display()))?;
        Ok(Self::from_doc(doc))
    }

    pub fn from_doc(doc: RulesDoc) -> Self {
        let (control_squares, control_half_turns_required) = parse_control_squares(&doc.game);
        let pieces: HashMap<i64, PieceTemplate> =
            doc.pieces.into_iter().map(|p| (p.id, p)).collect();
        Self {
            game: doc.game,
            pieces,
            starting_positions: doc.starting_positions,
            control_squares,
            control_half_turns_required,
        }
    }

    pub fn piece(&self, id: i64) -> Option<&PieceTemplate> {
        self.pieces.get(&id)
    }

    pub fn board_width(&self) -> i32 {
        self.game.board_width
    }
    pub fn board_height(&self) -> i32 {
        self.game.board_height
    }
}
