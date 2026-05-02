/**
 * Opening-book consumer for the adaptive bot.
 *
 * Loads `book.json` files produced by the Rust trainer AND merges them
 * across every training job for a given game type. That way, uploading
 * artifacts from a dev machine stacks with cloud-trained data instead
 * of replacing it.
 *
 * In REMOTE_MODE (trainer lives on a separate EC2 instance) the book
 * is fetched from the trainer-service HTTP endpoint, which does the
 * merge on its side because the book.json files live on that box.
 *
 * Position signature and move serialization MUST match the Rust side
 * (see ai-engine-rs/src/book.rs). Both sides use REAL piece IDs.
 */
const fs = require('fs');
const path = require('path');
const trainerClient = require('./trainer-client');

// Cache: gameTypeId -> { loadedAt, book, fingerprint }
// fingerprint = ';'-joined "path|mtime" for local, or a remote fingerprint.
const _cache = new Map();
const CACHE_TTL_MS = 60_000;

const BOOK_FORMAT = 'squarestrat-book-v1';
const BOOK_PLY_LIMIT = 20;

function _emptyBook() {
  return { format: BOOK_FORMAT, ply_limit: BOOK_PLY_LIMIT, positions: {} };
}

/**
 * Scan every training job dir for a game type and return all existing
 * book.json paths with their mtimes (newest first).
 */
