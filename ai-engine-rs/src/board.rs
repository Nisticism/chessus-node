//! Compact mutable board state for self-play.

use crate::rules::Rules;
use serde::{Deserialize, Serialize};

fn default_hp() -> i32 { 1 }

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
    /// Current hit points. Initialized from template.hit_points. Piece is
    /// removed when this reaches 0.
    #[serde(default = "default_hp")]
    pub current_hp: i32,
    /// Burn damage-over-time applied at the start of this piece's owner's turn.
    #[serde(default)]
    pub burn_active_damage: i32,
    /// Turns of burn remaining (decremented each turn the burn fires).
    #[serde(default)]
    pub burn_active_turns: i32,
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
    #[serde(default)]
    pub creates_en_passant: bool,

    // ---- Combat metadata (set by moves_for, consumed by apply) ----
    /// Damage to deal to the capture target. 0 = instant kill (no HP system).
    /// When hp_damage > 0 and target.current_hp > hp_damage, the target
    /// survives and the attacker does NOT advance (stays at `from`).
    #[serde(default)]
    pub hp_damage: i32,
    /// The moving piece dies after a successful kill (die_on_capture).
    #[serde(default)]
    pub attacker_dies: bool,
    /// This piece tramples: deal hp_damage to pieces along the straight-line path.
    #[serde(default)]
    pub has_trample: bool,
    /// Extra squares around each trample path step that are also damaged.
    #[serde(default)]
    pub trample_radius: i32,
    /// If > 0, deal hp_damage to all pieces within this many squares of the
    /// landing square (area-of-effect attack).
    #[serde(default)]
    pub area_radius: i32,
    /// Burn damage to apply on hit. Surviving targets get burn_active_damage set.
    #[serde(default)]
    pub burn_damage: i32,
    /// Turns the burn effect lasts on the target.
    #[serde(default)]
    pub burn_duration: i32,
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
    /// Per-player accumulated points (index 0 = player 1, index 1 = player 2).
    /// Initialized from rules.game.starting_points_p1/p2. Updated by captures
    /// based on capture_points_gain (capturer gains) and capture_points_loss
    /// (victim's owner loses, floored at 0).
    #[serde(default)]
    pub points: [i32; 2],
}

/// Returned by `Board::apply()` to communicate what happened.
#[derive(Debug, Default)]
pub struct ApplyResult {
    /// Board-instance IDs of all pieces removed this move (capture target if
    /// killed, attacker if die_on_capture, trample kills, AoE kills).
    pub killed: Vec<u32>,
}

