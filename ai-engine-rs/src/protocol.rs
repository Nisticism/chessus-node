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

/// Serde-default helper for i32 fields whose semantic default is 1.
fn default_one_i32() -> i32 {
    1
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
    /// Minimum trainer binary version required for this rules file.
    /// If set and the running binary's version is older, training is aborted
    /// with a clear message directing the user to re-download the trainer pack.
    pub trainer_min_version: String,

    // Win conditions
    pub mate_condition: bool,
    /// When true, a player is only in check when ALL their checkmate-flagged
    /// pieces are simultaneously under lethal attack. Mirrors
    /// `mate_condition_requires_all` in server/game-socket.js.
    pub mate_condition_requires_all: bool,
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

    /// Fog-of-war: enemy pieces are hidden from each player during live
    /// play. The trainer/bot still sees the full board (it "cheats"), so
    /// this flag is informational for the engine. Mirrors
    /// `hide_enemy_pieces` in server/game-socket.js.
    pub hide_enemy_pieces: bool,
    /// If > 0, a player loses after attempting this many illegal moves
    /// in the live game. The trainer does not produce illegal moves
    /// during self-play, so this field is informational only and is
    /// stored to keep rules.json round-trippable. Mirrors
    /// `illegal_move_limit` in server/game-socket.js.
    pub illegal_move_limit: i32,

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

    // ---- Simultaneous turns ----
    /// When true the game runs in simul-turns mode: both players choose
    /// their move secretly each round and the moves resolve together.
    pub simultaneous_turns: bool,
    /// If both players capture an opposing game-ending piece in the same
    /// round, declare a draw rather than letting one side "win first".
    /// Defaults to true (mirrors live-game default).
    #[serde(default = "_default_true")]
    pub simul_turns_simultaneous_capture_draw: bool,
    /// If both players are checkmated by the same round's resolution,
    /// declare a draw. Defaults to true (mirrors live-game default).
    #[serde(default = "_default_true")]
    pub simul_turns_simultaneous_checkmate_draw: bool,
    /// After this many same-square cancellations in a row the game ends
    /// in a draw. 0 disables.
    pub simul_turns_draw_after_cancellations: i32,
    /// 'cancel' (default) cancels both moves on a place-vs-move conflict;
    /// 'allow' lets the place override the move. The trainer never
    /// generates place actions today so this rarely matters.
    pub simul_turns_place_conflict: Option<String>,
    /// Post-promotion free-move policy in simul mode: 'disable' (default) /
    /// 'allow' / 'restage'. Stored here to avoid silent data loss; simul.rs
    /// does not yet model promotions so this is unused until that lands.
    pub simul_turns_free_move_after_capture: Option<String>,

    // ---- Veto power ----
    /// When true, players may spend vetoes to ban specific opponent moves.
    /// Not consumed by the trainer yet (Rust self-play veto is deferred);
    /// stored to avoid silent data loss.
    pub veto_enabled: bool,
    /// 'preemptive' (default) or 'reactive'.
    pub veto_style: Option<String>,
    /// Max vetoes a player may spend per opponent turn (1-5).
    #[serde(default = "default_one_i32")]
    pub veto_per_turn_limit: i32,
    /// Max vetoes per game (None = unlimited, bounded by per-turn limit).
    pub veto_per_game_limit: Option<i32>,
    /// If true, placement cannot be vetoed.
    pub veto_disallow_placement: bool,
    /// If true, the promotion-triggering move cannot be vetoed.
    pub veto_disallow_promotion: bool,

    // Special-square JSON blobs (parsed lazily in rules.rs)
    pub range_squares_string: Option<String>,
    pub promotion_squares_string: Option<String>,
    pub special_squares_string: Option<String>,
    pub control_squares_string: Option<String>,

    // Points win condition
    pub points_to_win: Option<i32>,
    pub starting_points_p1: i32,
    pub starting_points_p2: i32,
    pub draw_equal_points_at_turn: Option<i32>,
    pub draw_equal_points_consecutive: Option<i32>,
    /// Game-wide HP regen applied per turn to every piece whose per-piece
    /// `hp_regen` is 0. Mirrors `other_game_data.global_hp_regen` parsed
    /// in server/game-socket.js.
    pub global_hp_regen: i32,
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
    /// When both hop flags are on and repeating_ratio is used, stop at a
    /// further multiple if any earlier multiple is occupied. Default true.
    #[serde(default = "default_true")]
    pub hop_stop_at_occupied: bool,
    pub directional_hop_disabled: bool,
    /// When true, hopping (can_hop_over_allies/enemies) only applies to
    /// directional (sliding) moves — not to ratio (knight-like) jumps.
    /// Mirrors `directional_hop_only` in pieces table.
    #[serde(default)]
    pub directional_hop_only: bool,
    /// When true, ratio/exact moves are only valid if the piece actually hops
    /// over at least one piece along the path. "Must hop" restriction.
    /// Mirrors `exact_ratio_hop_only` in pieces table.
    #[serde(default)]
    pub exact_ratio_hop_only: bool,

    // ---- Attack-specific hopping (capture moves) ----
    /// Whether this piece can hop over allied pieces when making a capture move.
    /// Mirrors `can_hop_attack_over_allies` in pieces table.
    #[serde(default)]
    pub can_hop_attack_over_allies: bool,
    /// Whether this piece can hop over enemy pieces when making a capture move.
    /// Mirrors `can_hop_attack_over_enemies` in pieces table.
    #[serde(default)]
    pub can_hop_attack_over_enemies: bool,
    /// Disables directional hopping on capture (attack) moves even when attack
    /// hop flags are set. Mirrors `directional_hop_disabled_attack`.
    #[serde(default)]
    pub directional_hop_disabled_attack: bool,
    /// Like `directional_hop_only` but for captures: attack hopping only applies
    /// to directional capture moves, not ratio captures.
    /// Mirrors `directional_hop_only_attack` in pieces table.
    #[serde(default)]
    pub directional_hop_only_attack: bool,
    /// Like `exact_ratio_hop_only` but for captures: ratio captures are only
    /// valid when the piece hops over at least one piece.
    /// Mirrors `exact_ratio_hop_only_attack` in pieces table.
    #[serde(default)]
    pub exact_ratio_hop_only_attack: bool,
    /// Like `hop_stop_at_occupied` but for repeating ratio captures: stop at a
    /// further multiple if any earlier multiple is occupied.
    /// Default true (mirrors `hop_stop_at_occupied_attack` in pieces table).
    #[serde(default = "default_true")]
    pub hop_stop_at_occupied_attack: bool,
    /// During checkers-style chain captures, the piece may hop over allied pieces
    /// to continue the chain. Mirrors `chain_hop_allies` in pieces table.
    #[serde(default)]
    pub chain_hop_allies: bool,

    pub ghostwalk: bool,

    // ---- Capture / movement gating ----
    pub can_capture_enemy_on_move: bool,
    pub can_capture_allies: bool,
    pub first_move_only: bool,
    pub first_move_only_capture: bool,
    /// Piece cannot move until this many half-moves have been played in the game.
    /// 0 means no restriction.
    #[serde(default)]
    pub min_turns_per_move: i32,

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
    /// If true, this specific placement of the piece cannot promote even though
    /// the piece template has `can_promote` set. Default false.
    #[serde(default)]
    pub disable_promotion: bool,
    /// Points the capturing player gains when this piece is captured.
    #[serde(default)]
    pub capture_points_gain: i32,
    /// Points deducted from the piece owner when this piece is captured.
    #[serde(default)]
    pub capture_points_loss: i32,
    pub cannot_be_captured: bool,
    /// If true, this piece may only move to squares marked as a Restriction Zone (asRestrictionZone custom square).
    #[serde(default)]
    pub cannot_move_outside_zone: bool,

    // ---- Custom per-piece move/attack square offsets (JSON arrays) ----
    pub special_scenario_moves: Option<String>,
    pub special_scenario_captures: Option<String>,
    pub custom_movement_squares: Option<String>,
    pub custom_attack_squares: Option<String>,

    /// En passant: set per-placement (from game_type_pieces.can_en_passant).
    /// When true the piece can capture en passant AND creates an en passant
    /// target when it makes a multi-square first-move advance.
    pub can_en_passant: bool,

    // ---- HP / AD combat system ----
    /// Maximum hit-point pool. Pieces with hit_points > 1 survive multiple
    /// attacks; they are only removed when current_hp reaches 0.
    #[serde(default = "default_one_i32")]
    pub hit_points: i32,
    /// Damage this piece deals per attack. Defaults to 1 (one-hit kill on 1-HP targets).
    #[serde(default = "default_one_i32")]
    pub attack_damage: i32,
    /// HP regenerated at the start of this piece's owner's turn. Capped at hit_points.
    #[serde(default)]
    pub hp_regen: i32,

    // ---- Kamikaze ----
    /// When true, the moving piece is also removed from the board after it kills an enemy.
    #[serde(default)]
    pub die_on_capture: bool,
    /// When true and die_on_capture fires on the opponent's last ends_game_on_capture piece,
    /// the attacker wins instead of drawing.
    #[serde(default)]
    pub die_on_capture_grants_win: bool,

    // ---- Burn / DOT ----
    /// Damage-over-time inflicted on enemies this piece hits (applied at the start of the
    /// victim's subsequent turns). 0 = no burn.
    #[serde(default)]
    pub burn_damage: i32,
    /// Number of turns the burn effect lasts on the target.
    #[serde(default)]
    pub burn_duration: i32,

    // ---- Trample / AoE ----
    /// Trample: damages every piece along the straight-line movement path.
    #[serde(default)]
    pub trample: bool,
    /// How many squares around each trample path step are also affected.
    #[serde(default)]
    pub trample_radius: i32,
    /// Area-of-effect radius at the landing square. All pieces within this
    /// distance take attack_damage (0 = no AoE).
    #[serde(default)]
    pub attack_radius: i32,

    // ---- Control squares ----
    /// Whether this piece can claim control squares when a control square has
    /// `requireSpecificPiece` set. Without that flag any piece counts.
    #[serde(default)]
    pub can_control_squares: bool,

    // ---- Promotion limits ----
    /// If true, this piece cannot promote into a piece with `ends_game_on_checkmate`
    /// if the owner already has at least as many of that type as they started with.
    #[serde(default)]
    pub limit_promote_checkmate_to_original: bool,
    /// Same as above but for `ends_game_on_capture` promotion targets.
    #[serde(default)]
    pub limit_promote_capture_to_original: bool,

    // ---- Capture actions per turn ----
    /// Number of bonus direct-move captures this piece may take per turn after its
    /// initial capture. 1 = default (no bonus). -1 = unlimited bonus captures.
    /// Hop-only (checkers-style) captures do NOT trigger bonus actions.
    /// Mirrors `capture_actions_per_turn` in the pieces DB table.
    #[serde(default = "default_one_i32")]
    pub capture_actions_per_turn: i32,
    /// Same as `capture_actions_per_turn` but for ranged attacks.
    #[serde(default = "default_one_i32")]
    pub ranged_capture_actions_per_turn: i32,

    // ---- Ranged attacks (piece stays in place, targets enemies at range) ----
    /// Master enable flag: piece can target enemies without moving to their square.
    #[serde(default)]
    pub can_capture_enemy_via_range: bool,
    /// Directional ranged attack ranges (0 = disabled for that direction).
    #[serde(default)]
    pub up_attack_range: i32,
    #[serde(default)]
    pub down_attack_range: i32,
    #[serde(default)]
    pub left_attack_range: i32,
    #[serde(default)]
    pub right_attack_range: i32,
    #[serde(default)]
    pub up_left_attack_range: i32,
    #[serde(default)]
    pub up_right_attack_range: i32,
    #[serde(default)]
    pub down_left_attack_range: i32,
    #[serde(default)]
    pub down_right_attack_range: i32,
    /// When true for a direction, only the exact range distance counts (not 1..N).
    #[serde(default)]
    pub up_attack_range_exact: bool,
    #[serde(default)]
    pub down_attack_range_exact: bool,
    #[serde(default)]
    pub left_attack_range_exact: bool,
    #[serde(default)]
    pub right_attack_range_exact: bool,
    #[serde(default)]
    pub up_left_attack_range_exact: bool,
    #[serde(default)]
    pub up_right_attack_range_exact: bool,
    #[serde(default)]
    pub down_left_attack_range_exact: bool,
    #[serde(default)]
    pub down_right_attack_range_exact: bool,
    /// L-shaped (knight-style) ranged attack ratio dimensions.
    #[serde(default)]
    pub ratio_one_attack_range: i32,
    #[serde(default)]
    pub ratio_two_attack_range: i32,
    /// Step-by-step ranged attack budget. Negative = orthogonal-only (Manhattan),
    /// positive = any direction (Chebyshev). 0 = disabled.
    #[serde(default)]
    pub step_by_step_attack_range: i32,
    /// When true, ranged shots can pass through allied pieces.
    #[serde(default)]
    pub can_fire_over_allies: bool,
    /// When true, ranged shots can pass through enemy pieces without stopping.
    #[serde(default)]
    pub can_fire_over_enemies: bool,
}

