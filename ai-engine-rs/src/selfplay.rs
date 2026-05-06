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
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
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

    // Version gate: if the rules file requires a minimum binary version and
    // our version is older, abort with a helpful message instead of producing
    // potentially incompatible training data.
    let min_ver = rules.game.trainer_min_version.trim();
    if !min_ver.is_empty() {
        let own_ver = env!("CARGO_PKG_VERSION");
        if !version_satisfies(own_ver, min_ver) {
            eprintln!();
            eprintln!("=====================================================");
            eprintln!(" TRAINER VERSION OUTDATED — TRAINING BLOCKED");
            eprintln!("=====================================================");
            eprintln!(" Your trainer version : {}", own_ver);
            eprintln!(" Required version     : {}", min_ver);
            eprintln!();
            eprintln!(" Your trainer is out of date and cannot train this");
            eprintln!(" game without risking incompatible data.");
            eprintln!();
            eprintln!(" HOW TO UPDATE:");
            eprintln!("   1. Go to your game's page on the website");
            eprintln!("   2. Click the 'Train Locally' section");
            eprintln!("   3. Download a fresh trainer pack");
            eprintln!("   4. Copy your 'output/' folder into the new pack");
            eprintln!("   5. Run the trainer script again");
            eprintln!("=====================================================");
            eprintln!();
            std::process::exit(1);
        }
    }

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

    // Pre-flight: verify the initial position has at least one legal move for
    // player 1. If not, the game will trivially stalemate every single game,
    // producing 0 useful training data. Exit with a clear diagnostic rather
    // than silently burning all game slots.
    {
        let test_board = Board::from_rules(&rules);
        let initial_moves = legal_moves(&test_board, &rules);
        let p1_pieces: Vec<_> = test_board.pieces.iter().filter(|p| p.player == 1).collect();
        let neutral_pieces: Vec<_> = test_board.pieces.iter().filter(|p| p.is_neutral).collect();
        if initial_moves.is_empty() {
            eprintln!();
            eprintln!("=============================================================");
            eprintln!(" INITIAL POSITION HAS NO LEGAL MOVES FOR PLAYER 1 -- ABORTED");
            eprintln!("=============================================================");
            eprintln!(" Player 1 pieces in starting position : {}", p1_pieces.len());
            eprintln!(" Neutral pieces in starting position  : {}", neutral_pieces.len());
            eprintln!(" Total pieces on board                 : {}", test_board.pieces.len());
            eprintln!();
            if p1_pieces.is_empty() && neutral_pieces.is_empty() {
                eprintln!(" CAUSE: No player 1 pieces (or neutral pieces) exist in the");
                eprintln!("        starting position. Check that the game has pieces");
                eprintln!("        assigned to player 1 in the wizard (Step 3).");
            } else if p1_pieces.is_empty() {
                eprintln!(" CAUSE: All pieces are neutral (player=0). If this game uses");
                eprintln!("        neutral pieces exclusively, the game may not be");
                eprintln!("        trainable in the current configuration.");
            } else {
                eprintln!(" CAUSE: Player 1 has {} piece(s) but none can move from the", p1_pieces.len());
                eprintln!("        starting position. Check movement values, board size,");
                eprintln!("        and any zone/restriction square configurations.");
            }
            eprintln!();
            eprintln!(" Re-export the game rules from the site and try again.");
            eprintln!("=============================================================");
            eprintln!();
            std::process::exit(1);
        }
    }

    // Per-run tallies for the end-of-run summary.
    let mut tally_p1_wins: u32 = 0;
    let mut tally_p2_wins: u32 = 0;
    let mut tally_draws: u32 = 0;
    let mut reason_counts: HashMap<String, u32> = HashMap::new();

    // Graceful Ctrl+C: set this flag rather than killing the process so the
    // end-of-run cleanup (write_stratbook, write_job_summary) always runs.
    let interrupted = Arc::new(AtomicBool::new(false));
    {
        let flag = Arc::clone(&interrupted);
        if let Err(e) = ctrlc::set_handler(move || {
            flag.store(true, Ordering::SeqCst);
        }) {
            eprintln!("[warn] Could not register Ctrl+C handler: {e}");
        }
    }

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
        let mut consecutive_equal_score_turns = 0i32;
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
            let apply_result = board.apply(&mv, &rules);
            moves_played += 1;

            // --- Turn-start effects for the new active player ---
            // Apply burn DoT, then HP regen, mirroring game-socket.js order.
            let burn_kills = board.process_turn_start(board.turn, &rules);
            // Win conditions triggered by burn kills (capture/elimination).
            if !burn_kills.is_empty() {
                if rules.game.capture_condition {
                    let requires_all = rules.game.capture_condition_requires_all;
                    let check_side_gone = |player: i32| -> bool {
                        if requires_all {
                            !board.pieces.iter().any(|p| p.player == player
                                && rules.piece(p.piece_id).map(|t| t.ends_game_on_capture).unwrap_or(false))
                        } else {
                            !board.pieces.iter().any(|p| p.player == player)
                        }
                    };
                    if check_side_gone(1) && check_side_gone(2) {
                        break (GameResult::Draw, crate::protocol::EndReason::BurnKill);
                    } else if check_side_gone(1) {
                        break (GameResult::Win(2), crate::protocol::EndReason::BurnKill);
                    } else if check_side_gone(2) {
                        break (GameResult::Win(1), crate::protocol::EndReason::BurnKill);
                    }
                }
            }

            // --- points_to_win check ---
            if let Some(threshold) = rules.game.points_to_win {
                let p1_wins = board.points[0] >= threshold;
                let p2_wins = board.points[1] >= threshold;
                if p1_wins && p2_wins {
                    break (GameResult::Draw, crate::protocol::EndReason::PointsDraw);
                } else if p1_wins {
                    break (GameResult::Win(1), crate::protocol::EndReason::PointsWin);
                } else if p2_wins {
                    break (GameResult::Win(2), crate::protocol::EndReason::PointsWin);
                }
            }

            // --- equal-points draw checks ---
            if rules.game.draw_equal_points_at_turn.is_some()
                || rules.game.draw_equal_points_consecutive.is_some()
            {
                let equal = board.points[0] == board.points[1];
                if equal {
                    consecutive_equal_score_turns += 1;
                } else {
                    consecutive_equal_score_turns = 0;
                }
                if let Some(turn_thresh) = rules.game.draw_equal_points_at_turn {
                    if board.ply as i32 >= turn_thresh * 2 && equal {
                        break (GameResult::Draw, crate::protocol::EndReason::PointsDraw);
                    }
                }
                if let Some(consec_thresh) = rules.game.draw_equal_points_consecutive {
                    if consecutive_equal_score_turns >= consec_thresh {
                        break (GameResult::Draw, crate::protocol::EndReason::PointsDraw);
                    }
                }
            }

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
            // have lost all their pieces. Check both sides after each kill.
            if rules.game.lose_all_pieces_condition && apply_result.any_killed() {
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
            if rules.game.capture_condition && apply_result.any_killed() {
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
                    // Simultaneous capture — check die_on_capture_grants_win
                    let grants_win_attacker = apply_result.killed_info.iter().find_map(|(pid, player)| {
                        rules.piece((*pid).into()).and_then(|t| {
                            if t.die_on_capture && t.die_on_capture_grants_win {
                                Some(*player)
                            } else {
                                None
                            }
                        })
                    });
                    if let Some(winner) = grants_win_attacker {
                        break (GameResult::Win(winner), crate::protocol::EndReason::CaptureCondition);
                    }
                    break (GameResult::Draw, crate::protocol::EndReason::CaptureCondition);
                } else if check_side_gone(1) {
                    break (GameResult::Win(2), crate::protocol::EndReason::CaptureCondition);
                } else if check_side_gone(2) {
                    break (GameResult::Win(1), crate::protocol::EndReason::CaptureCondition);
                }
            }

            // squares_condition: update holding counter and check if a player
            // has held enough control squares for the required half-turns.
            if !rules.control_squares.is_empty() {
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
        let game_elapsed_ms = game_started.elapsed().as_millis();
        write_event(
            &mut log,
            &ProgressEvent::GameComplete {
                index: absolute_index,
                moves: moves_played,
                winner,
                end_reason,
                elapsed_ms: game_elapsed_ms,
            },
        )?;
        log.flush().ok();
        // Print a compact human-readable progress line to stdout so that
        // anyone watching the terminal (local trainer script) can see
        // per-game results as they happen.
        let total = args.games + args.start_index;
        let outcome_str = match winner {
            Some(1) => "P1 wins",
            Some(2) => "P2 wins",
            _ => "Draw   ",
        };
        let reason_label = end_reason_label(end_reason);
        println!("[{:>5}/{:<5}] {} ({}, {} moves, {}ms)",
            absolute_index, total, outcome_str, reason_label, moves_played, game_elapsed_ms);
        // Update run tallies for the end-of-run summary.
        match winner {
            Some(1) => tally_p1_wins += 1,
            Some(2) => tally_p2_wins += 1,
            _ => tally_draws += 1,
        }
        *reason_counts.entry(reason_label.to_string()).or_insert(0) += 1;
        // Graceful early exit: if Ctrl+C was pressed, break here so the
        // end-of-run block below writes output.stratbook with partial data.
        if interrupted.load(Ordering::SeqCst) {
            println!("\nTraining interrupted — saving progress to output.stratbook...");
            break;
        }
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
            // Write an up-to-date stratbook at every checkpoint so the user
            // always has a usable output.stratbook, even if training is
            // stopped early (Ctrl+C). Partial data is valid for uploading.
            let checkpoint_games = tally_p1_wins + tally_p2_wins + tally_draws;
            if checkpoint_games > 0 {
                if let Err(e) = write_job_summary(&args, checkpoint_games, tally_p1_wins, tally_p2_wins, tally_draws, &reason_counts, started.elapsed().as_millis()) {
                    eprintln!("[summary] checkpoint write_job_summary failed: {e}");
                }
                if let Err(e) = write_stratbook(&args.out) {
                    eprintln!("[stratbook] checkpoint write_stratbook failed: {e}");
                }
            }
            let path_str = path.to_string_lossy().to_string();
            write_event(
                &mut log,
                &ProgressEvent::Checkpoint {
                    path: &path_str,
                    games_played: absolute_index,
                },
            )?;
            println!("Checkpoint saved: {} ({} games done)", path_str, absolute_index);
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
    let total_elapsed = started.elapsed();
    let secs = total_elapsed.as_secs_f64();
    let total_games = tally_p1_wins + tally_p2_wins + tally_draws;
    println!("Training complete: {} games in {:.1}s", args.start_index + args.games, secs);
    // Print a results summary so it's easy to spot suspicious draw rates.
    if total_games > 0 {
        println!("  Results : P1 wins {}/{} ({:.0}%)  P2 wins {}/{} ({:.0}%)  Draws {}/{} ({:.0}%)",
            tally_p1_wins, total_games, 100.0 * tally_p1_wins as f64 / total_games as f64,
            tally_p2_wins, total_games, 100.0 * tally_p2_wins as f64 / total_games as f64,
            tally_draws,   total_games, 100.0 * tally_draws   as f64 / total_games as f64);
        // Sort reasons by count descending.
        let mut reasons: Vec<(String, u32)> = reason_counts.clone().into_iter().collect();
        reasons.sort_by(|a, b| b.1.cmp(&a.1));
        let reason_parts: Vec<String> = reasons.iter()
            .map(|(r, n)| format!("{} x{}", r, n))
            .collect();
        println!("  End reasons : {}", reason_parts.join(", "));
    }
    // Final book aggregation in case the run ended between checkpoint
    // boundaries (e.g. the games_target was not a multiple of
    // checkpoint_every).
    if let Err(e) = aggregate_book(&args.out) {
        eprintln!("[book] final aggregate_book failed: {e}");
    }

    // Write job_summary.json and emit the combined .stratbook file.
    if total_games > 0 {
        if let Err(e) = write_job_summary(&args, total_games, tally_p1_wins, tally_p2_wins, tally_draws, &reason_counts, total_elapsed.as_millis()) {
            eprintln!("[summary] Failed to write job_summary.json: {e}");
        }
        if let Err(e) = write_stratbook(&args.out) {
            eprintln!("[stratbook] Failed to write .stratbook file: {e}");
        }
    }

    Ok(())
}

