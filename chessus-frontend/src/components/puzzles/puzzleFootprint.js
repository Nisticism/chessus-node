/*
 * Multi-tile pieces on a puzzle board.
 *
 * A puzzle position is keyed by each piece's anchor - its top-left square - so
 * a 2x2 piece is one cell, and the three other squares it covers have nothing
 * in them. Everything a board does with a square has to ask which piece COVERS
 * it instead, or those squares read as empty: the picture drew on one square,
 * clicking the rest of the piece did nothing, and a move landing a piece's
 * edge on an enemy left the enemy standing.
 *
 * Moves are named by where the anchor lands, and chosen the same way as in a
 * live game (helpers/multiTileTargets): a click means the shortest move that
 * covers the clicked square, a drag means the grabbed square lands on the drop
 * square when it can.
 */
import { isMultiTile, moveCoveringSquare, moveForDrop, movesCoveringSquare } from "../../helpers/multiTileTargets";

/** A cell's footprint size; placements carry it for multi-tile pieces. */
export const cellSize = (cell) => ({
  w: Math.max(1, Number(cell?.piece_width) || 1),
  h: Math.max(1, Number(cell?.piece_height) || 1),
});

/** The key ("y,x") of the piece covering square (x, y), or null. */
export const coveringKey = (cells, x, y) => {
  if (!cells) return null;
  const direct = `${y},${x}`;
  if (cells[direct]) return direct;
  for (const [key, cell] of Object.entries(cells)) {
    const { w, h } = cellSize(cell);
    if (w === 1 && h === 1) continue;
    const [ay, ax] = key.split(',').map(Number);
    if (x >= ax && x < ax + w && y >= ay && y < ay + h) return key;
  }
  return null;
};

/**
 * Take off the board every piece a w x h footprint anchored at (x, y) lands on
 * - a multi-tile move captures everything under it, not only what is on its
 * anchor. Mutates `cells` (the caller's fresh copy).
 */
export const clearFootprint = (cells, x, y, w, h) => {
  for (const [key, cell] of Object.entries(cells)) {
    const [cy, cx] = key.split(',').map(Number);
    const s = cellSize(cell);
    if (cx < x + w && x < cx + s.w && cy < y + h && y < cy + s.h) delete cells[key];
  }
};

/**
 * The image style that stretches a multi-tile piece over its footprint from
 * its anchor square, or null for a single square. A flipped board draws the
 * piece half a turn round, so it grows up and left from the anchor instead.
 */
export const spanStyle = (cell, flipped, extra = null) => {
  const { w, h } = cellSize(cell);
  if (w === 1 && h === 1) return extra;
  return {
    position: 'absolute',
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    ...(flipped ? { right: 0, bottom: 0 } : { left: 0, top: 0 }),
    boxSizing: 'border-box',
    padding: '4%',
    maxWidth: 'none',
    zIndex: 3,
    ...(extra || {}),
  };
};

/**
 * Where a move of `piece` to (x, y) actually sends its anchor, from its legal
 * `moves`. `grab` ({ x, y } offset from the anchor) when it was dragged by one
 * of its squares; a click has none. A single-square piece goes to (x, y).
 */
export const moveTarget = (moves, piece, x, y, grab = null) => {
  if (!isMultiTile(piece)) return { x, y };
  const m = grab ? moveForDrop(moves, piece, grab, x, y) : moveCoveringSquare(moves, piece, x, y);
  return m ? { x: m.x, y: m.y } : { x, y };
};

/**
 * The move dot for square (x, y): the move landing there, or for a multi-tile
 * piece (moves.forPiece) the best move whose footprint covers it - never on
 * the piece's own squares, which clicking selects.
 */
export const dotAt = (moves, x, y) => {
  const piece = moves && moves.forPiece;
  if (!isMultiTile(piece)) return (moves || []).find((m) => m.x === x && m.y === y) || null;
  const { w, h } = cellSize(piece);
  if (x >= piece.x && x < piece.x + w && y >= piece.y && y < piece.y + h) return null;
  return movesCoveringSquare(moves, piece, x, y)[0]
    || moves.find((m) => m.isRangedAttack && m.x === x && m.y === y) || null;
};

/** `moves` tagged with the piece they belong to, for dotAt. */
export const movesOf = (piece, moves) => {
  const out = [...(moves || [])];
  out.forPiece = piece || null;
  return out;
};

/**
 * A position keyed by anchors only. A game's pieces_string also lists every
 * square a multi-tile piece covers (`_occupied` entries pointing at its
 * anchor); those are not pieces, and a board that took them for pieces drew
 * the picture on every square of the footprint.
 */
export const anchorsOnly = (cells) => {
  const out = {};
  for (const [key, cell] of Object.entries(cells || {})) {
    if (cell && !cell._occupied) out[key] = cell;
  }
  return out;
};

/**
 * `cells` with each multi-tile piece's size written on it, from `defs` (piece
 * definitions by id) where the cell does not already say. Returns `cells`
 * itself when nothing changes, so it is safe to run on every definition load.
 */
export const withSizes = (cells, defs) => {
  let out = null;
  for (const [key, cell] of Object.entries(cells || {})) {
    if (!cell || cell.piece_width || cell.piece_height) continue;
    const def = defs?.[cell.piece_id];
    const w = Number(def?.piece_width) || 1;
    const h = Number(def?.piece_height) || 1;
    if (w === 1 && h === 1) continue;
    if (!out) out = { ...cells };
    out[key] = { ...cell, piece_width: w, piece_height: h };
  }
  return out || cells;
};
