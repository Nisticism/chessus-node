/**
 * Opening-book consumer for the adaptive bot.
 *
 * Loads `book.json` files produced by the Rust trainer (one per training
 * job's output dir, but we only consult the most recent across all jobs
 * for a given game type).
 *
 * Position signature and move serialization MUST match the Rust side
 * (see ai-engine-rs/src/book.rs). Both sides use REAL piece IDs (the
 * user-visible pieces.id, never the per-placement virtual ids).
 *
 * Format: see ai-engine-rs/src/book.rs `BookDoc`.
 */
const fs = require('fs');
const path = require('path');

// Cache: gameTypeId -> { mtime, book, sourcePath }
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

/**
 * Discover the newest book.json for a game type by scanning training-job
 * output directories. Mirrors `getModelMetaForGameType` traversal.
 *
 * Returns the path, or null if no book exists.
 */
function findLatestBookPath(gameTypeId) {
  // training-manager exposes the same dir-resolver used at training time.
  // We resolve lazily to avoid a circular require at module load.
  let trainingDirFor;
  try {
    ({ trainingDirFor } = require('./export-game-rules'));
  } catch (_) {
    return null;
  }
  const baseDir = trainingDirFor(gameTypeId);
  const jobsRoot = path.join(baseDir, 'jobs');
  if (!fs.existsSync(jobsRoot)) return null;
  let newest = null;
  let newestMtime = 0;
  for (const entry of fs.readdirSync(jobsRoot)) {
    const candidate = path.join(jobsRoot, entry, 'book.json');
    if (!fs.existsSync(candidate)) continue;
    try {
      const st = fs.statSync(candidate);
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs;
        newest = candidate;
      }
    } catch (_) { /* skip */ }
  }
  return newest;
}

/**
 * Load + cache the book for a game type. Returns null if no book exists.
 * Cache invalidates on mtime change or every CACHE_TTL_MS.
 */
function loadBook(gameTypeId) {
  const now = Date.now();
  const cached = _cache.get(gameTypeId);
  if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
    return cached.book;
  }
  const bookPath = findLatestBookPath(gameTypeId);
  if (!bookPath) {
    _cache.set(gameTypeId, { loadedAt: now, book: null, sourcePath: null });
    return null;
  }
  // If the cached entry already points at the same path AND mtime
  // hasn't changed, refresh just the timestamp.
  let st;
  try { st = fs.statSync(bookPath); } catch { return null; }
  if (cached && cached.sourcePath === bookPath && cached.mtime === st.mtimeMs) {
    cached.loadedAt = now;
    return cached.book;
  }
  let book = null;
  try {
    book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  } catch (e) {
    console.warn(`[opening-book] failed to load ${bookPath}: ${e.message}`);
  }
  _cache.set(gameTypeId, { loadedAt: now, mtime: st.mtimeMs, sourcePath: bookPath, book });
  return book;
}

/**
 * Compute the position signature for a live gameState.
 * MUST match `position_signature` in ai-engine-rs/src/book.rs.
 *
 * Format: `<W>x<H>|t<turn>|<player>:<real_pid>:<x>,<y>;...` (sorted asc).
 *
 * gameState shape: standard live-game state where each piece has
 * `{ piece_id, owner_player, x, y }` (owner_player is 1/2). The bot's
 * caller is responsible for passing the side-to-move as `turn`.
 */
function positionSignature(gameState, turn) {
  const w = gameState.gameType?.board_width || gameState.board_width;
  const h = gameState.gameType?.board_height || gameState.board_height;
  const parts = [];
  const pieces = gameState.pieces || [];
  for (const p of pieces) {
    if (p == null) continue;
    // Live game uses real piece IDs throughout.
    const realPid = p.piece_id;
    // Live game uses `team` (1/2) for ownership; older paths use player_id.
    const player = p.team ?? p.player_id ?? p.owner_player ?? p.player_number;
    parts.push(`${player}:${realPid}:${p.x},${p.y}`);
  }
  parts.sort();
  return `${w}x${h}|t${turn}|${parts.join(';')}`;
}

/**
 * Serialize a candidate move into the same string form the Rust trainer
 * uses. MUST match `move_string` in ai-engine-rs/src/book.rs.
 *
 * Live-game move shape: `{ from: {x,y}, to: {x,y, isCastling?}, ... }`.
 * Promotions in the live game are auto-applied separately (no
 * promote_to on the move object), so we don't append `=N` here. The
 * Rust trainer also rarely produces promotion moves inside the
 * BOOK_PLY_LIMIT (=20) window, so the formats stay aligned in practice.
 *
 * Format: `<fx>,<fy>-><tx>,<ty>[C]`
 */
function moveString(move) {
  const fromX = move.from?.x ?? move.from_x;
  const fromY = move.from?.y ?? move.from_y;
  const toX = move.to?.x ?? move.to_x;
  const toY = move.to?.y ?? move.to_y;
  let s = `${fromX},${fromY}->${toX},${toY}`;
  const isCastling = move.isCastling || move.to?.isCastling;
  if (isCastling) {
    s += 'C';
  }
  return s;
}

/**
 * Look up the best book move for the current position.
 *
 * Strategy: pick the move with the highest Wilson lower bound on win
 * rate (W / (W+L), draws ignored), provided at least 2 games covered
 * that move. Returns null if not in book or insufficient sample size.
 *
 * Returns: `{ moveString, w, l, d, total }` or null.
 */
function lookupBookMove(gameTypeId, gameState, turn, opts = {}) {
  const book = loadBook(gameTypeId);
  if (!book || !book.positions) return null;
  const sig = positionSignature(gameState, turn);
  const stats = book.positions[sig];
  if (!stats || !stats.moves || stats.moves.length === 0) return null;
  const minSamples = opts.minSamples ?? 2;
  let best = null;
  let bestScore = -Infinity;
  for (const m of stats.moves) {
    const decisive = m.w + m.l;
    if (decisive < minSamples) continue;
    // Wilson lower bound at 95%.
    const z = 1.96;
    const n = decisive;
    const p = m.w / n;
    const denom = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    const score = (center - margin) / denom;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (!best) return null;
  return {
    moveString: best.mv,
    w: best.w,
    l: best.l,
    d: best.d,
    total: stats.total,
    winRate: best.w / Math.max(1, best.w + best.l),
  };
}

/**
 * Find which candidate legal move corresponds to the book's chosen move
 * string. Returns the matching move from `legalMoves` or null.
 */
function matchBookMove(legalMoves, bookMoveStr) {
  for (const mv of legalMoves) {
    if (moveString(mv) === bookMoveStr) return mv;
  }
  return null;
}

module.exports = {
  loadBook,
  lookupBookMove,
  matchBookMove,
  moveString,
  positionSignature,
  // Test/debug
  _findLatestBookPath: findLatestBookPath,
  _clearCache: () => _cache.clear(),
};
