#!/usr/bin/env bash
# Install Rust toolchain on Linux/macOS. Idempotent — safe to re-run.
#
# Usage:  ./scripts/install-rust.sh
#
# After this finishes, open a new shell (or `source ~/.cargo/env`) and run:
#   cd ai-engine-rs
#   cargo build --release
#
# The Rust binary is what server/ai/training-manager.js spawns to perform
# self-play training without touching the Node game server.

set -euo pipefail

if command -v cargo >/dev/null 2>&1; then
  echo "Rust is already installed:"
  cargo --version
  rustc --version
  exit 0
fi

echo "Installing Rust via rustup (stable, minimal profile)..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --default-toolchain stable --profile minimal

# shellcheck disable=SC1091
source "$HOME/.cargo/env" 2>/dev/null || true

echo
echo "Rust installed. Now build the AI engine:"
echo "  cd ai-engine-rs && cargo build --release"
