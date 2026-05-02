//! Self-play training loop and inference (`play`) subcommand.
//!
//! The "model" written today is a tiny placeholder: it stores cumulative
//! visit counts for (board hash → best move). It exists so the training
//! pipeline produces a real artifact end-to-end and so phase 2 has
//! something to swap out without changing the surrounding code.

use anyhow::{Context, Result};
use clap::Args;
use rand::SeedableRng;
use rand_xoshiro::Xoshiro256PlusPlus;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

use crate::board::Board;
use crate::book::{aggregate_book, move_string, position_signature, write_pending, PendingBookRecord, BOOK_PLY_LIMIT};
use crate::mcts::{check_squares_winner, update_control_tracking, GameResult, Mcts};
use crate::moves::{in_check, is_royal_piece, legal_moves};
use crate::protocol::ProgressEvent;
use crate::rules::Rules;

#[derive(Args, Debug)]
pub struct TrainArgs {
    /// Path to the rules.json dump produced by Node.
    #[arg(long)]
    pub rules: PathBuf,
    /// Output directory for checkpoints and log.ndjson.
    #[arg(long)]
    pub out: PathBuf,
    /// How many self-play games to run.
    #[arg(long, default_value_t = 100)]
    pub games: u32,
    /// MCTS iterations per move. Higher = stronger but slower.
    #[arg(long, default_value_t = 200)]
    pub mcts_iters: u32,
    /// Save a checkpoint every N games.
    #[arg(long, default_value_t = 25)]
    pub checkpoint_every: u32,
    /// Hard RAM cap in megabytes; the process aborts cleanly past this.
    #[arg(long, default_value_t = 1024)]
    pub max_rss_mb: u64,
    /// Reproducibility seed.
    #[arg(long, default_value_t = 0)]
    pub seed: u64,
    /// Skip writing the per-game move transcript (games.txt). Saves disk space
    /// when a human-readable move log is not needed.
    #[arg(long, action = clap::ArgAction::SetTrue)]
    pub no_game_log: bool,
    /// Resume offset: emit GameComplete events with `index = start_index + i + 1`.
    /// Used so that resuming a previously-stopped job appends contiguous
    /// indices to the existing log.ndjson rather than restarting at 1.
    #[arg(long, default_value_t = 0)]
    pub start_index: u32,
}

#[derive(Args, Debug)]
pub struct PlayArgs {
    #[arg(long)]
    pub rules: PathBuf,
    #[arg(long)]
    pub model: Option<PathBuf>,
    #[arg(long, default_value_t = 400)]
    pub mcts_iters: u32,
}