fn default_true() -> bool { true }

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
            hop_stop_at_occupied: true,
            directional_hop_disabled: false,
            directional_hop_only: false,
            exact_ratio_hop_only: false,
            can_hop_attack_over_allies: false,
            can_hop_attack_over_enemies: false,
            directional_hop_disabled_attack: false,
            directional_hop_only_attack: false,
            exact_ratio_hop_only_attack: false,
            hop_stop_at_occupied_attack: true,
            chain_hop_allies: false,
            ghostwalk: false,
            can_capture_enemy_on_move: true,
            can_capture_allies: false,
            first_move_only: false,
            first_move_only_capture: false,
            min_turns_per_move: 0,
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
            disable_promotion: false,
            capture_points_gain: 0,
            capture_points_loss: 0,
            cannot_be_captured: false,
            cannot_move_outside_zone: false,
            special_scenario_moves: None,
            special_scenario_captures: None,
            custom_movement_squares: None,
            custom_attack_squares: None,
            can_en_passant: false,
            hit_points: 1,
            attack_damage: 1,
            hp_regen: 0,
            die_on_capture: false,
            die_on_capture_grants_win: false,
            burn_damage: 0,
            burn_duration: 0,
            trample: false,
            trample_radius: 0,
            attack_radius: 0,
            can_control_squares: false,
            limit_promote_checkmate_to_original: false,
            limit_promote_capture_to_original: false,
            capture_actions_per_turn: 1,
            ranged_capture_actions_per_turn: 1,
            can_capture_enemy_via_range: false,
            up_attack_range: 0, down_attack_range: 0,
            left_attack_range: 0, right_attack_range: 0,
            up_left_attack_range: 0, up_right_attack_range: 0,
            down_left_attack_range: 0, down_right_attack_range: 0,
            up_attack_range_exact: false, down_attack_range_exact: false,
            left_attack_range_exact: false, right_attack_range_exact: false,
            up_left_attack_range_exact: false, up_right_attack_range_exact: false,
            down_left_attack_range_exact: false, down_right_attack_range_exact: false,
            ratio_one_attack_range: 0,
            ratio_two_attack_range: 0,
            step_by_step_attack_range: 0,
            can_fire_over_allies: false,
            can_fire_over_enemies: false,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StartingPosition {
    pub piece_id: i64,
    pub x: i32,
    pub y: i32,
    pub player_number: i32,
    #[serde(default)]
    pub is_neutral: bool,
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
    /// Simul-turns: both players captured an opposing game-ending piece
    /// in the same round.
    SimultaneousCaptureDraw,
    /// Simul-turns: both players were checkmated by the same round's
    /// resolution.
    SimultaneousCheckmateDraw,
    /// Simul-turns: same-square cancellation count reached the configured
    /// `simul_turns_draw_after_cancellations` threshold.
    CancellationDraw,
    /// `points_to_win`: a player accumulated enough points.
    PointsWin,
    /// Points draw: equal points at draw turn or consecutive equal turns.
    PointsDraw,
    /// A burn DoT effect killed a piece that triggered a win condition.
    BurnKill,
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
    #[allow(dead_code)]
    Warning { msg: &'a str },
    Finished { games_played: u32, elapsed_ms: u128 },
    Aborted { reason: &'a str },
}
