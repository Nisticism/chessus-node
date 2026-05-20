/* eslint-disable */
/**
 * Copy the Fairy-Stockfish engine files from node_modules to public/ so the
 * dev server and the production build both serve them at a known URL
 * (/fairy-stockfish/stockfish.js + stockfish.wasm).
 *
 * The npm package `fairy-stockfish-nnue.wasm` ships an Emscripten glue script
 * that uses `importScripts` / `locateFile` to find its companion .wasm. Loading
 * it through a webpack dynamic `import()` doesn't work because the package has
 * no `main`/`module`/`exports` field and webpack can't bundle the .wasm
 * sibling automatically. Serving the files as static assets and pulling them
 * in via `importScripts` from our worker is the reliable path.
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'node_modules', 'fairy-stockfish-nnue.wasm');
const dest = path.resolve(__dirname, '..', 'public', 'fairy-stockfish');

// stockfish.worker.js is the pthread companion script. We force single-thread
// mode at runtime (Threads=1 + non-shared wasmMemory) so it shouldn't ever be
// requested, but we copy it anyway so any internal `locateFile('stockfish.
// worker.js')` lookup resolves with a 200 instead of crashing on a 404.
const FILES = ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js'];

if (!fs.existsSync(src)) {
  console.error('[copy-fairy-stockfish] source not found:', src);
  process.exit(0); // don't fail the build if the package is missing
}

fs.mkdirSync(dest, { recursive: true });

let copied = 0;
for (const f of FILES) {
  const from = path.join(src, f);
  const to = path.join(dest, f);
  if (!fs.existsSync(from)) {
    console.warn('[copy-fairy-stockfish] missing source file:', from);
    continue;
  }
  fs.copyFileSync(from, to);
  copied++;
}
console.log(`[copy-fairy-stockfish] copied ${copied}/${FILES.length} engine file(s) to public/fairy-stockfish/`);
