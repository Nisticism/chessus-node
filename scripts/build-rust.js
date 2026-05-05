#!/usr/bin/env node
/**
 * Cross-platform Rust trainer build helper used by `npm run dev` (and
 * other scripts that need a fresh ai-engine-rs binary). Runs
 *   cargo build --release
 * inside the ai-engine-rs/ workspace and prints a compact summary.
 *
 * Exits 0 even if cargo isn't installed — we don't want to block backend
 * development just because the Rust toolchain is missing on this machine.
 * The Node side already prints a clear "Rust binary not built" error when
 * the trainer is invoked without a built binary.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const RS_DIR = path.join(__dirname, '..', 'ai-engine-rs');
const CARGO_TOML = path.join(RS_DIR, 'Cargo.toml');

if (!fs.existsSync(CARGO_TOML)) {
  console.log('[build-rust] No ai-engine-rs/Cargo.toml found — skipping Rust build.');
  process.exit(0);
}

console.log('[build-rust] cargo build --release  (in ai-engine-rs/)');
const isWin = process.platform === 'win32';
const cargoBin = isWin ? 'cargo.exe' : 'cargo';

const child = spawn(cargoBin, ['build', '--release'], {
  cwd: RS_DIR,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  if (err && err.code === 'ENOENT') {
    console.warn('[build-rust] cargo not found on PATH — skipping Rust build.');
    console.warn('[build-rust] Install Rust from https://rustup.rs/ to enable AI training.');
    process.exit(0);
  }
  console.error('[build-rust] Failed to spawn cargo:', err.message);
  process.exit(0); // non-fatal: don't block dev startup
});

child.on('exit', (code) => {
  if (code === 0) {
    console.log('[build-rust] OK');
    // Copy the compiled binary into trainer-binaries/<platform>/ so the
    // "Download Trainer Pack" endpoint can serve it without any manual step.
    try {
      const platform = isWin ? 'win32' : 'linux';
      const binName = isWin ? 'ai-engine.exe' : 'ai-engine';
      const src = path.join(RS_DIR, 'target', 'release', binName);
      const destDir = path.join(__dirname, '..', 'trainer-binaries', platform);
      const dest = path.join(destDir, binName);
      if (fs.existsSync(src)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
        console.log(`[build-rust] Binary copied to trainer-binaries/${platform}/${binName}`);
      }
    } catch (copyErr) {
      console.warn('[build-rust] Could not copy binary to trainer-binaries/:', copyErr.message);
    }
    process.exit(0);
  }
  console.warn(`[build-rust] cargo exited with code ${code} — continuing without rebuild.`);
  process.exit(0); // non-fatal
});