/// Write job_summary.json into the output directory with aggregate training stats.
/// Also appends a `{"type":"job_summary",...}` line to book.jsonl so the
/// .chessbook combined format carries the stats inline.
fn write_job_summary(
    args: &TrainArgs,
    total_games: u32,
    p1_wins: u32,
    p2_wins: u32,
    draws: u32,
    reason_counts: &HashMap<String, u32>,
    elapsed_ms: u128,
) -> Result<()> {
    let version = env!("CARGO_PKG_VERSION");
    // Build a JSON object for reason_counts.
    let reasons_json: String = {
        let mut parts: Vec<(String, u32)> = reason_counts.iter().map(|(k,v)| (k.clone(), *v)).collect();
        parts.sort_by(|a, b| b.1.cmp(&a.1));
        let inner: Vec<String> = parts.iter()
            .map(|(k, v)| format!("\"{}\":{}", k, v))
            .collect();
        format!("{{{}}}", inner.join(","))
    };
    let avg_moves_per_game = 0u32; // Not tracked at run level; per-game in log.ndjson
    let _ = avg_moves_per_game;
    let json = format!(
        "{{\
\"type\":\"job_summary\",\
\"trainer_version\":\"{version}\",\
\"total_games\":{total_games},\
\"p1_wins\":{p1_wins},\
\"p2_wins\":{p2_wins},\
\"draws\":{draws},\
\"mcts_iters\":{mcts_iters},\
\"total_elapsed_ms\":{elapsed_ms},\
\"end_reason_counts\":{reasons_json}\
}}",
        version = version,
        total_games = total_games,
        p1_wins = p1_wins,
        p2_wins = p2_wins,
        draws = draws,
        mcts_iters = args.mcts_iters,
        elapsed_ms = elapsed_ms,
        reasons_json = reasons_json,
    );
    // Write standalone job_summary.json.
    let summary_path = args.out.join("job_summary.json");
    std::fs::write(&summary_path, &json)
        .with_context(|| format!("writing {}", summary_path.display()))?;
    println!("Summary written to: {}", summary_path.display());
    Ok(())
}

