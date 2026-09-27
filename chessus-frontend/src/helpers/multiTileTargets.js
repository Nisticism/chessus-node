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
 * So a click names a square the piece should cover and means the shortest
 * move that covers it; a drag carries the square the piece was grabbed by,
 * which pins the anchor exactly; and both read the square from the pointer.
 */

import { findPieceAtSquare } from './pieceMovementUtils';

const sizeOf = (piece) => ({ w: piece?.piece_width || 1, h: piece?.piece_height || 1 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const isMultiTile = (piece) => {
  const { w, h } = sizeOf(piece);
  return w > 1 || h > 1;
};

/**
 * The shortest of a multi-tile piece's moves whose landing footprint covers
 * (x, y): nearest first, then straight before diagonal, then a plain move
 * before castling. Null for a single-square piece, which is matched by its
 * destination square exactly as before.
 */
export const moveCoveringSquare = (moves, piece, x, y) => {
  if (!isMultiTile(piece)) return null;
  const { w, h } = sizeOf(piece);
  let best = null;
  let bestRank = null;
  for (const m of moves || []) {
    if (m.isRangedAttack) continue;
    if (x < m.x || x >= m.x + w || y < m.y || y >= m.y + h) continue;
    const dx = Math.abs(m.x - piece.x);
    const dy = Math.abs(m.y - piece.y);
    const rank = [Math.max(dx, dy), dx + dy, m.isCastling ? 1 : 0];
    const better = !bestRank || rank[0] < bestRank[0]
      || (rank[0] === bestRank[0] && (rank[1] < bestRank[1]
        || (rank[1] === bestRank[1] && rank[2] < bestRank[2])));
    if (better) { best = m; bestRank = rank; }
  }
  return best;
};

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
 * The board square under a pointer, in game coordinates, or null when the
 * pointer is off the board or the event has no pointer position (a keyboard
 * activation, a scripted click).
 */
export const squareUnderPointer = (boardEl, event, boardWidth, boardHeight, flipped) => {
  if (!boardEl || !event || !(event.detail > 0 || event.type === 'drop')) return null;
  const rect = boardEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const col = Math.floor((event.clientX - rect.left) / (rect.width / boardWidth));
  const row = Math.floor((event.clientY - rect.top) / (rect.height / boardHeight));
  if (col < 0 || row < 0 || col >= boardWidth || row >= boardHeight) return null;
  return flipped
    ? { x: boardWidth - 1 - col, y: boardHeight - 1 - row }
    : { x: col, y: row };
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
