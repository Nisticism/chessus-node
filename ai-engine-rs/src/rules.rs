//! Loads a rules.json dump produced by `server/ai/export-game-rules.js`
//! and exposes look-ups used by the move generator.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

pub use crate::protocol::{GameType, PieceTemplate, RulesDoc, StartingPosition};

/// All rule data for one game variant, indexed for fast access.
pub struct Rules {
    pub game: GameType,
    pub pieces: HashMap<i64, PieceTemplate>,
    pub starting_positions: Vec<StartingPosition>,
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
        let pieces: HashMap<i64, PieceTemplate> =
            doc.pieces.into_iter().map(|p| (p.id, p)).collect();
        Self {
            game: doc.game,
            pieces,
            starting_positions: doc.starting_positions,
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