pub fn run_training(args: TrainArgs) -> Result<()> {
    let rules = Rules::load(&args.rules)?;
    fs::create_dir_all(&args.out)
        .with_context(|| format!("creating output dir {}", args.out.display()))?;
    let log_path = args.out.join("log.ndjson");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("opening log {}", log_path.display()))?;
    let mut log = BufWriter::new(log);
    // Optional plain-text game transcript — one game section per game, written
    // in human-readable chess notation. Disabled when --no-game-log is passed.
    let mut games_log: Option<BufWriter<File>> = if args.no_game_log {
        None
    } else {
        let games_path = args.out.join("games.txt");
        let games_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&games_path)
            .with_context(|| format!("opening game log {}", games_path.display()))?;
        Some(BufWriter::new(games_file))
    };
    let started = Instant::now();
    let seed = if args.seed == 0 {
        // Time-based seed if not specified
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(1)
    } else {
        args.seed
    };
    let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed);

    write_event(
        &mut log,
        &ProgressEvent::Started {
            games_target: args.games + args.start_index,
            seed,
        },
    )?;

    let mcts = Mcts::new(args.mcts_iters);

    for game_idx in 0..args.games {
        if let Some(rss_mb) = current_rss_mb() {
            if rss_mb > args.max_rss_mb {
                write_event(
                    &mut log,
                    &ProgressEvent::Aborted {
                        reason: "memory limit exceeded",
                    },
                )?;
                log.flush().ok();
                std::process::exit(2);
            }
        }
        let game_started = Instant::now();
        let mut board = Board::from_rules(&rules);
        let mut moves_played = 0u32;
        let mut book_buffer: Vec<PendingBookRecord> = Vec::with_capacity(BOOK_PLY_LIMIT as usize);
        // Human-readable move lines for this game — appended to games.txt after the game ends.
        // Only populated when the game log is enabled.
        let mut move_lines: Vec<String> = Vec::new();
        // Track position occurrences for n-fold repetition. Seeded with the
        // starting position so a cycle back to the opening counts.
        let mut position_history: HashMap<String, u32> = HashMap::new();
        position_history.insert(position_signature(&board, &rules), 1);
        // Tracks how many times in a row the side-to-move had no legal
        // moves and the game-rules said to skip rather than end. Two
        // consecutive skips means BOTH sides are stuck — break out as a
        // non-decisive draw to avoid an infinite loop.
        let mut consecutive_skips: u32 = 0;
        let (result, end_reason) = if rules.game.simultaneous_turns {
            // Simul-turns games run in their own loop. Opening-book and
            // repetition tracking are owned by the simul module since
            // moves arrive in pairs (one per side per round). The book
            // is intentionally NOT populated for simul-turns games — the
            // current book schema assumes single-move plies.
            let outcome = crate::simul::play_simul_game(
                &mut board,
                &rules,
                &mcts,
                &mut rng,
                games_log.is_some(),
            );
            moves_played = outcome.moves_played;
            move_lines = outcome.move_lines;
            (outcome.result, outcome.end_reason)
        } else { loop {
            let moves = legal_moves(&board, &rules);
            if moves.is_empty() {
                if rules.game.mate_condition && in_check(&board, &rules, board.turn) {
                    break (
                        GameResult::Win(if board.turn == 1 { 2 } else { 1 }),
                        crate::protocol::EndReason::Checkmate,
                    );
                }
                // stalemate_win_condition: the player who is stalemated WINS
                if rules.game.stalemate_win_condition {
                    break (
                        GameResult::Win(board.turn),
                        crate::protocol::EndReason::StalemateWin,
                    );
                }
                // no_moves_condition: the player who is stalemated LOSES
                if rules.game.no_moves_condition {
                    break (
                        GameResult::Win(if board.turn == 1 { 2 } else { 1 }),
                        crate::protocol::EndReason::NoMovesLoss,
                    );
                }
                // stalemate_draw_condition: classic chess rule — draw.
                if rules.game.stalemate_draw_condition {
                    break (GameResult::Draw, crate::protocol::EndReason::Stalemate);
                }
                // No stalemate rule applies — mirror live-game behavior:
                // skip the stuck player's turn and continue. If the
                // opponent is ALSO stuck (two consecutive skips) the game
                // is a non-decisive draw rather than infinite-looping.
                consecutive_skips += 1;
                if consecutive_skips >= 2 {
                    break (GameResult::Draw, crate::protocol::EndReason::NoMove);
                }
                board.turn = if board.turn == 1 { 2 } else { 1 };
                continue;
            }
            consecutive_skips = 0;

            // Insufficient-material draw: in mate_condition games (where the
            // only decisive outcome is checkmate), if every remaining piece
            // on the board is a royal piece, neither side can ever achieve
            // mate — declare a draw instead of grinding out the move cap.
            if rules.game.mate_condition
                && !board.pieces.is_empty()
                && board.pieces.iter().all(|p| is_royal_piece(&rules, p.piece_id))
            {
                break (
                    GameResult::Draw,
                    crate::protocol::EndReason::InsufficientMaterial,
                );
            }

            // Hard cap: if a game somehow dodges every drawing rule and runs
            // past 400 plies, finish with an aggressive capture-biased
            // rollout. This is only a fallback for game variants that have
            // no fifty-move rule, no repetition rule, and no way to reach
            // insufficient-material — otherwise the checks above fire first.
            if moves_played > 400 {
                let (rr, rreason) =
                    crate::mcts::rollout_with_reason_aggressive(&mut board, &rules, &mut rng, 800);
                // Royal captures during a rollout are pseudo-legal shortcuts,
                // not reachable under the real rules of a mate_condition
                // game. Fold them to the indeterminate cap outcome so the
                // analysis report doesn't claim a spurious decisive result.
                let (rr_final, reason) = match rreason {
                    crate::protocol::EndReason::RolloutCap => {
                        (rr, crate::protocol::EndReason::MoveCapRollout)
                    }
                    crate::protocol::EndReason::RoyalCapture if rules.game.mate_condition => {
                        (GameResult::Draw, crate::protocol::EndReason::MoveCapRollout)
                    }
                    other => (rr, other),
                };
                break (rr_final, reason);
            }
            let mv = match mcts.choose(&mut rng, &board, &rules) {
                Some(m) => m,
                None => break (GameResult::Draw, crate::protocol::EndReason::NoMove),
            };
            // Record opening-book entry BEFORE applying the move so the
            // signature represents the position the mover faced.
            if moves_played < BOOK_PLY_LIMIT {
                book_buffer.push(PendingBookRecord {
                    ply: moves_played,
                    sig: position_signature(&board, &rules),
                    mv_str: move_string(&mv, &rules),
                    mover: board.turn,
                });
            }
            // Build a human-readable move line for this game's transcript.
            // Only runs when the game log is enabled (games_log is Some).
            if games_log.is_some() {
                let board_height = rules.board_height();
                // Look up the moving piece by board-instance id → template id → name.
                // (Move.piece_id is the board instance id, NOT the template id.)
                let piece_name = board.pieces.iter()
                    .find(|p| p.id == mv.piece_id)
                    .and_then(|board_piece| rules.piece(board_piece.piece_id))
                    .map(|template| template.piece_name.as_str())
                    .unwrap_or("Piece");
                // Captured piece — must be looked up BEFORE apply() removes it.
                let captured_piece_name: Option<String> = mv.capture.and_then(|cap_instance_id| {
                    board.pieces.iter()
                        .find(|p| p.id == cap_instance_id)
                        .and_then(|cap_piece| rules.piece(cap_piece.piece_id))
                        .map(|template| template.piece_name.clone())
                });
                let promotes_to_name: Option<String> = if mv.is_promotion {
                    mv.promote_to
                        .and_then(|template_id| rules.piece(template_id))
                        .map(|template| template.piece_name.clone())
                } else {
                    None
                };
                let from_square = coord_to_notation(mv.from.x, mv.from.y, board_height);
                let to_square   = coord_to_notation(mv.to.x,   mv.to.y,   board_height);
                let notation = if mv.is_castling {
                    // Use the actual from/to squares so the replay UI can
                    // reconstruct the exact king destination regardless of
                    // custom castling_distance settings. The " (castle)"
                    // suffix still signals castling to the parser.
                    format!("{}-{}", from_square, to_square)
                } else {
                    let separator = if captured_piece_name.is_some() { "x" } else { "-" };
                    let promo_suffix = promotes_to_name
                        .as_deref()
                        .map(|name| format!("={}", name))
                        .unwrap_or_default();
                    format!("{}{}{}{}", from_square, separator, to_square, promo_suffix)
                };
                let mut line = format!("  {:>4}. [P{}] {} {}",
                    moves_played + 1, board.turn, piece_name, notation);
                if let Some(ref cap_name) = captured_piece_name {
                    line.push_str(&format!(" (captures {})", cap_name));
                }
                if mv.is_castling {
                    line.push_str(" (castle)");
                }
                move_lines.push(line);
            }
            board.apply(&mv);
            moves_played += 1;

            // --- Post-move win condition checks ---
            // Capture the moving side BEFORE we read board.turn (which now
            // points at the opponent thanks to apply()).
            let mover_side = if board.turn == 1 { 2 } else { 1 };

            // promotion_condition: if the move ended on a promotion square
            // with a `can_promote` piece, the moving side wins instantly.
            // Mirrors server/game-socket.js win-on-promotion handling.
            if rules.game.promotion_condition && mv.is_promotion {
                break (
                    GameResult::Win(mover_side),
                    crate::protocol::EndReason::Promotion,
                );
            }

            // lose_all_pieces_condition (anti-chess): a player WINS when they
            // have lost all their pieces. Check both sides after each capture.
            if rules.game.lose_all_pieces_condition && mv.capture.is_some() {
                let p1_count = board.pieces.iter().filter(|p| p.player == 1).count();
                let p2_count = board.pieces.iter().filter(|p| p.player == 2).count();
                if p1_count == 0 && p2_count == 0 {
                    // Both empty simultaneously — draw (extremely unlikely)
                    break (GameResult::Draw, crate::protocol::EndReason::LoseAllPieces);
                } else if p1_count == 0 {
                    break (GameResult::Win(1), crate::protocol::EndReason::LoseAllPieces);
                } else if p2_count == 0 {
                    break (GameResult::Win(2), crate::protocol::EndReason::LoseAllPieces);
                }
            }

            // capture_condition: the side that captured all opponent pieces wins.
            // For the simple case (no specific piece type required): if any side
            // reaches 0 pieces, the other wins. When `capture_piece` specifies a
            // virtual template id, check that the matching piece is gone.
            // When `capture_condition_requires_all` is set, ALL pieces flagged
            // `ends_game_on_capture` must be removed (mirrors the live server's
            // anti-king-only-capture logic for variants where every named piece
            // must fall before the game ends).
            if rules.game.capture_condition && mv.capture.is_some() {
                let requires_all = rules.game.capture_condition_requires_all;
                let check_side_gone = |player: i32| -> bool {
                    if let Some(cp_id) = rules.game.capture_piece {
                        // A specific piece type must be eliminated.
                        !board.pieces.iter().any(|p| p.player == player && {
                            // Map virtual piece id back via the rules piece map.
                            p.piece_id == cp_id
                            || rules.piece(p.piece_id)
                                .map(|t| t.real_piece_id == cp_id || t.id == cp_id)
                                .unwrap_or(false)
                        })
                    } else if requires_all {
                        // Every piece flagged ends_game_on_capture must be gone.
                        !board.pieces.iter().any(|p| p.player == player
                            && rules.piece(p.piece_id)
                                .map(|t| t.ends_game_on_capture)
                                .unwrap_or(false))
                    } else {
                        // Default: capture all opponent pieces.
                        !board.pieces.iter().any(|p| p.player == player)
                    }
                };
                if check_side_gone(1) && check_side_gone(2) {
                    break (GameResult::Draw, crate::protocol::EndReason::CaptureCondition);
                } else if check_side_gone(1) {
                    break (GameResult::Win(2), crate::protocol::EndReason::CaptureCondition);
                } else if check_side_gone(2) {
                    break (GameResult::Win(1), crate::protocol::EndReason::CaptureCondition);
                }
            }

            // squares_condition: update holding counter and check if a player
            // has held enough control squares for the required half-turns.
            if rules.game.squares_condition && !rules.control_squares.is_empty() {
                update_control_tracking(&mut board, &rules);
                if let Some(winner) = check_squares_winner(&board, &rules) {
                    break (GameResult::Win(winner), crate::protocol::EndReason::SquaresCondition);
                }
            }

            if let Some(limit) = rules.game.draw_move_limit {
                if board.plies_since_capture as i32 >= limit * 2 {
                    break (GameResult::Draw, crate::protocol::EndReason::MoveLimit);
                }
            }
            if let Some(rep_limit) = rules.game.repetition_draw_count {
                if rep_limit > 1 {
                    let sig = position_signature(&board, &rules);
                    let count = position_history.entry(sig).and_modify(|c| *c += 1).or_insert(1);
                    if (*count) as i32 >= rep_limit {
                        break (GameResult::Draw, crate::protocol::EndReason::Repetition);
                    }
                }
            }
        }};

        let winner = match result {
            GameResult::Win(p) => Some(p),
            GameResult::Draw | GameResult::Value(_) => None,
        };
        // Persist the per-move book records for this game now that we
        // know the winner. Failures are non-fatal — book is optional.
        if let Err(e) = write_pending(&args.out, &book_buffer, winner) {
            eprintln!("[book] write_pending failed: {e}");
        }
        let absolute_index = args.start_index + game_idx + 1;
        write_event(
            &mut log,
            &ProgressEvent::GameComplete {
                index: absolute_index,
                moves: moves_played,
                winner,
                end_reason,
                elapsed_ms: game_started.elapsed().as_millis(),
            },
        )?;
        log.flush().ok();
        // Append this game's plain-text section to games.txt (if the log is enabled).
        if let Some(ref mut glog) = games_log {
            let outcome_str = match winner {
                Some(player) => format!("Player {} wins", player),
                None => "Draw".to_string(),
            };
            // Serialize end_reason to its snake_case JSON string, then make it readable.
            let reason_str = serde_json::to_value(end_reason)
                .map(|v| v.as_str().unwrap_or("unknown").replace('_', " "))
                .unwrap_or_else(|_| "unknown".to_string());
            writeln!(glog,
                "\n=== Game #{} — {} ({}) — {} moves ===",
                absolute_index, outcome_str, reason_str, moves_played
            ).ok();
            for line in &move_lines {
                writeln!(glog, "{}", line).ok();
            }
            glog.flush().ok();
        }

        if (game_idx + 1) % args.checkpoint_every == 0 {
            let path = args.out.join(format!("model-{:06}.bin", absolute_index));
            write_placeholder_model(&path, absolute_index)?;
            // Roll the opening-book aggregation alongside each checkpoint
            // so book.json is always consistent with the latest model.
            if let Err(e) = aggregate_book(&args.out) {
                eprintln!("[book] aggregate_book failed: {e}");
            }
            let path_str = path.to_string_lossy().to_string();
            write_event(
                &mut log,
                &ProgressEvent::Checkpoint {
                    path: &path_str,
                    games_played: absolute_index,
                },
            )?;
            prune_old_checkpoints(&args.out, 10).ok();
        }
    }

    write_event(
        &mut log,
        &ProgressEvent::Finished {
            games_played: args.start_index + args.games,
            elapsed_ms: started.elapsed().as_millis(),
        },
    )?;
    log.flush().ok();
    // Final book aggregation in case the run ended between checkpoint
    // boundaries (e.g. the games_target was not a multiple of
    // checkpoint_every).
    if let Err(e) = aggregate_book(&args.out) {
        eprintln!("[book] final aggregate_book failed: {e}");
    }
    Ok(())
}

