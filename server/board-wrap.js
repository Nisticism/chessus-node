/*
 * WRAPPING BOARDS: edges that join. With columns wrapping the board is a
 * cylinder - a piece leaving the right edge comes back in at the left, as
 * Betza's o; with rows wrapping, top and bottom join; with both, a torus.
 *
 * Two settings, each 'off' | 'columns' | 'rows' | 'both':
 *   game_types.board_wrap   the whole board: every piece's moves wrap
 *   pieces.piece_wrap       this piece's moves wrap, on any board
 * A piece wraps along an axis when either says so.
 *
 * How the engines do it, without a second copy of any move rule: a piece
 * that wraps is asked about on a VIRTUAL board three boards wide (and/or
 * tall), the real board in the middle and a copy of every piece and every
 * special square on each side (wrapBoard, wrapGameType). Every path on that
 * board is a path on the cylinder, so the ordinary move code, run there,
 * answers for the cylinder; squares map back by wrapping (wrapBoard.real).
 * The virtual board itself never wraps (_wrapVirtual), so nothing recurses.
 *
 * What does not wrap: ranged attacks (only ones that stay on the middle board
 * are kept), and a large piece may not end straddling an edge. The piece
 * itself has no copies: its starting square is empty once it moves, so a
 * slide all the way round passes over it (as far as the virtual board goes,
 * which is more than a full lap).
 *
 * Mirrored by chessus-frontend/src/helpers/boardWrap.js - the same code with
 * `export`s; scripts/sync-shared-rules.js writes it and
 * scripts/e2e/move-paths-test.js checks they are identical.
 */

const WRAPS = ['off', 'columns', 'rows', 'both'];
const wrapValue = (v) => (WRAPS.includes(v) ? v : 'off');
const wrapsAxis = (v, axis) => v === 'both' || v === axis;

/** Which axes a piece's moves wrap on: { x, y }. */
function boardWrap(piece, gameType) {
  if (!gameType || gameType._wrapVirtual) return { x: false, y: false };
  const g = wrapValue(gameType.board_wrap);
  const p = wrapValue(piece && piece.piece_wrap);
  return { x: wrapsAxis(g, 'columns') || wrapsAxis(p, 'columns'), y: wrapsAxis(g, 'rows') || wrapsAxis(p, 'rows') };
}
const pieceWraps = (piece, gameType) => { const w = boardWrap(piece, gameType); return w.x || w.y; };

const parseMaybe = (v) => {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
};

/** A map of "y,x" squares, copied onto every board of the virtual one. */
function replicateSquares(map, W, H, nx, ny) {
  if (!map || typeof map !== 'object') return map;
  const out = {};
  for (const [key, cfg] of Object.entries(map)) {
    const [y, x] = key.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { out[key] = cfg; continue; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[`${y + j * H},${x + i * W}`] = cfg;
  }
  return out;
}

/*
 * The virtual board for a piece on a W x H board that wraps as `wrap`:
 *   mover       the piece, on the middle board
 *   pieces      every other piece on every board (the middle ones keep
 *               their ids), and the mover once
 *   width, height, ox, oy (where the middle board starts)
 *   real(x, y)  a virtual square, wrapped back onto the real board
 *   copies(x, y) every virtual square of a real one
 *   inMiddle(x, y) on the middle (real) board
 */
function wrapBoard(piece, pieces, W, H, wrap) {
  const nx = wrap.x ? 3 : 1;
  const ny = wrap.y ? 3 : 1;
  const ox = wrap.x ? W : 0;
  const oy = wrap.y ? H : 0;
  const out = [];
  let mover = null;
  for (const p of pieces) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const middle = i * W === ox && j * H === oy;
        if (!middle && p.id === piece.id) continue;   // the mover leaves its square
        const copy = { ...p, x: p.x + i * W, y: p.y + j * H };
        if (!middle) copy.id = `${p.id}@wrap${i}${j}`;
        out.push(copy);
        if (middle && p.id === piece.id) mover = copy;
      }
    }
  }
  if (!mover) mover = { ...piece, x: piece.x + ox, y: piece.y + oy };
  const mod = (v, n) => ((v % n) + n) % n;
  return {
    nx, ny, ox, oy, width: W * nx, height: H * ny, mover, pieces: out,
    real: (x, y) => ({ x: wrap.x ? mod(x, W) : x, y: wrap.y ? mod(y, H) : y }),
    copies: (x, y) => {
      const list = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) list.push([x + i * W, y + j * H]);
      return list;
    },
    inMiddle: (x, y) => x >= ox && x < ox + W && y >= oy && y < oy + H,
  };
}

/* The game type of the virtual board: bigger, special squares copied, never wrapping. */
const typeCache = new WeakMap();
function wrapGameType(gameType, nx, ny) {
  const key = `${nx}x${ny}`;
  let byKey = typeCache.get(gameType);
  if (byKey && byKey[key]) return byKey[key];
  const W = gameType.board_width || 8;
  const H = gameType.board_height || 8;
  const t = { ...gameType, board_width: W * nx, board_height: H * ny, _wrapVirtual: true };
  for (const f of ['special_squares_string', 'range_squares_string']) {
    const m = parseMaybe(gameType[f]);
    if (m && typeof m === 'object') t[f] = JSON.stringify(replicateSquares(m, W, H, nx, ny));
  }
  if (!byKey) { byKey = {}; typeCache.set(gameType, byKey); }
  byKey[key] = t;
  return t;
}

/* The frontend's parsed squares ({ range, promotion, control, special }), copied the same way. */
function wrapSpecialSquares(specialSquares, W, H, nx, ny) {
  if (!specialSquares) return specialSquares;
  const out = {};
  for (const [k, map] of Object.entries(specialSquares)) out[k] = replicateSquares(map, W, H, nx, ny);
  return out;
}

const WRAP_WORDS = {
  columns: 'the left and right edges join (a cylinder)',
  rows: 'the top and bottom edges join',
  both: 'all four edges join (a torus)',
};
/** In words, or '' for none. */
const wrapWords = (v) => WRAP_WORDS[wrapValue(v)] || '';

module.exports = {
  WRAPS,
  wrapValue,
  boardWrap,
  pieceWraps,
  replicateSquares,
  wrapBoard,
  wrapGameType,
  wrapSpecialSquares,
  wrapWords,
};