/// Produce a combined `.stratbook` file in the output directory.
/// Format: all lines from book.jsonl followed by the job_summary JSON line.
/// The final line has `"type":"job_summary"` so parsers can detect it.
fn write_stratbook(out_dir: &std::path::Path) -> Result<()> {
    let book_path = out_dir.join("book.jsonl");
    let summary_path = out_dir.join("job_summary.json");
    if !book_path.exists() {
        return Ok(()); // No book data — skip.
    }
    let book_content = std::fs::read(&book_path)
        .with_context(|| format!("reading {}", book_path.display()))?;
    let stratbook_path = out_dir.join("output.stratbook");
    let mut f = BufWriter::new(
        std::fs::File::create(&stratbook_path)
            .with_context(|| format!("creating {}", stratbook_path.display()))?,
    );
    f.write_all(&book_content)?;
    // Ensure the book section ends with a newline before appending the summary.
    if !book_content.ends_with(b"\n") {
        writeln!(f)?;
    }
    // Append the summary line (if the file was written successfully).
    if summary_path.exists() {
        let summary_line = std::fs::read_to_string(&summary_path)
            .with_context(|| format!("reading {}", summary_path.display()))?;
        writeln!(f, "{}", summary_line.trim())?;
    }
    f.flush()?;
    println!("Stratbook written to: {}", stratbook_path.display());
    Ok(())
}