pub fn run_inference(args: PlayArgs) -> Result<()> {
    let rules = Rules::load(&args.rules)?;
    let mcts = Mcts::new(args.mcts_iters);
    let mut rng = Xoshiro256PlusPlus::seed_from_u64(0xC0FFEE);
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in BufReader::new(stdin.lock()).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let board: Board = match serde_json::from_str::<crate::board::Board>(&line) {
            Ok(b) => b,
            Err(e) => {
                writeln!(out, "{{\"error\":\"bad board: {e}\"}}")?;
                out.flush().ok();
                continue;
            }
        };
        let _ = &args.model; // model unused until phase 2
        let mv = mcts.choose(&mut rng, &board, &rules);
        let payload = match mv {
            Some(m) => serde_json::to_string(&m).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        };
        writeln!(out, "{payload}")?;
        out.flush().ok();
    }
    Ok(())
}

/// Convert a 0-based column index to a chess file letter.
/// Matches the front-end `colToFile` helper: a–z for columns 0–25,
/// then aa–az for 26–51, etc.
fn col_to_file(x: i32) -> String {
    if x < 0 { return "?".to_string(); }
    if x < 26 {
        return std::char::from_u32(b'a' as u32 + x as u32)
            .unwrap_or('?')
            .to_string();
    }
    // Two-letter file for boards wider than 26 columns.
    let first  = std::char::from_u32(b'a' as u32 + (x / 26) as u32 - 1).unwrap_or('?');
    let second = std::char::from_u32(b'a' as u32 + (x % 26) as u32).unwrap_or('?');
    format!("{}{}", first, second)
}