impl ApplyResult {
    pub fn any_killed(&self) -> bool {
        !self.killed.is_empty()
    }
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
            points: [rules.game.starting_points_p1, rules.game.starting_points_p2],
        };
        for sp in &rules.starting_positions {
            let id = b.next_id;
            b.next_id += 1;
            let hp = rules.piece(sp.piece_id).map(|t| t.hit_points.max(1)).unwrap_or(1);
            b.pieces.push(PieceOnBoard {
                id,
                piece_id: sp.piece_id,
                player: sp.player_number,
                x: sp.x,
                y: sp.y,
                move_count: 0,
                current_hp: hp,
                burn_active_damage: 0,
                burn_active_turns: 0,
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

    /// Apply burn DoT and HP regeneration for pieces belonging to `player`
    /// at the start of that player's turn (call after `apply()` switches turn).
    /// Returns a list of piece instance IDs killed by burn.
    pub fn process_turn_start(&mut self, player: i32, rules: &Rules) -> Vec<u32> {
        let mut killed: Vec<u32> = Vec::new();

        // Burn: fire for every piece owned by `player` that has active burn.
        let ids: Vec<u32> = self.pieces.iter()
            .filter(|p| p.player == player && p.burn_active_turns > 0 && p.burn_active_damage > 0)
            .map(|p| p.id)
            .collect();
        for id in &ids {
            if let Some(p) = self.pieces.iter_mut().find(|p| p.id == *id) {
                p.current_hp = (p.current_hp - p.burn_active_damage).max(0);
                p.burn_active_turns -= 1;
                if p.current_hp <= 0 {
                    killed.push(p.id);
                }
            }
        }
        // Remove burn-killed pieces and update points.
        for id in &killed {
            if let Some(idx) = self.pieces.iter().position(|p| p.id == *id) {
                let dead = self.pieces.remove(idx);
                // Burn kills: no explicit attacker for points — skip gain/loss.
                // (The initial hit already ran capture_points at time of attack.)
                let _ = dead;
                self.plies_since_capture = 0;
            }
        }

        // HP regen: restore hp_regen HP to surviving pieces of `player`, capped at max.
        for p in self.pieces.iter_mut().filter(|p| p.player == player) {
            let regen = rules.piece(p.piece_id).map(|t| t.hp_regen).unwrap_or(0);
            if regen > 0 {
                let max_hp = rules.piece(p.piece_id).map(|t| t.hit_points.max(1)).unwrap_or(1);
                p.current_hp = (p.current_hp + regen).min(max_hp);
            }
        }

        killed
    }

    /// Apply a move to the board. Returns `ApplyResult` describing what was killed.
    ///
    /// HP system: when mv.hp_damage > 0 and the target survives (current_hp >
    /// hp_damage), the target is NOT removed and the attacker does NOT advance —
    /// it stays at `mv.from`. This mirrors the live-server behaviour where a
    /// non-lethal attack keeps the attacker in place.
    pub fn apply(&mut self, mv: &Move, rules: &Rules) -> ApplyResult {
        // En passant targets are only valid for exactly one half-turn.
        self.en_passant_target = None;

        let mut result = ApplyResult::default();
        let mut any_capture_happened = false;

        // Helper: award capture points for a killed piece.
        let award_points = |points: &mut [i32; 2], attacker_player: i32, dead_piece: &PieceOnBoard, rules: &Rules| {
            if let Some(t) = rules.piece(dead_piece.piece_id) {
                let gainer = (attacker_player - 1) as usize;
                let loser  = (dead_piece.player - 1) as usize;
                if gainer < 2 { points[gainer] = points[gainer].saturating_add(t.capture_points_gain); }
                if loser  < 2 { points[loser]  = points[loser].saturating_sub(t.capture_points_loss).max(0); }
            }
        };

        // Collect the attacker's player (needed after we possibly remove the attacker).
        let attacker_player = self.pieces.iter()
            .find(|p| p.id == mv.piece_id)
            .map(|p| p.player)
            .unwrap_or(1);

        // --- Main capture / HP hit ---
        let mut target_killed = false;
        if let Some(cap_id) = mv.capture {
            if let Some(idx) = self.pieces.iter().position(|p| p.id == cap_id) {
                let hp_damage = if mv.hp_damage > 0 { mv.hp_damage } else {
                    // Fallback: look up attacker's attack_damage from rules.
                    self.pieces.iter().find(|p| p.id == mv.piece_id)
                        .and_then(|a| rules.piece(a.piece_id))
                        .map(|t| t.attack_damage.max(1))
                        .unwrap_or(1)
                };
                let target_hp = self.pieces[idx].current_hp;
                if target_hp <= hp_damage {
                    // Target killed.
                    let dead = self.pieces.remove(idx);
                    award_points(&mut self.points, attacker_player, &dead, rules);
                    result.killed.push(dead.id);
                    target_killed = true;
                    any_capture_happened = true;
                } else {
                    // Target survives — deal damage, apply burn, attacker stays.
                    self.pieces[idx].current_hp -= hp_damage;
                    if mv.burn_damage > 0 && mv.burn_duration > 0 {
                        self.pieces[idx].burn_active_damage = mv.burn_damage;
                        self.pieces[idx].burn_active_turns = mv.burn_duration;
                    }
                    // Do not advance the attacker.
                    self.turn = if self.turn == 1 { 2 } else { 1 };
                    self.ply += 1;
                    self.plies_since_capture += 1;
                    return result;
                }
            }
        }

        // --- Move the attacker to mv.to (if no capture OR target was killed) ---
        if let Some(piece) = self.pieces.iter_mut().find(|p| p.id == mv.piece_id) {
            piece.x = mv.to.x;
            piece.y = mv.to.y;
            piece.move_count += 1;
            if mv.is_promotion {
                if let Some(new_pid) = mv.promote_to {
                    piece.piece_id = new_pid;
                    // Re-initialise HP from the promoted piece's template.
                    let new_hp = rules.piece(new_pid).map(|t| t.hit_points.max(1)).unwrap_or(1);
                    piece.current_hp = new_hp;
                }
            }
        }

        // --- Trample: damage pieces along the straight-line movement path ---
        if mv.has_trample {
            let dx = mv.to.x - mv.from.x;
            let dy = mv.to.y - mv.from.y;
            let is_straight = (dx == 0 && dy != 0)
                || (dy == 0 && dx != 0)
                || (dx.abs() == dy.abs() && dx != 0);
            if is_straight {
                let step_x = dx.signum();
                let step_y = dy.signum();
                let steps = dx.abs().max(dy.abs());
                let hp_damage = if mv.hp_damage > 0 { mv.hp_damage } else {
                    rules.piece(
                        self.pieces.iter().find(|p| p.id == mv.piece_id).map(|p| p.piece_id).unwrap_or(0)
                    ).map(|t| t.attack_damage.max(1)).unwrap_or(1)
                };
                // Collect squares: path intermediate + landing radius.
                let mut affected: Vec<(i32, i32)> = Vec::new();
                for s in 1..steps {
                    let px = mv.from.x + step_x * s;
                    let py = mv.from.y + step_y * s;
                    affected.push((px, py));
                    if mv.trample_radius > 0 {
                        for ry in -mv.trample_radius..=mv.trample_radius {
                            for rx in -mv.trample_radius..=mv.trample_radius {
                                if rx != 0 || ry != 0 {
                                    affected.push((px + rx, py + ry));
                                }
                            }
                        }
                    }
                }
                // Landing square radius.
                if mv.trample_radius > 0 {
                    for ry in -mv.trample_radius..=mv.trample_radius {
                        for rx in -mv.trample_radius..=mv.trample_radius {
                            if rx != 0 || ry != 0 {
                                affected.push((mv.to.x + rx, mv.to.y + ry));
                            }
                        }
                    }
                }
                affected.dedup();
                // Damage pieces on affected squares (skip already-killed and the mover).
                let already_killed: std::collections::HashSet<u32> = result.killed.iter().copied().collect();
                let mut trample_kills: Vec<u32> = Vec::new();
                for (ax, ay) in affected {
                    let victim_ids: Vec<u32> = self.pieces.iter()
                        .filter(|p| p.x == ax && p.y == ay
                            && p.id != mv.piece_id
                            && !already_killed.contains(&p.id))
                        .map(|p| p.id)
                        .collect();
                    for vid in victim_ids {
                        if let Some(idx) = self.pieces.iter().position(|p| p.id == vid) {
                            let victim_hp = self.pieces[idx].current_hp;
                            if victim_hp <= hp_damage {
                                let dead = self.pieces.remove(idx);
                                award_points(&mut self.points, attacker_player, &dead, rules);
                                trample_kills.push(dead.id);
                            } else {
                                self.pieces[idx].current_hp -= hp_damage;
                                if mv.burn_damage > 0 && mv.burn_duration > 0 {
                                    self.pieces[idx].burn_active_damage = mv.burn_damage;
                                    self.pieces[idx].burn_active_turns = mv.burn_duration;
                                }
                            }
                        }
                    }
                }
                if !trample_kills.is_empty() {
                    any_capture_happened = true;
                }
                result.killed.extend(trample_kills);
            }
        }

        // --- Area-of-effect attack at landing square ---
        if mv.area_radius > 0 {
            let hp_damage = if mv.hp_damage > 0 { mv.hp_damage } else {
                rules.piece(
                    self.pieces.iter().find(|p| p.id == mv.piece_id).map(|p| p.piece_id).unwrap_or(0)
                ).map(|t| t.attack_damage.max(1)).unwrap_or(1)
            };
            let already_killed: std::collections::HashSet<u32> = result.killed.iter().copied().collect();
            let mut aoe_kills: Vec<u32> = Vec::new();
            let victim_ids: Vec<u32> = self.pieces.iter()
                .filter(|p| {
                    p.id != mv.piece_id
                    && !already_killed.contains(&p.id)
                    && (p.x - mv.to.x).abs() <= mv.area_radius
                    && (p.y - mv.to.y).abs() <= mv.area_radius
                })
                .map(|p| p.id)
                .collect();
            for vid in victim_ids {
                if let Some(idx) = self.pieces.iter().position(|p| p.id == vid) {
                    let victim_hp = self.pieces[idx].current_hp;
                    if victim_hp <= hp_damage {
                        let dead = self.pieces.remove(idx);
                        award_points(&mut self.points, attacker_player, &dead, rules);
                        aoe_kills.push(dead.id);
                    } else {
                        self.pieces[idx].current_hp -= hp_damage;
                        if mv.burn_damage > 0 && mv.burn_duration > 0 {
                            self.pieces[idx].burn_active_damage = mv.burn_damage;
                            self.pieces[idx].burn_active_turns = mv.burn_duration;
                        }
                    }
                }
            }
            if !aoe_kills.is_empty() {
                any_capture_happened = true;
            }
            result.killed.extend(aoe_kills);
        }

        // --- die_on_capture: remove attacker if it killed something ---
        if mv.attacker_dies && target_killed {
            if let Some(idx) = self.pieces.iter().position(|p| p.id == mv.piece_id) {
                let dead = self.pieces.remove(idx);
                result.killed.push(dead.id);
                any_capture_happened = true;
            }
        }

        // --- En passant target ---
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

        // --- Castling partner ---
        if mv.is_castling {
            if let Some(partner_id) = mv.partner {
                if let (Some(king), Some(rook_idx)) = (
                    self.pieces.iter().find(|p| p.id == mv.piece_id).cloned(),
                    self.pieces.iter().position(|p| p.id == partner_id),
                ) {
                    let dir = (mv.to.x - mv.from.x).signum();
                    if dir != 0 {
                        let rook = &mut self.pieces[rook_idx];
                        rook.x = king.x - dir;
                        rook.move_count += 1;
                    }
                }
            }
        }

        // --- plies_since_capture counter ---
        if any_capture_happened || mv.capture.is_some() {
            self.plies_since_capture = 0;
        } else {
            self.plies_since_capture += 1;
        }

        self.turn = if self.turn == 1 { 2 } else { 1 };
        self.ply += 1;
        result
    }
}
