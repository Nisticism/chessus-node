/*
 * Where a multi-tile piece is going, from a click, a tap or a drop.
 *
 * A multi-tile piece moves by displacing its whole footprint, and a move is
 * named by where its anchor (top-left square) lands. Three things make that
 * awkward to pick with a pointer:
 *
 * - A one-square move right or down lands the anchor on a square the piece
 *   already covers, and clicking that square selects the piece instead.
 * - The board highlights every square a destination would cover, so one
 *   highlighted square usually belongs to several moves. Taking the first in
 *   the list meant a click just right of a 2x2 piece moved it up-right.
 * - The piece's image is one element sitting in its anchor square, so any
 *   click or drop over it reports that anchor square, not the square under
 *   the pointer.
 *
 * So a move is chosen by a square the piece should COVER:
 * - a drag means "put the square I grabbed here" when that is a legal move,
 *   and otherwise whichever other square of the piece can land there, the
 *   one nearest the grabbed square first (moveForDrop);
 * - a click has no grabbed square, so it means the shortest move covering
 *   the clicked square (moveCoveringSquare).
 * Both read the square from the pointer, not from the element under it.
 */

import { findPieceAtSquare } from './pieceMovementUtils';

const sizeOf = (piece) => ({ w: piece?.piece_width || 1, h: piece?.piece_height || 1 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const isMultiTile = (piece) => {
  const { w, h } = sizeOf(piece);
  return w > 1 || h > 1;
};

// Lexicographic comparison of rank arrays.
const lessThan = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};

/**
 * Every move of a multi-tile piece whose landing footprint covers (x, y),
 * best first. `grab` (an offset from the anchor) makes the grabbed square
 * landing there the best, then the piece's other squares by distance from
 * it; after that the shortest move, straight before diagonal, and a plain
 * move before castling. Ranged attacks are left out - the piece does not
 * move for those. Empty for a single-square piece.
 */
export const movesCoveringSquare = (moves, piece, x, y, grab = null) => {
  if (!isMultiTile(piece)) return [];
  const { w, h } = sizeOf(piece);
  const ranked = [];
  for (const m of moves || []) {
    if (m.isRangedAttack) continue;
    if (x < m.x || x >= m.x + w || y < m.y || y >= m.y + h) continue;
    // The square of the piece that would land on (x, y), as an anchor offset.
    const cellX = x - m.x;
    const cellY = y - m.y;
    const fromGrab = grab
      ? [Math.max(Math.abs(cellX - grab.x), Math.abs(cellY - grab.y)), Math.abs(cellX - grab.x) + Math.abs(cellY - grab.y)]
      : [0, 0];
    const dx = Math.abs(m.x - piece.x);
    const dy = Math.abs(m.y - piece.y);
    ranked.push({ m, rank: [...fromGrab, Math.max(dx, dy), dx + dy, m.isCastling ? 1 : 0] });
  }
  ranked.sort((a, b) => (lessThan(a.rank, b.rank) ? -1 : lessThan(b.rank, a.rank) ? 1 : 0));
  return ranked.map((r) => r.m);
};

/** The best move covering (x, y) for a click - see movesCoveringSquare. */
export const moveCoveringSquare = (moves, piece, x, y) =>
  movesCoveringSquare(moves, piece, x, y)[0] || null;

/**
 * The move a drag means: `piece` was grabbed by square `grab` (an offset from
 * its anchor) and dropped on (x, y). The grabbed square lands there if that is
 * legal; otherwise another of its squares does, nearest the grabbed one first.
 * Null when no move covers (x, y), and for a single-square piece.
 */
export const moveForDrop = (moves, piece, grab, x, y) =>
  movesCoveringSquare(moves, piece, x, y, grab || { x: 0, y: 0 })[0] || null;

/**
 * Which of a piece's squares the pointer grabbed it by, as an offset from its
 * anchor in game coordinates. `rect` is the piece element's bounding box. A
 * flipped board turns the piece half a turn - its anchor is drawn bottom-right
 * - so the visual column and row count from the other side.
 */
export const grabbedCell = (piece, rect, clientX, clientY, flipped) => {
  const { w, h } = sizeOf(piece);
  if (!rect || (w === 1 && h === 1)) return { x: 0, y: 0 };
  const col = clamp(Math.floor((clientX - rect.left) / (rect.width / w)), 0, w - 1);
  const row = clamp(Math.floor((clientY - rect.top) / (rect.height / h)), 0, h - 1);
  return flipped ? { x: w - 1 - col, y: h - 1 - row } : { x: col, y: row };
};

/**
 * The board square at a screen position, in game coordinates, or null off
 * the board. Measured inside the board's border, where the squares are.
 */
export const pointerSquare = (boardEl, clientX, clientY, boardWidth, boardHeight, flipped) => {
  if (!boardEl || clientX == null || clientY == null) return null;
  const rect = boardEl.getBoundingClientRect();
  const left = rect.left + (boardEl.clientLeft || 0);
  const top = rect.top + (boardEl.clientTop || 0);
  const width = boardEl.clientWidth || rect.width;
  const height = boardEl.clientHeight || rect.height;
  if (!width || !height) return null;
  const col = Math.floor((clientX - left) / (width / boardWidth));
  const row = Math.floor((clientY - top) / (height / boardHeight));
  if (col < 0 || row < 0 || col >= boardWidth || row >= boardHeight) return null;
  return flipped
    ? { x: boardWidth - 1 - col, y: boardHeight - 1 - row }
    : { x: col, y: row };
};

/**
 * The board square under a mouse event, or null when the event has no pointer
 * position (a keyboard activation, a scripted click) or is off the board.
 */
export const squareUnderPointer = (boardEl, event, boardWidth, boardHeight, flipped) => {
  if (!event || !(event.detail > 0 || event.type === 'drop' || event.type === 'dragover')) return null;
  return pointerSquare(boardEl, event.clientX, event.clientY, boardWidth, boardHeight, flipped);
};

/**
 * The piece a click lands on. A dropped piece's anchor (byAnchor) landing on
 * the dragged piece itself is a one-square move right or down, not a click on
 * that piece, so it lands on nothing.
 */
export const pieceClickedAt = (pieces, x, y, selectedPiece, byAnchor) => {
  const p = findPieceAtSquare(pieces, x, y);
  if (byAnchor && p && selectedPiece && p.id === selectedPiece.id) return null;
  return p;
};

/**
 * The outline a multi-tile landing is drawn with: where `move` would put
 * `piece`, or null for no move or a single-square piece. Returned as a plain
 * box so an unchanged landing compares equal (sameBox) and does not re-render.
 */
export const landingBox = (piece, move) => {
  if (!move || !isMultiTile(piece)) return null;
  const { w, h } = sizeOf(piece);
  return { x: move.x, y: move.y, w, h };
};
/** Does `piece` landing by `move` cover any square of `other`? */
export const landingCoversPiece = (piece, move, other) => {
  const { w, h } = sizeOf(piece);
  const o = sizeOf(other);
  return move.x < other.x + o.w && other.x < move.x + w && move.y < other.y + o.h && other.y < move.y + h;
};

export const sameBox = (a, b) => (a === b)
  || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
