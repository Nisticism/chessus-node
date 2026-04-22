# AI Overhaul Plan

A self-play, machine-learning-driven AI for SquareStrat games. Built as an
external Rust process so it cannot crash the Node game server, with rules
loaded directly from the live database (so any custom variant — not just
chess — can be trained the same way).

## Goals

1. **Self-play training** of an AI for any registered `game_type_id`.
2. **DB-driven rules** — the trainer loads `game_types`, `pieces`, and
   `game_type_pieces` exactly the way the live game does, so the model is
   learning the **actual rules** the players see, not generic chess.
3. **A new "Adaptive" difficulty tier** that, once a model is trained, plays
   moves in real games by consulting the trained model.
4. **Admin-portal control** — start, monitor, and stop training jobs from the
   admin dashboard. No CLI required for routine operation.
5. **Resource-safe** — training is sandboxed in a separate process with
   strict memory + CPU caps so the production game server is never starved.

## Why Rust

| Concern | Rust | C++ | Python |
|--|--|--|--|
| Memory safety (won't OOM the host) | ✅ | ❌ | ✅ |
| Self-play throughput | ✅ near-C++ | ✅ best | ❌ 10–100× slower |
| Single-binary deploy | ✅ | ⚠️ | ❌ |
| ML libraries | ✅ `burn`, `candle`, `tch` | ✅ LibTorch | ✅✅ |
| FFI to Node | ✅ stdio JSON / `napi-rs` | ✅ | ✅ |

Rust wins on the only axis that matters here: **the game server stays up no
matter what the trainer does.**

## Algorithm: AlphaZero-lite

- **Phase 1 (this scaffold):** Monte Carlo Tree Search with random rollouts +
  a UCT selection policy. No neural net yet. This is enough to demonstrate
  end-to-end self-play and produce playable models.
- **Phase 2 (next):** Replace the random rollout with a small policy/value
  network trained on the self-play games. The MCTS already exposes the
  hooks needed (`policy_prior`, `value_estimate`).
- **Phase 3:** Iterated self-play loop with ELO gating — only promote a new
  model if it beats the previous one.

This staged approach means we get something useful today and grow into a
real AlphaZero clone without rewriting.

## Architecture

```
┌────────────────────────┐        spawn (low priority,             ┌─────────────────────────┐
│  Node admin endpoints  │  ──── 1 GB RAM, 1 CPU cap)──────────►   │  ai-engine-rs (Rust)    │
│  /api/admin/ai-training│                                          │  cargo binary           │
└─────────┬──────────────┘                                          │                         │
          │                                                         │  subcommands:           │
          │  reads/writes ai_training_jobs                          │   train --rules X.json  │
          │                                                         │   play  --model M.bin   │
          ▼                                                         │                         │
┌────────────────────────┐                                          │  outputs:               │
│  MariaDB / MySQL       │                                          │   ai-training/<id>/     │
│  ai_training_jobs      │                                          │     model-N.bin         │
│  ai_models             │                                          │     log.ndjson          │
└────────────────────────┘                                          └─────────────────────────┘
          ▲
          │ rules dump (read-only):
          │   game_types row + pieces + game_type_pieces
          │   → ai-training/<game_type_id>/rules.json
```

### Node side
- [server/ai/training-manager.js](server/ai/training-manager.js) — spawn,
  monitor, stop, and resource-cap the Rust process. One concurrent job by
  default.
- [server/ai/export-game-rules.js](server/ai/export-game-rules.js) — dump a
  `game_type_id` to a JSON file the Rust binary can consume. Includes the
  full game-type row plus every piece + every starting position.
- [server/ai/adaptive-bridge.js](server/ai/adaptive-bridge.js) — *(future)*
  request a single move from a trained model for a live game.
- New admin endpoints under `/api/admin/ai-training/*`.

### Rust side ([ai-engine-rs/](ai-engine-rs/))
- `protocol.rs` — JSON shapes for rules, board state, moves, and progress
  events.
- `rules.rs` — loader that ingests the dumped game-type JSON.
- `board.rs` — compact board state + clone/apply/undo.
- `moves.rs` — port of `getPossibleMovesForPiece` from
  [server/game-socket.js](server/game-socket.js). Day-1 covers everything
  needed for chess (id 38): directional, ratio, capture-only directions,
  hopping, castling, en passant, promotion, mate-condition. Other rule
  flags compile but log `unsupported_rule` warnings.
- `mcts.rs` — UCT search with random rollouts.
- `selfplay.rs` — self-play loop + checkpoint writer + ndjson progress log
  read by the admin UI.
- `main.rs` — `train` and `play` subcommands.

### Storage
```
ai-training/                     (gitignored)
└── 38/                          (game_type_id)
    ├── rules.json               (DB dump)
    ├── jobs/
    │   └── <job_id>/
    │       ├── log.ndjson       (one line per game/iteration)
    │       └── model-<n>.bin    (checkpoint every N games)
    └── current-model.bin        (symlink/copy of best model)
```

## Resource limits (server-friendly)

| Resource | Cap | How |
|--|--|--|
| RAM | **1 GB** | `--max-rss-mb=1024` arg consumed by Rust; process self-aborts if exceeded |
| CPU | **1 core** | Rust uses single-threaded `rayon` config + Node spawns with `priority: BELOW_NORMAL` (Windows) / `nice -n 19` (Unix) |
| Concurrent jobs | **1** | `training-manager.js` enforces |
| Per-rollout time | hard cap so a runaway position cannot stall a game |
| Disk | checkpoints every 100 games; old checkpoints auto-pruned to keep ≤10 per job |

These are conservative on purpose. Training will be slow (hours-to-days for
a meaningful chess model on a 1-core budget), which is exactly the
trade-off requested: **slow but safe** beats **fast but crashes prod**.

## Difficulty name

**"Adaptive"** — implies it has *learned* without sounding like marketing
fluff. Existing tiers (`easy` / `medium` / `hard`) are untouched. Adaptive
will only appear in the difficulty picker when a trained model exists for
that game type (gated by an existence check on `ai_models`).

## Phased delivery

| Phase | Scope | Status |
|--|--|--|
| **1 (this PR)** | Plan, Rust crate scaffold with MCTS self-play, DB rules export, training-manager, admin endpoints + UI, install scripts, migrations | ✅ in progress |
| 2 | Policy/value neural net (`burn` crate); Adaptive difficulty wired into live games | pending |
| 3 | ELO gating, model promotion, multi-game-type training queue, GPU support flag | pending |
| 4 | Distillation / faster inference for the in-game move endpoint | pending |

## Open questions (not blocking phase 1)

- Whether to store models in DB (BLOB) or filesystem long-term. Currently
  filesystem; DB row in `ai_models` only stores metadata + path.
- Whether training jobs survive a server restart (currently they do not —
  killed jobs are marked `interrupted`).
- GPU support is deliberately out of scope; CPU-only keeps deployment
  simple and matches the resource philosophy.
