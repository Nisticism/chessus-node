//! Loads a rules.json dump produced by `server/ai/export-game-rules.js`
//! and exposes look-ups used by the move generator.

use anyhow::{Context, Result};
use std::collections::{HashMap, HashSet};
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

/// A single control square with optional `requireSpecificPiece` flag.
/// When `require_specific_piece` is true, only pieces whose template has
/// `can_control_squares = true` may claim this square for the squares_condition.
/// When false (the default) any piece occupying the square counts.
#[derive(Debug, Clone)]
pub struct ControlSquare {
    pub x: i32,
    pub y: i32,
    /// Mirrors the `requireSpecificPiece` flag in `control_squares_string`.
    pub require_specific_piece: bool,
}

/// Parse control_squares_string (keyed "y,x") into a list of ControlSquare and
/// compute how many consecutive half-turns a player must hold enough of those
/// squares to win.
fn parse_control_squares(game: &GameType) -> (Vec<ControlSquare>, u32) {
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
    let mut squares: Vec<ControlSquare> = Vec::with_capacity(obj.len());
    let mut max_turns_required: u32 = 1;
    for (key, val) in obj.iter() {
        if let Some((x, y)) = parse_yx_key(key) {
            let require_specific_piece = val
                .get("requireSpecificPiece")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            squares.push(ControlSquare { x, y, require_specific_piece });
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

/// Build a map of (x, y) -> range_bonus for all range squares (pre-cached to
/// avoid repeated JSON parsing in move generation).
fn parse_range_bonuses(game: &GameType) -> HashMap<(i32, i32), i32> {
    let mut out: HashMap<(i32, i32), i32> = HashMap::new();
    if let Some(s) = game.range_squares_string.as_deref().filter(|s| !s.is_empty()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
            if let Some(obj) = v.as_object() {
                for (key, val) in obj {
                    if let Some(coords) = parse_yx_key(key) {
                        let bonus = val.get("rangeBonus").and_then(|x| x.as_i64()).unwrap_or(1) as i32;
                        out.insert(coords, bonus);
                    }
                }
            }
        }
    }
    if let Some(s) = game.special_squares_string.as_deref().filter(|s| !s.is_empty()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
            if let Some(obj) = v.as_object() {
                for (key, val) in obj {
                    if val.get("asRange").and_then(|x| x.as_bool()).unwrap_or(false) {
                        if let Some(coords) = parse_yx_key(key) {
                            if !out.contains_key(&coords) {
                                let bonus = val.get("rangeBonus").and_then(|x| x.as_i64()).unwrap_or(1) as i32;
                                out.insert(coords, bonus);
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

/// Collect all `special_squares_string` entries where `flag == true` into a
/// HashSet of (x, y) coordinates. Returns an empty set when the string is
/// absent or contains no matching entries.
fn parse_flagged_set(game: &GameType, flag: &str) -> HashSet<(i32, i32)> {
    game.special_squares_string
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| parse_flagged_keys(s, flag).into_iter().collect())
        .unwrap_or_default()
}

/// Build a set of (x, y) squares where BOTH `flag_a` AND `flag_b` are true
/// in `special_squares_string`.
fn parse_dual_flagged_set(game: &GameType, flag_a: &str, flag_b: &str) -> HashSet<(i32, i32)> {
    let ss = match game.special_squares_string.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => return HashSet::new(),
    };
    let map: serde_json::Value = match serde_json::from_str(ss) {
        Ok(v) => v,
        Err(_) => return HashSet::new(),
    };
    let obj = match map.as_object() {
        Some(o) => o,
        None => return HashSet::new(),
    };
    let mut set = HashSet::new();
    for (key, val) in obj {
        let a = val.get(flag_a).and_then(|v| v.as_bool()).unwrap_or(false);
        let b = val.get(flag_b).and_then(|v| v.as_bool()).unwrap_or(false);
        if a && b {
            if let Some((x, y)) = parse_yx_key(key) {
                set.insert((x, y));
            }
        }
    }
    set
}

// ---------------------------------------------------------------------------
// Rules struct
// ---------------------------------------------------------------------------

/// All rule data for one game variant, indexed for fast access.
pub struct Rules {
    pub game: GameType,
    pub pieces: HashMap<i64, PieceTemplate>,
    pub starting_positions: Vec<StartingPosition>,
    /// Parsed control squares with per-square flags. Empty when
    /// `squares_condition` is off or no squares are configured.
    pub control_squares: Vec<ControlSquare>,
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
    /// Pre-parsed range-bonus map: (x, y) -> bonus value. Avoids repeated
    /// JSON parsing in `moves_for` which is called thousands of times per search.
    pub range_square_bonuses: HashMap<(i32, i32), i32>,
    /// Squares where `impassable == true` in `special_squares_string`.
    /// Pieces cannot move to or slide through these squares (unless ghostwalk).
    pub impassable_squares: HashSet<(i32, i32)>,
    /// Squares where `asRestrictionZone == true` in `special_squares_string`.
    /// A piece with `cannot_move_outside_zone` that is currently on one of
    /// these may only move to other restriction-zone squares.
    pub restriction_zone_squares: HashSet<(i32, i32)>,
    /// Squares where BOTH `asRestrictionZone` and `allowRangedOutsideZone` are
    /// true in `special_squares_string`.  When a zone-restricted piece stands
    /// on one of these squares it may still fire ranged attacks to squares
    /// outside the restriction zone (though it cannot physically move there).
    pub allow_ranged_outside_zone_squares: HashSet<(i32, i32)>,
    /// Squares where `disableFirstMoveHere == true`. First-N-move abilities
    /// are blocked when the piece stands on any of these squares.
    pub disable_first_move_here_squares: HashSet<(i32, i32)>,
    /// Squares where `restrictFirstMoveToCustom == true`. When this set is
    /// non-empty, first-N-move abilities are only usable from these squares.
    pub restrict_first_move_to_custom_squares: HashSet<(i32, i32)>,
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
        let range_square_bonuses = parse_range_bonuses(&doc.game);
        let impassable_squares = parse_flagged_set(&doc.game, "impassable");
        let restriction_zone_squares = parse_flagged_set(&doc.game, "asRestrictionZone");
        let allow_ranged_outside_zone_squares =
            parse_dual_flagged_set(&doc.game, "asRestrictionZone", "allowRangedOutsideZone");
        let disable_first_move_here_squares = parse_flagged_set(&doc.game, "disableFirstMoveHere");
        let restrict_first_move_to_custom_squares =
            parse_flagged_set(&doc.game, "restrictFirstMoveToCustom");
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
            range_square_bonuses,
            impassable_squares,
            restriction_zone_squares,
            allow_ranged_outside_zone_squares,
            disable_first_move_here_squares,
            restrict_first_move_to_custom_squares,
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