/// Returns a compact human-readable label for an end reason (shown in terminal progress lines).
fn end_reason_label(reason: crate::protocol::EndReason) -> &'static str {
    use crate::protocol::EndReason::*;
    match reason {
        Checkmate => "checkmate",
        Stalemate => "stalemate",
        StalemateWin => "stalemate win",
        NoMovesLoss => "no moves",
        CaptureCondition => "capture",
        LoseAllPieces => "lost all pieces",
        SquaresCondition => "squares held",
        MoveLimit => "move limit",
        MoveCapRollout => "move cap",
        RolloutCap => "rollout cap",
        NoMove => "no move",
        RoyalCapture => "royal capture",
        Repetition => "repetition",
        InsufficientMaterial => "insuf. material",
        Promotion => "promotion",
        SimultaneousCaptureDraw => "simul capture draw",
        SimultaneousCheckmateDraw => "simul checkmate draw",
        CancellationDraw => "cancellation draw",
        PointsWin => "points win",
        PointsDraw => "points draw",
        BurnKill => "burn kill",
    }
}

/// Returns true if `own_ver` is >= `required_ver`, using simple numeric
/// major.minor.patch comparison. Both strings must be "X.Y.Z" form.
fn version_satisfies(own_ver: &str, required_ver: &str) -> bool {
    fn parse(v: &str) -> (u32, u32, u32) {
        let parts: Vec<u32> = v.split('.').map(|s| s.parse().unwrap_or(0)).collect();
        (parts.first().copied().unwrap_or(0), parts.get(1).copied().unwrap_or(0), parts.get(2).copied().unwrap_or(0))
    }
    parse(own_ver) >= parse(required_ver)
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
