//! Opening-book recording and aggregation.
//!
//! During self-play we append per-move records to `book.jsonl` for the
//! first BOOK_PLY_LIMIT plies of each game. After the game finishes the
//! mover's outcome (W/L/D) is folded back into each record.
//!
//! On checkpoint the trainer aggregates `book.jsonl` into `book.json`:
//!   {
//!     "format": "squarestrat-book-v1",
//!     "ply_limit": 20,
//!     "positions": {
//!       "<sig>": {
//!         "moves": [
//!           {"mv": "...", "w": 12, "l": 4, "d": 2}
//!         ],
//!         "total": 18
//!       }
//!     }
//!   }
//!
//! Position signatures and move strings use REAL piece IDs (the
//! user-visible pieces.id, not the virtual ≥1_000_000 ids), so the JS
//! bot can compute the same keys directly from its live game state.

use anyhow::Result;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use crate::board::{Board, Move};
use crate::rules::Rules;

pub const BOOK_PLY_LIMIT: u32 = 20;

/// One record we tentatively buffer during a game; written after the
/// game completes (so we know the winner).
pub struct PendingBookRecord {
    pub ply: u32,
    pub sig: String,
    pub mv_str: String,
    pub mover: i32,
}

/// Compute a stable signature for the current position.
/// Format: `W;H;turn|<P>:<real_pid>:<x>,<y>;...` sorted ascending.
pub fn position_signature(board: &Board, rules: &Rules) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(board.pieces.len());
    for p in &board.pieces {
        let real_pid = rules
            .piece(p.piece_id)
            .map(|t| if t.real_piece_id != 0 { t.real_piece_id } else { t.id })
            .unwrap_or(p.piece_id);
        parts.push(format!("{}:{}:{},{}", p.player, real_pid, p.x, p.y));
    }
    parts.sort();
    format!("{}x{}|t{}|{}", board.width, board.height, board.turn, parts.join(";"))
}

/// Serialize a move into a stable string keyed off real piece ids.
/// Format: `<from_x>,<from_y>-><to_x>,<to_y>[=<promo_real_pid>][C]`.
/// Castling adds a trailing `C`; promotions include the promote-to real id.
pub fn move_string(mv: &Move, rules: &Rules) -> String {
    let mut s = format!("{},{}->{},{}", mv.from.x, mv.from.y, mv.to.x, mv.to.y);
    if mv.is_promotion {
        if let Some(virt) = mv.promote_to {
            let real = rules
                .piece(virt)
                .map(|t| if t.real_piece_id != 0 { t.real_piece_id } else { t.id })
                .unwrap_or(virt);
            s.push_str(&format!("={}", real));
        }
    }
    if mv.is_castling {
        s.push('C');
    }
    s
}

/// Append the buffered per-game records to `book.jsonl`, attaching the
/// final per-record result code: "W" (mover won), "L" (mover lost),
/// "D" (draw). Skipped entirely if the buffer is empty.
pub fn write_pending(
    out_dir: &Path,
    pending: &[PendingBookRecord],
    winner: Option<i32>,
) -> Result<()> {
    if pending.is_empty() {
        return Ok(());
    }
    let book_path = out_dir.join("book.jsonl");
    let f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&book_path)?;
    let mut bw = BufWriter::new(f);
    for rec in pending {
        let result = match winner {
            Some(w) if w == rec.mover => "W",
            Some(_) => "L",
            None => "D",
        };
        // Write as JSON with simple escaping. sig/mv_str contain only
        // ascii digits, comma, semicolon, colon, '|', '=' so no escapes
        // are needed in practice — still go through serde to be safe.
        let line = serde_json::json!({
            "p": rec.ply,
            "s": rec.sig,
            "m": rec.mv_str,
            "r": result,
        });
        writeln!(bw, "{}", line)?;
    }
    bw.flush().ok();
    Ok(())
}

/// Aggregated stats for one move from a position.
#[derive(Debug, Default, Serialize, Clone)]
pub struct MoveStats {
    pub mv: String,
    pub w: u32,
    pub l: u32,
    pub d: u32,
}

#[derive(Debug, Default, Serialize)]
pub struct PositionStats {
    pub moves: Vec<MoveStats>,
    pub total: u32,
}

#[derive(Debug, Serialize)]
pub struct BookDoc {
    pub format: &'static str,
    pub ply_limit: u32,
    pub positions: BTreeMap<String, PositionStats>,
}

/// Read book.jsonl in `out_dir` and emit `book.json` summarising it.
/// Cheap enough to run on every checkpoint (book.jsonl stays small —
/// at most BOOK_PLY_LIMIT plies × games_played).
pub fn aggregate_book(out_dir: &Path) -> Result<()> {
    let book_path = out_dir.join("book.jsonl");
    if !book_path.exists() {
        return Ok(());
    }
    let f = File::open(&book_path)?;
    let mut by_pos: BTreeMap<String, BTreeMap<String, MoveStats>> = BTreeMap::new();
    for line in BufReader::new(f).lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        let rec: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let sig = rec.get("s").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mv = rec.get("m").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let r = rec.get("r").and_then(|v| v.as_str()).unwrap_or("D");
        if sig.is_empty() || mv.is_empty() {
            continue;
        }
        let pos_entry = by_pos.entry(sig).or_default();
        let stats = pos_entry.entry(mv.clone()).or_insert_with(|| MoveStats {
            mv,
            ..Default::default()
        });
        match r {
            "W" => stats.w += 1,
            "L" => stats.l += 1,
            _ => stats.d += 1,
        }
    }

    let positions: BTreeMap<String, PositionStats> = by_pos
        .into_iter()
        .map(|(sig, moves_map)| {
            let moves: Vec<MoveStats> = moves_map.into_values().collect();
            let total = moves.iter().map(|m| m.w + m.l + m.d).sum();
            (sig, PositionStats { moves, total })
        })
        .collect();

    let doc = BookDoc {
        format: "squarestrat-book-v1",
        ply_limit: BOOK_PLY_LIMIT,
        positions,
    };
    let out_path = out_dir.join("book.json");
    let bytes = serde_json::to_vec(&doc)?;
    fs::write(&out_path, bytes)?;
    Ok(())
}
