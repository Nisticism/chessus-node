/* eslint-disable no-restricted-globals */
/**
 * Fairy-Stockfish Web Worker
 *
 * Wraps the `fairy-stockfish-nnue.wasm` npm package so the engine runs off
 * the React main thread. Messages from the main thread:
 *
 *   { type: 'init',      variantIni, variantName, skillLevel?, hash?, threads? }
 *   { type: 'bestmove',  fen, moveHistoryUci, movetime?, depth?, skillLevel?,
 *                        threads?, hash?, gameKey?,
 *                        wtime?, btime?, winc?, binc?, movestogo?, side? }
 *   { type: 'terminate' }
 *
 * Messages emitted back:
 *
 *   { type: 'ready' }                                  once engine reports uciok+readyok
 *   { type: 'bestmove',  move: string }                a UCI move (e.g. "e2e4")
 *   { type: 'info',      depth?, seldepth?, score?, nps?, pv? }
 *   { type: 'error',     message: string }
 *
 * Performance notes:
 *  - `ucinewgame` clears the transposition table, so we send it ONLY when we
 *    detect a new game (via `gameKey` from the main thread). Sending it per
 *    move costs significant elo.
 *  - NNUE is auto-loaded by fairy-stockfish-nnue.wasm; we ensure `Use NNUE`
 *    stays enabled (chess gets the NN; unsupported variants fall back to
 *    classical eval automatically).
 */

let enginePromise = null;
let engine = null;
let currentResolve = null;
let currentGameKey = null;

async function loadEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    // The `fairy-stockfish-nnue.wasm` package ships a classic Emscripten glue
    // script with no ES module entry. We serve it as a static asset (copied
    // into public/fairy-stockfish/ by scripts/copy-fairy-stockfish.js) and
    // pull it in via importScripts so the worker can use it directly. We must
    // tell Emscripten where stockfish.wasm lives via `locateFile` -- otherwise
    // it tries to resolve it relative to this bundled worker URL and 404s.
    const base = (self.location && self.location.origin
      ? self.location.origin
      : '') + '/fairy-stockfish/';
    let Stockfish;
    try {
      // eslint-disable-next-line no-undef
      importScripts(base + 'stockfish.js');
      // The script sets `self.Stockfish` (UMD fallback in non-CJS contexts).
      Stockfish = self.Stockfish;
      if (typeof Stockfish !== 'function') {
        throw new Error('Stockfish factory not found on self after importScripts');
      }
    } catch (err) {
      throw new Error(`Failed to load fairy-stockfish-nnue.wasm: ${err.message}`);
    }
    const sf = await Stockfish({
      // The fairy-stockfish-nnue.wasm build imports memory with shared=1, so
      // a non-shared WebAssembly.Memory triggers a LinkError. SharedArrayBuffer
      // requires the page to be cross-origin isolated (COOP same-origin +
      // COEP credentialless/require-corp). Those headers are added in dev by
      // chessus-frontend/src/setupProxy.js and must be added in prod by the
      // reverse proxy serving the React build.
      locateFile: (p) => base + p,
      // Required when the Emscripten module is loaded from inside another
      // worker (we importScripts stockfish.js from fairyStockfishWorker.js).
      // Without this, the pthread helper has no way to figure out the URL of
      // the main script to importScripts into its nested workers and ends up
      // calling `URL.createObjectURL(undefined)` -> "Overload resolution
      // failed". Pointing it at the script's URL lets pthreads spawn cleanly.
      mainScriptUrlOrBlob: base + 'stockfish.js',
      print: () => {},
      printErr: () => {},
    });
    sf.addMessageListener((line) => handleEngineLine(line));
    sf.postMessage('uci');
    await waitForLine((line) => line === 'uciok');
    sf.postMessage('isready');
    await waitForLine((line) => line === 'readyok');
    return sf;
  })();
  return enginePromise;
}

const lineWaiters = [];
function waitForLine(predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const idx = lineWaiters.indexOf(entry);
      if (idx >= 0) lineWaiters.splice(idx, 1);
      reject(new Error('Engine wait timed out'));
    }, timeoutMs);
    const entry = { predicate, resolve: (line) => { clearTimeout(t); resolve(line); } };
    lineWaiters.push(entry);
  });
}

// Parse `info depth N seldepth M ... score cp X ... nps Y pv ...`
function parseInfoLine(line) {
  const out = {};
  const tokens = line.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth')         { out.depth    = parseInt(tokens[++i], 10); }
    else if (t === 'seldepth') { out.seldepth = parseInt(tokens[++i], 10); }
    else if (t === 'nps')      { out.nps      = parseInt(tokens[++i], 10); }
    else if (t === 'time')     { out.time     = parseInt(tokens[++i], 10); }
    else if (t === 'nodes')    { out.nodes    = parseInt(tokens[++i], 10); }
    else if (t === 'score') {
      const kind = tokens[++i]; // cp | mate
      const val  = parseInt(tokens[++i], 10);
      out.score = { kind, value: val };
    }
    else if (t === 'pv') { out.pv = tokens.slice(i + 1).join(' '); break; }
  }
  return out;
}

function handleEngineLine(line) {
  if (typeof line !== 'string') return;
  if (line.startsWith('info ') && /\bdepth \d+\b/.test(line)) {
    try {
      const parsed = parseInfoLine(line);
      self.postMessage({ type: 'info', ...parsed });
    } catch (_) {}
  }

  for (let i = lineWaiters.length - 1; i >= 0; i--) {
    try {
      if (lineWaiters[i].predicate(line)) {
        const w = lineWaiters[i];
        lineWaiters.splice(i, 1);
        w.resolve(line);
      }
    } catch (_) { /* swallow */ }
  }

  if (line.startsWith('bestmove ') && currentResolve) {
    const parts = line.split(/\s+/);
    const move = parts[1];
    const resolver = currentResolve;
    currentResolve = null;
    resolver(move);
  }
}

