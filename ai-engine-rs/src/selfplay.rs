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
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

use crate::board::Board;
use crate::book::{aggregate_book, move_string, position_signature, write_pending, PendingBookRecord, BOOK_PLY_LIMIT};
use crate::mcts::{GameResult, Mcts};
use crate::moves::{in_check, legal_moves};
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
        let (result, end_reason) = loop {
            let moves = legal_moves(&board, &rules);
            if moves.is_empty() {
                if rules.game.mate_condition && in_check(&board, &rules, board.turn) {
                    break (
                        GameResult::Win(if board.turn == 1 { 2 } else { 1 }),
                        crate::protocol::EndReason::Checkmate,
                    );
                }
                break (GameResult::Draw, crate::protocol::EndReason::Stalemate);
            }
            // Cap any single self-play game to keep training tractable.
            if moves_played > 400 {
                // Finish via random rollout to a definite verdict so the game has a
                // reportable outcome. Preserve the rollout's own end reason
                // (checkmate / stalemate / move-limit / royal-capture / cap)
                // when it gives us something more specific than "move cap".
                let (rr, rreason) = crate::mcts::rollout_with_reason(&mut board, &rules, &mut rng, 200);
                // In mate_condition games a royal capture is *not* a legal
                // terminal — it can only occur because the rollout uses
                // pseudo-legal moves for speed. Report it as an
                // indeterminate rollout-cap draw instead of a spurious
                // decisive result, so analysis doesn't claim "Player X won
                // by royal capture" for a game type that only allows
                // checkmate.
                let (rr_final, reason) = match rreason {
                    crate::protocol::EndReason::RolloutCap => (rr, crate::protocol::EndReason::MoveCapRollout),
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
            board.apply(&mv);
            moves_played += 1;
            if let Some(limit) = rules.game.draw_move_limit {
                if board.plies_since_capture as i32 >= limit * 2 {
                    break (GameResult::Draw, crate::protocol::EndReason::MoveLimit);
                }
            }
        };

        let winner = match result {
            GameResult::Win(p) => Some(p),
            GameResult::Draw => None,
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