function findAllBookPaths(gameTypeId) {
  let trainingDirFor;
  try {
    ({ trainingDirFor } = require('./export-game-rules'));
  } catch (_) {
    return [];
  }
  const baseDir = trainingDirFor(gameTypeId);
  const jobsRoot = path.join(baseDir, 'jobs');
  if (!fs.existsSync(jobsRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(jobsRoot)) {
    const candidate = path.join(jobsRoot, entry, 'book.json');
    if (!fs.existsSync(candidate)) continue;
    try {
      const st = fs.statSync(candidate);
      out.push({ path: candidate, mtime: st.mtimeMs });
    } catch (_) { /* skip */ }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Sum W/L/D counts per (position, move) across any number of BookDoc
 * objects. Pure function — safe to run on backend, trainer-service,
 * or dev machine. Merge is commutative and idempotent for distinct
 * jobs (we never double-count because the trainer writes each record
 * exactly once to its job's book.jsonl).
 */
function mergeBooks(books) {
  const merged = _emptyBook();
  for (const book of books) {
    if (!book || !book.positions) continue;
    for (const sig of Object.keys(book.positions)) {
      const stats = book.positions[sig];
      if (!stats || !Array.isArray(stats.moves)) continue;
      if (!merged.positions[sig]) {
        merged.positions[sig] = { moves: [], total: 0 };
      }
      const mergedPos = merged.positions[sig];
      const moveMap = new Map(mergedPos.moves.map((m) => [m.mv, m]));
      for (const m of stats.moves) {
        if (!m || typeof m.mv !== 'string') continue;
        const existing = moveMap.get(m.mv);
        if (existing) {
          existing.w += m.w || 0;
          existing.l += m.l || 0;
          existing.d += m.d || 0;
        } else {
          const copy = { mv: m.mv, w: m.w || 0, l: m.l || 0, d: m.d || 0 };
          mergedPos.moves.push(copy);
          moveMap.set(m.mv, copy);
        }
      }
      mergedPos.total = mergedPos.moves.reduce(
        (s, m) => s + (m.w || 0) + (m.l || 0) + (m.d || 0),
        0,
      );
    }
  }
  return merged;
}

/**
 * Load + merge every book.json for this game type from the local
 * filesystem. Used by the trainer-service (same box as the books) and
 * by the backend when not in REMOTE_MODE.
 */
function loadLocalMergedBook(gameTypeId) {
  const entries = findAllBookPaths(gameTypeId);
  if (entries.length === 0) return { book: null, fingerprint: '' };
  const books = [];
  const fpParts = [];
  for (const e of entries) {
    try {
      const raw = fs.readFileSync(e.path, 'utf8');
      books.push(JSON.parse(raw));
      fpParts.push(`${e.path}|${e.mtime}`);
    } catch (err) {
      console.warn(`[opening-book] failed to load ${e.path}: ${err.message}`);
    }
  }
  if (books.length === 0) return { book: null, fingerprint: '' };
  return { book: mergeBooks(books), fingerprint: fpParts.join(';') };
}

/**
 * Async loader the adaptive bot calls. In REMOTE_MODE this hits the
 * trainer-service (which merges on its side); otherwise it merges
 * from disk.
 */
async function loadBook(gameTypeId) {
  const now = Date.now();
  const cached = _cache.get(gameTypeId);
  if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
    return cached.book;
  }

  if (trainerClient.isEnabled()) {
    let payload;
    try {
      payload = await trainerClient.fetchBook(gameTypeId);
    } catch (e) {
      if (cached) {
        cached.loadedAt = now - (CACHE_TTL_MS - 5_000);
        return cached.book;
      }
      console.warn(`[opening-book] remote fetch failed: ${e.message}`);
      return null;
    }
    const book = payload && payload.book ? payload.book : null;
    const fingerprint = (payload && payload.fingerprint) || String(now);
    if (cached && cached.fingerprint === fingerprint) {
      cached.loadedAt = now;
      return cached.book;
    }
    _cache.set(gameTypeId, { loadedAt: now, book, fingerprint });
    return book;
  }

  const { book, fingerprint } = loadLocalMergedBook(gameTypeId);
  if (cached && cached.fingerprint === fingerprint) {
    cached.loadedAt = now;
    return cached.book;
  }
  _cache.set(gameTypeId, { loadedAt: now, book, fingerprint });
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
 * Look up the best book move for the current position against a
 * pre-loaded BookDoc (from loadBook). Wilson lower bound at 95%
 * with a 2-decisive-game floor.
 */
function lookupBookMove(book, gameState, turn, opts = {}) {
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

/**
 * Record a completed adaptive-bot game to the opening book.
 * Replays move history from the initial position to compute per-ply
 * position signatures, then writes a new book.json job file that is
 * automatically merged on the next `loadBook` call.
 *
 * @param {number|string} gameTypeId
 * @param {Object} gameState - live gameState at end of game
 * @param {number|string|null} winnerId - userId of winner, or null for draw
 */
async function recordGameToBook(gameTypeId, gameState, winnerId) {
  if (!gameTypeId) return;
  const moveHistory = gameState.moveHistory;
  const initialPieces = gameState.initialPieces;
  if (!Array.isArray(moveHistory) || moveHistory.length === 0) return;
  if (!Array.isArray(initialPieces) || initialPieces.length === 0) return;
  // Skip simul-turns games — the Rust engine does not model them.
  if (gameState.gameType?.simultaneous_turns) return;

  // Resolve winner's board position (1 or 2), or null for a draw.
  let winnerPosition = null;
  if (winnerId != null) {
    const wp = (gameState.players || []).find((p) => String(p.id) === String(winnerId));
    winnerPosition = wp?.position ?? null;
  }

  // Minimal replay state: start from the initial piece positions.
  const replayPieces = JSON.parse(JSON.stringify(initialPieces));
  const replayState = {
    pieces: replayPieces,
    gameType: gameState.gameType,
  };

  const newBook = _emptyBook();
  const limit = Math.min(moveHistory.length, BOOK_PLY_LIMIT);

  for (let i = 0; i < limit; i++) {
    const histMove = moveHistory[i];
    if (!histMove) continue;
    // Skip non-move records (cancelled, ranged_noop, place, etc.).
    const mvType = histMove.type;
    if (mvType && mvType !== 'move' && mvType !== 'ranged') continue;

    const moverPosition = histMove.position ?? (i % 2 === 0 ? 1 : 2);

    // Signature BEFORE applying the move.
    const sig = positionSignature(replayState, moverPosition);
    const mvStr = moveString(histMove);

    // Result from the mover's perspective.
    let resultCode;
    if (winnerPosition === null) {
      resultCode = 'D';
    } else if (winnerPosition === moverPosition) {
      resultCode = 'W';
    } else {
      resultCode = 'L';
    }

    if (!newBook.positions[sig]) {
      newBook.positions[sig] = { moves: [], total: 0 };
    }
    const pos = newBook.positions[sig];
    let mv = pos.moves.find((m) => m.mv === mvStr);
    if (!mv) {
      mv = { mv: mvStr, w: 0, l: 0, d: 0 };
      pos.moves.push(mv);
    }
    if (resultCode === 'W') mv.w++;
    else if (resultCode === 'L') mv.l++;
    else mv.d++;
    pos.total = pos.moves.reduce((s, m) => s + m.w + m.l + m.d, 0);

    // Advance replay state: move piece + remove captured piece(s).
    const piece = replayPieces.find((p) => String(p.id) === String(histMove.pieceId));
    if (piece && histMove.to) {
      piece.x = histMove.to.x ?? piece.x;
      piece.y = histMove.to.y ?? piece.y;
    }
    const captured = histMove.allCaptured ?? (histMove.captured ? [histMove.captured] : []);
    for (const cap of captured) {
      if (!cap || cap.id == null) continue;
      const idx = replayPieces.findIndex((p) => String(p.id) === String(cap.id));
      if (idx >= 0) replayPieces.splice(idx, 1);
    }
  }

  if (Object.keys(newBook.positions).length === 0) return;

  let trainingDirFor;
  try {
    ({ trainingDirFor } = require('./export-game-rules'));
  } catch (_) {
    return;
  }

  const jobDir = path.join(trainingDirFor(gameTypeId), 'jobs', `live-${Date.now()}`);
  try {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'book.json'), JSON.stringify(newBook), 'utf8');
    _cache.delete(gameTypeId);
    console.log(`[book] Recorded game to ${jobDir} (${Object.keys(newBook.positions).length} positions)`);
  } catch (e) {
    console.warn('[book] Failed to write live game book:', e.message);
  }
}

module.exports = {
  loadBook,
  lookupBookMove,
  matchBookMove,
  moveString,
  positionSignature,
  mergeBooks,
  loadLocalMergedBook,
  findAllBookPaths,
  recordGameToBook,
  BOOK_FORMAT,
  BOOK_PLY_LIMIT,
  _clearCache: () => _cache.clear(),
};
