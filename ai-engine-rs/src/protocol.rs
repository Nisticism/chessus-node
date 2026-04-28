//! Wire-format types shared with the Node side.
//!
//! All shapes here mirror what `server/ai/export-game-rules.js` writes and
//! what the future `server/ai/adaptive-bridge.js` will send/receive. Field
//! names match the database column names exactly so the dump is a
//! minimally-transformed view of the DB.

use serde::{Deserialize, Serialize};

/// Serde-default helper used for fields whose semantic default is `true`
/// (i.e. the rule applies unless explicitly disabled).
fn _default_true() -> bool {
    true
}

/// Top-level rules.json document.
#[derive(Debug, Deserialize, Serialize)]
pub struct RulesDoc {
    pub game: GameType,
    pub pieces: Vec<PieceTemplate>,
    /// One row per `game_type_pieces` entry.
    pub starting_positions: Vec<StartingPosition>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct GameType {
    pub id: i64,
    pub game_name: String,
    pub board_width: i32,
    pub board_height: i32,
    pub player_count: i32,
    pub actions_per_turn: i32,

    // Win conditions
    pub mate_condition: bool,
    pub mate_piece: Option<i64>,
    pub capture_condition: bool,
    pub capture_piece: Option<i64>,
    pub value_condition: bool,
    pub value_piece: Option<i64>,
    pub value_max: Option<i32>,
    pub squares_condition: bool,
    pub squares_count: Option<i32>,
    pub hill_condition: bool,
    pub hill_x: Option<i32>,
    pub hill_y: Option<i32>,
    pub hill_turns: Option<i32>,
    pub draw_move_limit: Option<i32>,
    pub repetition_draw_count: Option<i32>,

    // Additional win/loss/draw conditions (newer DB columns)
    pub lose_all_pieces_condition: bool,
    pub stalemate_win_condition: bool,
    pub no_moves_condition: bool,

    /// When true, the side to move MUST play a capturing move if any
    /// capture is available (any piece, any victim). Mirrors the
    /// `forced_capture_condition` flag enforced in the live game server.
    /// Defaults to false (no forced-capture rule).
    pub forced_capture_condition: bool,

    /// When true, reaching a promotion square (with a `can_promote`
    /// piece) instantly wins the game for the moving side. Mirrors
    /// `promotion_condition` in server/game-socket.js.
    pub promotion_condition: bool,

    /// When true, ALL pieces on a side that have `ends_game_on_capture`
    /// must be captured before the capture_condition fires; if false
    /// (default) any one such piece's loss decides the game. Mirrors
    /// `capture_condition_requires_all` in server/game-socket.js.
    pub capture_condition_requires_all: bool,

    /// When true (default), a side with no legal moves and not in check
    /// ends the game in a draw. When false the trainer treats stalemate
    /// as non-decisive and switches the turn instead — mirrors the
    /// stalemateNotice / skip-turn behavior in server/game-socket.js.
    /// Defaults to true so older rules.json files (written before this
    /// flag existed) still behave like classic chess.
    #[serde(default = "_default_true")]
    pub stalemate_draw_condition: bool,

    // Special-square JSON blobs (parsed lazily in rules.rs)
    pub range_squares_string: Option<String>,
    pub promotion_squares_string: Option<String>,
    pub special_squares_string: Option<String>,
    pub control_squares_string: Option<String>,
}

/// Piece template (one row of the `pieces` table).
///
/// Field names match the DB columns; missing/null DB values become
/// type-defaults (0 / false / None) thanks to `#[serde(default)]`.
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct PieceTemplate {
    pub id: i64,
    pub piece_name: String,
    pub piece_value: i32,

    /// The original DB pieces.id this template was synthesized from.
    /// Used by the opening-book recorder so book entries are keyed by the
    /// real piece type (visible to users) rather than the per-placement
    /// virtual variant id (≥ 1_000_000).
    #[serde(default)]
    pub real_piece_id: i64,

    // Multi-tile pieces
    pub piece_width: i32,
    pub piece_height: i32,

    // ---- Directional movement (per cardinal/diagonal direction) ----
    pub directional_movement_style: bool,
    pub repeating_movement: bool,
    pub max_directional_movement_iterations: i32,

    pub up_movement: i32,
    pub down_movement: i32,
    pub left_movement: i32,
    pub right_movement: i32,
    pub up_left_movement: i32,
    pub up_right_movement: i32,
    pub down_left_movement: i32,
    pub down_right_movement: i32,

    pub up_movement_exact: bool,
    pub down_movement_exact: bool,
    pub left_movement_exact: bool,
    pub right_movement_exact: bool,
    pub up_left_movement_exact: bool,
    pub up_right_movement_exact: bool,
    pub down_left_movement_exact: bool,
    pub down_right_movement_exact: bool,

    /// First-N-moves availability per direction (0 = no restriction).
    pub up_movement_available_for: i32,
    pub down_movement_available_for: i32,
    pub left_movement_available_for: i32,
    pub right_movement_available_for: i32,
    pub up_left_movement_available_for: i32,
    pub up_right_movement_available_for: i32,
    pub down_left_movement_available_for: i32,
    pub down_right_movement_available_for: i32,

    // ---- Directional capture ----
    pub up_capture: i32,
    pub down_capture: i32,
    pub left_capture: i32,
    pub right_capture: i32,
    pub up_left_capture: i32,
    pub up_right_capture: i32,
    pub down_left_capture: i32,
    pub down_right_capture: i32,

    pub up_capture_exact: bool,
    pub down_capture_exact: bool,
    pub left_capture_exact: bool,
    pub right_capture_exact: bool,
    pub up_left_capture_exact: bool,
    pub up_right_capture_exact: bool,
    pub down_left_capture_exact: bool,
    pub down_right_capture_exact: bool,

    pub repeating_capture: bool,

    // ---- Ratio movement (knight-like) ----
    pub ratio_movement_style: bool,
    pub ratio_movement_1: i32,
    pub ratio_movement_2: i32,
    pub repeating_ratio: bool,
    /// -1 means "no cap" (uses board size).
    pub max_ratio_iterations: i32,

    // ---- Step-by-step movement (king-style N-square movement) ----
    /// Maximum number of squares the piece can move per turn from its
    /// origin, traversing one square at a time. Negative value disables
    /// diagonals (Manhattan distance). Zero/None means no step-by-step
    /// movement. Mirrors `step_by_step_movement_value` in pieces table.
    pub step_by_step_movement_value: i32,
    /// Step-by-step CAPTURE range. Same encoding as movement value.
    /// Zero means "reuse step_by_step_movement_value if the piece can
    /// capture on move".
    pub step_by_step_capture: i32,

    // ---- Hopping & blocking ----
    pub can_hop_over_allies: bool,
    pub can_hop_over_enemies: bool,
    pub directional_hop_disabled: bool,
    pub ghostwalk: bool,

    // ---- Capture / movement gating ----
    pub can_capture_enemy_on_move: bool,
    pub can_capture_allies: bool,
    pub first_move_only: bool,
    pub first_move_only_capture: bool,

    // ---- Castling ----
    pub can_castle: bool,
    pub castling_distance: i32,

    // ---- Promotion / royal flags ----
    pub can_promote: bool,
    /// Virtual piece template IDs this piece can promote to (mapped from
    /// `promotion_pieces_ids` DB column by export-game-rules.js).
    /// Empty means no specific promotion targets configured.
    #[serde(default)]
    pub promotion_pieces_ids: Vec<i64>,
    pub is_royal: bool,
    pub has_check_rule: bool,
    pub has_checkmate_rule: bool,
    pub has_lose_on_capture_rule: bool,
    pub ends_game_on_capture: bool,
    pub ends_game_on_checkmate: bool,
    /// Whether this piece may promote into a piece with `ends_game_on_checkmate`.
    /// Controlled per-placement in the game wizard. Default false.
    #[serde(default)]
    pub can_promote_to_checkmate: bool,
    /// Whether this piece may promote into a piece with `ends_game_on_capture`.
    /// Controlled per-placement in the game wizard. Default false.
    #[serde(default)]
    pub can_promote_to_capture: bool,
    pub cannot_be_captured: bool,

    // ---- Custom per-piece move/attack square offsets (JSON arrays) ----
    pub special_scenario_moves: Option<String>,
    pub special_scenario_captures: Option<String>,
    pub custom_movement_squares: Option<String>,
    pub custom_attack_squares: Option<String>,

    /// En passant: set per-placement (from game_type_pieces.can_en_passant).
    /// When true the piece can capture en passant AND creates an en passant
    /// target when it makes a multi-square first-move advance.
    pub can_en_passant: bool,
}

impl Default for PieceTemplate {
    fn default() -> Self {
        Self {
            id: 0,
            piece_name: String::new(),
            piece_value: 1,
            real_piece_id: 0,
            piece_width: 1,
            piece_height: 1,
            directional_movement_style: false,
            repeating_movement: false,
            max_directional_movement_iterations: 0,
            up_movement: 0, down_movement: 0,
            left_movement: 0, right_movement: 0,
            up_left_movement: 0, up_right_movement: 0,
            down_left_movement: 0, down_right_movement: 0,
            up_movement_exact: false, down_movement_exact: false,
            left_movement_exact: false, right_movement_exact: false,
            up_left_movement_exact: false, up_right_movement_exact: false,
            down_left_movement_exact: false, down_right_movement_exact: false,
            up_movement_available_for: 0, down_movement_available_for: 0,
            left_movement_available_for: 0, right_movement_available_for: 0,
            up_left_movement_available_for: 0, up_right_movement_available_for: 0,
            down_left_movement_available_for: 0, down_right_movement_available_for: 0,
            up_capture: 0, down_capture: 0,
            left_capture: 0, right_capture: 0,
            up_left_capture: 0, up_right_capture: 0,
            down_left_capture: 0, down_right_capture: 0,
            up_capture_exact: false, down_capture_exact: false,
            left_capture_exact: false, right_capture_exact: false,
            up_left_capture_exact: false, up_right_capture_exact: false,
            down_left_capture_exact: false, down_right_capture_exact: false,
            repeating_capture: false,
            ratio_movement_style: false,
            ratio_movement_1: 0,
            ratio_movement_2: 0,
            repeating_ratio: false,
            max_ratio_iterations: 1,
            step_by_step_movement_value: 0,
            step_by_step_capture: 0,
            can_hop_over_allies: false,
            can_hop_over_enemies: false,
            directional_hop_disabled: false,
            ghostwalk: false,
            can_capture_enemy_on_move: true,
            can_capture_allies: false,
            first_move_only: false,
            first_move_only_capture: false,
            can_castle: false,
            castling_distance: 2,
            can_promote: false,
            promotion_pieces_ids: vec![],
            is_royal: false,
            has_check_rule: false,
            has_checkmate_rule: false,
            has_lose_on_capture_rule: false,
            ends_game_on_capture: false,
            ends_game_on_checkmate: false,
            can_promote_to_checkmate: false,
            can_promote_to_capture: false,
            cannot_be_captured: false,
            special_scenario_moves: None,
            special_scenario_captures: None,
            custom_movement_squares: None,
            custom_attack_squares: None,
            can_en_passant: false,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StartingPosition {
    pub piece_id: i64,
    pub x: i32,
    pub y: i32,
    pub player_number: i32,
}

/// Why a self-play game ended. Helps the admin UI distinguish between the
/// several "draw" categories (which all collapse to `winner: null`) and the
/// genuine decisive results.
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    /// Side to move had no legal moves and was in check.
    Checkmate,
    /// Side to move had no legal moves but was not in check.
    Stalemate,
    /// Side to move had no legal moves and `stalemate_win_condition` is set — they win.
    StalemateWin,
    /// Side to move had no legal moves and `no_moves_condition` is set — they lose.
    NoMovesLoss,
    /// `capture_condition`: one side had all capturable pieces eliminated.
    CaptureCondition,
    /// `lose_all_pieces_condition`: one side lost all their pieces (anti-chess win).
    LoseAllPieces,
    /// `squares_condition`: a player held enough control squares for the required number of turns.
    SquaresCondition,
    /// `rules.game.draw_move_limit` (fifty-move-rule analog) reached.
    MoveLimit,
    /// Trainer's hard 400-ply cap was hit; finished via random rollout.
    MoveCapRollout,
    /// Random rollout itself ran to its internal cap without a verdict.
    RolloutCap,
    /// MCTS produced no move (defensive; should be unreachable).
    NoMove,
    /// A royal piece was captured during a rollout (treated as a decisive win).
    RoyalCapture,
    /// Position repeated `repetition_draw_count` times.
    Repetition,
    /// Only royal pieces remain on the board (one each) — no mate possible.
    InsufficientMaterial,
    /// `promotion_condition`: a piece reached a promotion square (and
    /// has `can_promote`), instantly winning the game for its owner.
    Promotion,
}

/// One progress event written to `log.ndjson` (one per line).
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProgressEvent<'a> {
    Started { games_target: u32, seed: u64 },
    GameComplete {
        index: u32,
        moves: u32,
        winner: Option<i32>,
        end_reason: EndReason,
        elapsed_ms: u128,
    },
    Checkpoint { path: &'a str, games_played: u32 },
    Warning { msg: &'a str },
    Finished { games_played: u32, elapsed_ms: u128 },
    Aborted { reason: &'a str },
}
