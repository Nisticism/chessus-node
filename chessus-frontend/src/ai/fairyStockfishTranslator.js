/**
 * Client-side Fairy-Stockfish translator helpers.
 *
 * These mirror a subset of `server/ai/fairy-stockfish-translator.js` that
 * the browser needs:
 *
 *   - `buildFEN` to convert the live gameState into a FEN string for the
 *     `position fen ...` UCI command.
 *   - `buildMoveHistoryUci` to serialise the move history for the
 *     `... moves ...` portion of that command.
 *   - `uciMoveToGameMove` to parse `bestmove` output back into the
 *     { from:{x,y}, to:{x,y}, pieceId } shape the server's
 *     `submitFairyStockfishMove` socket event expects.
 *
 * The variant INI text and per-piece-type char map are produced by the
 * server (Phase 2) and delivered to the client via the
 * /api/fairy-stockfish/translation/:gameTypeId endpoint. The browser does
 * not need to know the gameplay rules in detail � only how to encode the
 * current position.
 */

function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function fileChar(x) { return String.fromCharCode(97 + x); }
function squareName(x, y, boardHeight) {
  const rank = (boardHeight != null) ? (boardHeight - y) : y;
  return `${fileChar(x)}${rank}`;
}

/**
 * @param {object[]} pieces        live gameState.pieces (each has id, x, y, team, piece_id)
 * @param {number}   boardWidth
 * @param {number}   boardHeight
 * @param {number}   currentTurn   1 or 2
 * @param {number}   movesWithoutCapture
 * @param {number}   totalHalfMoves
 * @param {object}   charMap       { byPieceId: { [pieceId]: 'X' } } from server
 * @returns {string|null} FEN
 */
export function buildFEN(pieces, boardWidth, boardHeight, currentTurn, movesWithoutCapture, totalHalfMoves, charMap) {
  if (!charMap || !charMap.byPieceId) return null;
  // chessus coords are 0-indexed. y=0 is the TOP of the screen (team 2's
  // home rank) which maps to the TOP FEN rank (= boardHeight); y=boardHeight-1
  // is the bottom (team 1's home) = FEN rank 1.
  // Build grid[rankIdx][fileIdx] with rankIdx 0 = top FEN rank.
  const grid = [];
  for (let r = 0; r < boardHeight; r++) {
    grid.push(new Array(boardWidth).fill(null));
  }
  for (const p of pieces || []) {
    const x = toInt(p.x), y = toInt(p.y);
    if (x < 0 || x >= boardWidth || y < 0 || y >= boardHeight) continue;
    const ch = charMap.byPieceId[p.piece_id] || charMap.byPieceId[p.real_piece_id];
    if (!ch) continue;
    // Live pieces use `player_id` (1 or 2); some code paths still set `team`.
    // Mirror the convention used everywhere in LiveGame: player_id wins.
    const rawTeam = toInt(p.player_id, toInt(p.team, 1));
    // Neutral pieces (is_neutral or player_id=0) get rendered as the
    // opposite of the side-to-move so the engine sees them as enemy
    // pieces it could capture, instead of trying to move them itself.
    const neutral = !!p.is_neutral || rawTeam === 0;
    const team = neutral
      ? (toInt(currentTurn, 1) === 1 ? 2 : 1)
      : rawTeam;
    grid[y][x] = team === 1 ? ch.toUpperCase() : ch.toLowerCase();
  }
  const ranks = [];
  for (let r = 0; r < boardHeight; r++) {
    let s = '';
    let blanks = 0;
    for (let f = 0; f < boardWidth; f++) {
      const c = grid[r][f];
      if (!c) blanks++;
      else { if (blanks > 0) { s += blanks; blanks = 0; } s += c; }
    }
    if (blanks > 0) s += blanks;
    ranks.push(s);
  }
  const turn = toInt(currentTurn, 1) === 2 ? 'b' : 'w';
  const half = toInt(movesWithoutCapture, 0);
  const full = Math.max(1, Math.floor(toInt(totalHalfMoves, 0) / 2) + 1);
  // Castling/ep left as defaults; the server can compute richer values via
  // its translator if/when we want pre-move accuracy.
  return `${ranks.join('/')} ${turn} KQkq - ${half} ${full}`;
}

export function moveToUci(move, boardHeight) {
  if (!move || !move.from || !move.to) return null;
  let s = squareName(toInt(move.from.x), toInt(move.from.y), boardHeight);
  s += squareName(toInt(move.to.x), toInt(move.to.y), boardHeight);
  if (move.promotedTo && typeof move.promotedTo === 'string') {
    s += move.promotedTo.toLowerCase().slice(0, 1);
  }
  return s;
}

export function buildMoveHistoryUci(moveHistory, boardHeight) {
  if (!Array.isArray(moveHistory)) return '';
  return moveHistory.map((m) => moveToUci(m, boardHeight)).filter(Boolean).join(' ');
}

/**
 * Convert a UCI bestmove string into the chessus-shaped move that
 * `submitFairyStockfishMove` expects. Returns { from, to, pieceId } or null.
 */
export function uciMoveToGameMove(uciMove, pieces, boardHeight) {
  if (!uciMove || typeof uciMove !== 'string') return null;
  if (uciMove === '(none)' || uciMove === '0000') return null;
  const re = /^([a-l])(\d{1,2})([a-l])(\d{1,2})([qrbnack-z])?$/;
  const m = re.exec(uciMove.trim().toLowerCase());
  if (!m) return null;
  const [, f1, r1, f2, r2, promo] = m;
  // FEN file 'a'..'l' -> chessus x 0..11; FEN rank R -> chessus y = boardHeight - R.
  const bh = (boardHeight != null) ? boardHeight : 8;
  const from = { x: f1.charCodeAt(0) - 97, y: bh - parseInt(r1, 10) };
  const to   = { x: f2.charCodeAt(0) - 97, y: bh - parseInt(r2, 10) };
  const piece = (pieces || []).find((p) => toInt(p.x) === from.x && toInt(p.y) === from.y);
  if (!piece) return null;
  const out = { pieceId: piece.id, from, to };
  if (promo) out.promotionChar = promo;
  return out;
}
