/*
 * Fairy-Stockfish, driven from Node.
 *
 * The engine ships as an Emscripten build for the browser, where it runs in a
 * web worker. It runs perfectly well under Node too, with two wrinkles that are
 * worth writing down because neither is obvious:
 *
 *   1. Node 20 has a global `fetch`, so the Emscripten glue decides it is in a
 *      browser and tries to fetch the .wasm over HTTP - which fails with a bare
 *      "fetch failed". Handing it `wasmBinary` skips that decision entirely.
 *   2. The `print` option is not what carries engine output here. Output arrives
 *      through addMessageListener; passing `print` looks like it works and
 *      silently collects nothing, which reads exactly like an engine that found
 *      no mates.
 *
 * Used by scripts/simulate-pool-puzzles.js to find FORCED wins, which is the one
 * thing the site's own engine cannot do at a useful speed: it manages about 20
 * plies a second, so a mate-in-2 search would take half a minute per position.
 */
const path = require('path');
const fs = require('fs');

const ENGINE_DIR = path.join(
  __dirname, '..', '..', 'chessus-frontend', 'public', 'fairy-stockfish'
);

/**
 * Start an engine and return a small promise-shaped wrapper around it.
 *
 * @returns {Promise<{send:Function, search:Function, setVariant:Function, quit:Function}>}
 */
async function createEngine({ dir = ENGINE_DIR, hashMb = 64 } = {}) {
  const glue = path.join(dir, 'stockfish.js');
  const wasm = path.join(dir, 'stockfish.wasm');
  if (!fs.existsSync(glue) || !fs.existsSync(wasm)) {
    throw new Error(`Fairy-Stockfish not found in ${dir}. Run the frontend build once to copy it.`);
  }

  // The glue resolves side files relative to the process directory.
  const cwd = process.cwd();
  process.chdir(dir);
  let Stockfish;
  try {
    Stockfish = require(glue);
  } finally {
    process.chdir(cwd);
  }

  const engine = await Stockfish({
    wasmBinary: fs.readFileSync(wasm),
    locateFile: (f) => path.join(dir, f),
  });

  const listeners = new Set();
  engine.addMessageListener((line) => {
    for (const fn of listeners) fn(String(line));
  });

  const send = (cmd) => engine.postMessage(cmd);

  /** Resolve once a line satisfies `match`, or after `timeoutMs`. */
  const until = (match, timeoutMs) => new Promise((resolve) => {
    const seen = [];
    const done = (ok) => {
      listeners.delete(onLine);
      clearTimeout(timer);
      resolve({ ok, lines: seen });
    };
    const onLine = (line) => {
      seen.push(line);
      if (match(line)) done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    listeners.add(onLine);
  });

  send('uci');
  await until((l) => l.includes('uciok'), 10000);
  send(`setoption name Hash value ${hashMb}`);
  send('setoption name Threads value 1');

  /**
   * Load a custom variant definition, as produced by
   * server/ai/fairy-stockfish-translator.js.
   */
  const setVariant = async (iniText, variantName) => {
    if (iniText) {
      /*
       * The .ini goes into the ENGINE'S filesystem, not the host's.
       *
       * This is a WebAssembly build with its own virtual filesystem, so a host
       * path handed to VariantPath points at nothing it can see - the option is
       * accepted, the file is never read, and the engine quietly stays in 8x8
       * chess. Every position then gets interpreted with the wrong geometry,
       * which reads like a translator bug rather than a loading one.
       *
       * The frontend worker does exactly this; see
       * chessus-frontend/src/workers/fairyStockfishWorker.js.
       */
      if (engine.FS && typeof engine.FS.writeFile === 'function') {
        engine.FS.writeFile('/variants.ini', iniText);
        send('load /variants.ini');
      } else {
        const file = path.join(dir, `variant-${process.pid}.ini`);
        fs.writeFileSync(file, iniText);
        send(`setoption name VariantPath value ${file}`);
      }

      // The variant list is only rebuilt when the engine is re-interrogated.
      send('uci');
      const seen = await until((l) => l.includes('uciok'), 10000);
      if (!seen.lines.some((l) => l.includes(`var ${variantName}`))) {
        throw new Error(`engine did not register variant '${variantName}'`);
      }
    }
    send(`setoption name UCI_Variant value ${variantName || 'chess'}`);
    send('isready');
    await until((l) => l.includes('readyok'), 10000);
  };

  /**
   * Search one position.
   *
   * @returns {{mate: number|null, cp: number|null, best: string|null, pv: string[]}}
   *   `mate` is signed and in MOVES, from the side to move's point of view:
   *   2 means "I mate in two", -2 means "I am mated in two". That sign is the
   *   whole point - an unsigned mate score would turn a loss into a puzzle.
   */
  const search = async ({ fen, depth = 14, movetime = null, timeoutMs = 15000 }) => {
    send(`position fen ${fen}`);
    send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    const { lines } = await until((l) => l.startsWith('bestmove'), timeoutMs);

    let mate = null;
    let cp = null;
    let pv = [];
    // The LAST score line is the deepest one, which is the one to trust.
    for (const line of lines) {
      if (!line.startsWith('info ') || !line.includes(' score ')) continue;
      const m = line.match(/score mate (-?\d+)/);
      const c = line.match(/score cp (-?\d+)/);
      const p = line.match(/ pv (.+)$/);
      if (m) { mate = Number(m[1]); cp = null; } else if (c) { cp = Number(c[1]); mate = null; }
      if (p) pv = p[1].trim().split(/\s+/);
    }
    const bestLine = lines.filter((l) => l.startsWith('bestmove')).pop() || '';
    const best = (bestLine.split(/\s+/)[1] || null);
    return { mate, cp, best: best === '(none)' ? null : best, pv, lines };
  };

  /*
   * Does NOT send the engine a `quit` command.
   *
   * This is an Emscripten build, and its `quit` runs the module's exit path -
   * which calls process.exit(). Any work still to do after shutting the engine
   * down simply never happens, with a clean exit code and no error: a run that
   * found twenty puzzles logged all twenty and wrote none of them.
   *
   * Dropping the listeners is enough. The module is garbage once nothing holds
   * it, and the process exits on its own when the real work is finished.
   */
  const quit = () => {
    listeners.clear();
    const file = path.join(dir, `variant-${process.pid}.ini`);
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) { /* best effort */ }
  };

  return { send, search, setVariant, quit, engine };
}

module.exports = { createEngine, ENGINE_DIR };
