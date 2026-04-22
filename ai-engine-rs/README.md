# ai-engine-rs

Self-play training engine for SquareStrat. Spawned as a subprocess by the
Node game server; never imported in-process.

See [../AI_OVERHAUL_PLAN.md](../AI_OVERHAUL_PLAN.md) for the full design.

## Build

```
cargo build --release
```

The Node side expects the binary at
`ai-engine-rs/target/release/ai-engine` (Linux/Mac) or
`ai-engine-rs/target/release/ai-engine.exe` (Windows).

## Subcommands

### `train`
```
ai-engine train \
  --rules ai-training/38/rules.json \
  --out   ai-training/38/jobs/<job_id> \
  --games 1000 \
  --max-rss-mb 1024 \
  --seed 42
```

Runs MCTS self-play for `--games` games, writing `model-<n>.bin` checkpoints
and an `log.ndjson` file the Node admin UI tails for live progress.

### `play`
```
ai-engine play \
  --rules ai-training/38/rules.json \
  --model ai-training/38/current-model.bin
```

Reads board states (one JSON object per line) from stdin, writes one move
JSON per line to stdout. Used by the future "Adaptive" difficulty bridge.

## Resource caps

The trainer monitors its own resident set size and aborts cleanly if it
exceeds `--max-rss-mb`. The host also caps CPU via single-threaded
configuration and OS-level priority lowering in
`server/ai/training-manager.js`.
