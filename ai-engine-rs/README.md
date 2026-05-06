# ai-engine-rs

Self-play training engine for GridGrove. Spawned as a subprocess by the
Node game server; never imported in-process.

## Build

```
cargo build --release
```

The Node side expects the binary at
`ai-engine-rs/target/release/ai-engine` (Linux/Mac) or
`ai-engine-rs/target/release/ai-engine.exe` (Windows).

Running `npm run dev` (or `npm run build:rust`) automatically rebuilds and
copies the binary to `trainer-binaries/<platform>/` so the "Download Trainer
Pack" endpoint serves the latest version.

## Current version

See `Cargo.toml` → `version`. The server reads this via `TRAINER_VERSION` in
`server/ai/export-game-rules.js`. Bump both together when the protocol changes.

## Subcommands

### `train`
```
ai-engine train \
  --rules <path/to/rules.json> \
  --out   <output-directory> \
  --games 500 \
  --mcts-iters 200 \
  --max-rss-mb 1024 \
  --seed 42
```

Runs MCTS self-play for `--games` games. Two output files are produced in the
`--out` directory:

| File | Description |
|------|-------------|
| `book.jsonl` | Per-move training records written continuously during training (intermediate format). |
| `output.stratbook` | Combined package written at the end. Contains all training data plus a `job_summary.json` header. **This is the file to upload to the site.** |
| `log.ndjson` | Progress log tailed by the admin UI for live status. |
| `model-<n>.bin` | Checkpoint files saved every N games. |
| `job_summary.json` | Summary stats (MCTS setting, win/draw/loss counts, etc.). |

The site upload endpoint accepts either `output.stratbook` directly or a zip
of the entire output directory.

### `play`
```
ai-engine play \
  --rules <path/to/rules.json> \
  --model <path/to/model.bin>
```

Reads board states (one JSON object per line) from stdin, writes one move
JSON per line to stdout. Used by the adaptive difficulty bridge on the server.

## Resource caps

The trainer monitors its own resident set size and aborts cleanly if it
exceeds `--max-rss-mb`. The server also runs training jobs at reduced OS
priority via `server/ai/training-manager.js`.

## Protocol

Game rules are passed as a JSON file (`rules.json`) exported by
`server/ai/export-game-rules.js`. The Rust structs that deserialize this are
in `src/protocol.rs`. When adding a new column to `pieces` or `game_types`,
update `protocol.rs`, `export-game-rules.js`, and any consumers in
`src/moves.rs` / `src/selfplay.rs`. See the memory note
`ai-rules-sync-reminder.md` for the full checklist.