let currentSkillLevel = null;
let currentHash = null;
let currentThreads = null;

async function handleInit({ variantIni, variantName, skillLevel, hash, threads }) {
  try {
    const sf = await loadEngine();
    engine = sf;

    const wantHash = Math.max(8, Math.min(512, Math.floor(hash != null ? hash : 128)));
    if (wantHash !== currentHash) {
      sf.postMessage(`setoption name Hash value ${wantHash}`);
      currentHash = wantHash;
    }
    const wantThreads = Math.max(1, Math.min(8, Math.floor(threads != null ? threads : 1)));
    if (wantThreads !== currentThreads) {
      sf.postMessage(`setoption name Threads value ${wantThreads}`);
      currentThreads = wantThreads;
    }
    sf.postMessage('setoption name Use NNUE value true');
    sf.postMessage('setoption name UCI_LimitStrength value false');
    sf.postMessage('setoption name Move Overhead value 50');

    if (skillLevel != null) {
      currentSkillLevel = Math.max(0, Math.min(20, Math.floor(skillLevel)));
      sf.postMessage(`setoption name Skill Level value ${currentSkillLevel}`);
    }

    if (variantIni) {
      try {
        if (sf.FS && typeof sf.FS.writeFile === 'function') {
          sf.FS.writeFile('/variants.ini', variantIni);
          sf.postMessage('load /variants.ini');
        } else {
          sf.postMessage(`setoption name VariantPath value ${variantIni}`);
        }
      } catch (_) { /* best-effort */ }
    }
    if (variantName) {
      sf.postMessage(`setoption name UCI_Variant value ${variantName}`);
    }
    sf.postMessage('ucinewgame');
    currentGameKey = null;
    sf.postMessage('isready');
    await waitForLine((l) => l === 'readyok');
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
}

async function handleBestmove(msg) {
  const {
    fen, moveHistoryUci, movetime, depth, skillLevel, threads, hash, gameKey,
    wtime, btime, winc, binc, movestogo, side,
  } = msg;
  try {
    if (!engine) await handleInit({});
    if (!engine) throw new Error('Engine not initialised');

    if (skillLevel != null && skillLevel !== currentSkillLevel) {
      currentSkillLevel = Math.max(0, Math.min(20, Math.floor(skillLevel)));
      engine.postMessage(`setoption name Skill Level value ${currentSkillLevel}`);
    }
    if (threads != null) {
      const t = Math.max(1, Math.min(8, Math.floor(threads)));
      if (t !== currentThreads) {
        engine.postMessage(`setoption name Threads value ${t}`);
        currentThreads = t;
      }
    }
    if (hash != null) {
      const h = Math.max(8, Math.min(512, Math.floor(hash)));
      if (h !== currentHash) {
        engine.postMessage(`setoption name Hash value ${h}`);
        currentHash = h;
      }
    }

    // Only reset transposition table on a true new game; per-move
    // ucinewgame would wipe TT every move and cost significant elo.
    if (gameKey && gameKey !== currentGameKey) {
      engine.postMessage('ucinewgame');
      currentGameKey = gameKey;
    }

    const positionCmd = moveHistoryUci && moveHistoryUci.length > 0
      ? `position fen ${fen} moves ${moveHistoryUci}`
      : `position fen ${fen}`;
    engine.postMessage(positionCmd);

    const movePromise = new Promise((resolve) => { currentResolve = resolve; });

    // Build go command. Priority: explicit clock > depth > movetime.
    let goCmd;
    let safetyMs;
    if (wtime != null && btime != null) {
      const parts = [
        `wtime ${Math.max(0, Math.floor(wtime))}`,
        `btime ${Math.max(0, Math.floor(btime))}`,
      ];
      if (winc != null)    parts.push(`winc ${Math.max(0, Math.floor(winc))}`);
      if (binc != null)    parts.push(`binc ${Math.max(0, Math.floor(binc))}`);
      if (movestogo != null) parts.push(`movestogo ${Math.max(1, Math.floor(movestogo))}`);
      goCmd = `go ${parts.join(' ')}`;
      const myTime = side === 'b' ? btime : wtime;
      safetyMs = Math.min(180000, Math.max(2000, Math.floor(myTime * 0.6) + 5000));
      if (depth && depth > 0) goCmd += ` depth ${Math.max(1, Math.min(40, Math.floor(depth)))}`;
      if (movetime && movetime > 0) goCmd += ` movetime ${Math.max(50, Math.floor(movetime))}`;
    } else if (depth && depth > 0) {
      goCmd = `go depth ${Math.max(1, Math.min(40, Math.floor(depth)))}`;
      if (movetime && movetime > 0) goCmd += ` movetime ${Math.max(50, Math.floor(movetime))}`;
      safetyMs = movetime && movetime > 0 ? movetime + 15000 : 180000;
    } else {
      const mt = Math.max(50, Math.floor(movetime || 1000));
      goCmd = `go movetime ${mt}`;
      safetyMs = mt + 15000;
    }
    engine.postMessage(goCmd);
    const move = await Promise.race([
      movePromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('bestmove timeout')), safetyMs)),
    ]);
    self.postMessage({ type: 'bestmove', move });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') return handleInit(msg);
  if (msg.type === 'bestmove') return handleBestmove(msg);
  if (msg.type === 'terminate') {
    try { if (engine && engine.postMessage) engine.postMessage('quit'); } catch (_) {}
    self.close();
  }
});