/// Convert 0-based (x, y) board coordinates to standard chess notation.
/// y=0 is the top rank; rank = board_height − y (1-indexed from the bottom),
/// matching the front-end coordinate system.
fn coord_to_notation(x: i32, y: i32, board_height: i32) -> String {
    format!("{}{}", col_to_file(x), board_height - y)
}

fn write_event(w: &mut impl Write, ev: &ProgressEvent) -> Result<()> {
    let line = serde_json::to_string(ev)?;
    writeln!(w, "{line}")?;
    Ok(())
}

/// Phase-1 placeholder: the "model" is a JSON blob recording how many games
/// of self-play produced it. Phase 2 replaces this with a `burn`-serialized
/// neural network.
fn write_placeholder_model(path: &PathBuf, games: u32) -> Result<()> {
    let mut f = File::create(path)?;
    let body = serde_json::json!({
        "format": "squarestrat-ai-v0",
        "games_played": games,
        "note": "Phase-1 scaffold model. Replace with neural-net weights in phase 2."
    });
    f.write_all(serde_json::to_vec_pretty(&body)?.as_slice())?;
    Ok(())
}

fn prune_old_checkpoints(dir: &PathBuf, keep: usize) -> Result<()> {
    let mut models: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("model-")
        })
        .collect();
    models.sort_by_key(|e| e.file_name());
    if models.len() > keep {
        for old in &models[..models.len() - keep] {
            let _ = fs::remove_file(old.path());
        }
    }
    Ok(())
}

/// Best-effort RSS query. Returns `None` on platforms we can't inspect
/// without extra dependencies — in that case the cap is enforced only by
/// the OS / parent process.
fn current_rss_mb() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let s = fs::read_to_string("/proc/self/status").ok()?;
        for line in s.lines() {
            if let Some(rest) = line.strip_prefix("VmRSS:") {
                let kb: u64 = rest
                    .split_whitespace()
                    .next()?
                    .parse()
                    .ok()?;
                return Some(kb / 1024);
            }
        }
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}
