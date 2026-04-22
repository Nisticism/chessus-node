//! ai-engine: SquareStrat self-play training and inference.
//!
//! This binary is launched by the Node game server as a subprocess. It never
//! shares an address space with Node, so even an OOM or panic here cannot
//! crash the live game server.

use anyhow::Result;
use clap::{Parser, Subcommand};

mod board;
mod book;
mod mcts;
mod moves;
mod protocol;
mod rules;
mod selfplay;

#[derive(Parser, Debug)]
#[command(
    name = "ai-engine",
    version,
    about = "SquareStrat self-play trainer & inference engine"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Run self-play training for a game type.
    Train(selfplay::TrainArgs),
    /// Read board states on stdin, emit one move per line on stdout.
    Play(selfplay::PlayArgs),
    /// Validate a rules.json file without training. Useful as a smoke test.
    Validate {
        #[arg(long)]
        rules: std::path::PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Train(args) => selfplay::run_training(args),
        Cmd::Play(args) => selfplay::run_inference(args),
        Cmd::Validate { rules } => {
            let r = rules::Rules::load(&rules)?;
            println!(
                "OK: '{}' ({}x{}, {} piece templates, {} starting positions)",
                r.game.game_name,
                r.game.board_width,
                r.game.board_height,
                r.pieces.len(),
                r.starting_positions.len()
            );
            Ok(())
        }
    }
}
