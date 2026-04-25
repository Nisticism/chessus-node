//! Loads a rules.json dump produced by `server/ai/export-game-rules.js`
//! and exposes look-ups used by the move generator.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

pub use crate::protocol::{GameType, PieceTemplate, RulesDoc, StartingPosition};

// ---------------------------------------------------------------------------
// Internal helpers — shared JSON-keyed-"y,x" parsing utilities
// ---------------------------------------------------------------------------

/// Parse every key in a "y,x"-keyed JSON object string into (x, y) pairs.
fn parse_all_keys(s: &str) -> Vec<(i32, i32)> {
    let v: serde_json::Value = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let obj = match v.as_object() {
        Some(o) => o,
        None => return vec![],
    };
    let mut out = Vec::with_capacity(obj.len());
    for key in obj.keys() {
        if let Some((col, row)) = parse_yx_key(key) {
            out.push((col, row));
        }
    }
    out
}

/// Parse only keys whose entry has `{ <flag>: true }` set.
fn parse_flagged_keys(s: &str, flag: &str) -> Vec<(i32, i32)> {
    let v: serde_json::Value = match serde_json::from_str(s) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let obj = match v.as_object() {
        Some(o) => o,
        None => return vec![],
    };
    let mut out = Vec::new();
    for (key, val) in obj.iter() {
        if val.get(flag).and_then(|v| v.as_bool()).unwrap_or(false) {
            if let Some(coords) = parse_yx_key(key) {
                out.push(coords);
            }
        }
    }
    out
}

/// Split a "y,x" string into (x, y) — i.e. (col, row).
fn parse_yx_key(key: &str) -> Option<(i32, i32)> {
    let mut parts = key.splitn(2, ',');
    let row: i32 = parts.next()?.parse().ok()?;
    let col: i32 = parts.next()?.parse().ok()?;
    Some((col, row))
}

/// Merge squares from `base_string` (all keys) with flagged entries from
/// `special_string`.  Deduplicates.
fn merge_special_squares(
    base_string: Option<&str>,
    special_string: Option<&str>,
    flag: &str,
) -> Vec<(i32, i32)> {
    let mut squares: Vec<(i32, i32)> = Vec::new();
    if let Some(s) = base_string.filter(|s| !s.is_empty()) {
        squares.extend(parse_all_keys(s));
    }
    if let Some(s) = special_string.filter(|s| !s.is_empty()) {
        for sq in parse_flagged_keys(s, flag) {
            if !squares.contains(&sq) {
                squares.push(sq);
            }
        }
    }
    squares
}

// ---------------------------------------------------------------------------
// Per-string-type parsers
// ---------------------------------------------------------------------------

/// Parse control_squares_string (keyed "y,x") into a list of (x, y) board
/// coordinates and compute how many consecutive half-turns a player must hold
/// enough of those squares to win.
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
        if let Some(coords) = parse_yx_key(key) {
            squares.push(coords);
        }
        if let Some(tr) = val.get("turnsRequired").and_then(|v| v.as_u64()) {
            max_turns_required = max_turns_required.max(tr as u32);
        }
    }
    // Game-socket.js uses `halfTurnsRequired = turnsRequired * 2`.
    let half_turns_required = (max_turns_required * 2).max(1);
    (squares, half_turns_required)
}

/// Collect all promotion-square (x, y) coordinates:
///   `promotion_squares_string`  (all keys)
///   + `special_squares_string` entries where `asPromotion == true`.
fn parse_promotion_squares(game: &GameType) -> Vec<(i32, i32)> {
    merge_special_squares(
        game.promotion_squares_string.as_deref(),
        game.special_squares_string.as_deref(),
        "asPromotion",
    )
}

/// Collect all range-square (x, y) coordinates:
///   `range_squares_string`  (all keys)
///   + `special_squares_string` entries where `asRange == true`.
fn parse_range_square_coords(game: &GameType) -> Vec<(i32, i32)> {
    merge_special_squares(
        game.range_squares_string.as_deref(),
        game.special_squares_string.as_deref(),
        "asRange",
    )
}

// ---------------------------------------------------------------------------
// Rules struct
// ---------------------------------------------------------------------------

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
    /// Parsed (x, y) coordinates of all promotion squares (from
    /// `promotion_squares_string` + `asPromotion` in `special_squares_string`).
    /// Empty when no promotion squares are configured.
    pub promotion_squares: Vec<(i32, i32)>,
    /// Parsed (x, y) coordinates of all range squares (from
    /// `range_squares_string` + `asRange` in `special_squares_string`).
    /// Landing on one of these gives a piece a movement-range bonus on the
    /// next turn.
    pub range_squares: Vec<(i32, i32)>,
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
        let promotion_squares = parse_promotion_squares(&doc.game);
        let range_squares = parse_range_square_coords(&doc.game);
        let pieces: HashMap<i64, PieceTemplate> =
            doc.pieces.into_iter().map(|p| (p.id, p)).collect();
        Self {
            game: doc.game,
            pieces,
            starting_positions: doc.starting_positions,
            control_squares,
            control_half_turns_required,
            promotion_squares,
            range_squares,
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
