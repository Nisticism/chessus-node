/*
 * Board gravity: a placed piece falls.
 *
 * Connect Four is the reason this exists. With piece placement, a piece that
 * cannot move, and the line win condition, the only missing parts were that a
 * piece dropped into a column must land at the BOTTOM rather than stay where it
 * was clicked, and that both players must see the board the same way up.
 *
 * The second half is not cosmetic. Every other game here flips the board for
 * player 2 so their pieces are nearest them, which is right when "forward" is a
 * direction relative to you. A gravity board has a real top and a real bottom
 * that are the same for everybody, and flipping it would show one player their
 * pieces falling upward. So gravity turns the flip off - see shouldFlipBoard in
 * LiveGame.js.
 *
 * A DIRECTION rather than a flag, so the same rule serves a board that fills
 * from any edge. 'off' means the feature is not in use, which is the default
 * and the answer for almost every game.
 *
 * This module is the authority. The client mirrors the same walk to show where
 * a piece will land before it is dropped (helpers/boardGravity.js), but that
 * copy only draws a preview: if the two ever disagreed, the piece lands where
 * THIS says, and the preview is what was wrong.
 */

/** Which way pieces fall, as a step, or null when gravity is off. */
const GRAVITY_STEPS = {
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * The gravity setting for a game type, or null when it does not use it.
 *
 * Reads the column off the game type rather than other_game_data, because it
 * changes how the board is DRAWN as well as how a placement resolves, and the
 * board renderer already has the game type to hand.
 */
function gravityOf(gameType) {
  const dir = gameType?.board_gravity;
  if (!dir || dir === 'off') return null;
  return GRAVITY_STEPS[dir] ? { direction: dir, ...GRAVITY_STEPS[dir] } : null;
}

/**
 * Where a piece dropped at (x, y) actually comes to rest.
 *
 * `size` ({ w, h }) is the piece's footprint when it covers more than one
 * square: the whole footprint falls as one, the anchor (top-left) is what is
 * returned, and a square counts as free only when every square the footprint
 * would cover there is free. A click anywhere in the columns it spans works.
 *
 * Walks from the clicked square in the direction of gravity for as long as the
 * next square is empty and on the board, so the piece rests on the first piece
 * below it. A click on an occupied square drops onto that stack instead (the
 * first free square above it); null when there is none - a full column.
 *
 * In a column with no gaps - Connect Four, where pieces never move - this is
 * the lowest empty square wherever in the column you click.
 *
 * @param {{x:number,y:number}} clicked  the square the player picked
 * @param {(x:number,y:number)=>boolean} isOccupied
 * @returns {{x:number,y:number}|null}  the resting square, or null if the
 *   column is full
 */
function restingSquare(gravity, clicked, boardWidth, boardHeight, isOccupied, size = null) {
  if (!gravity) return clicked;

  const { dx, dy } = gravity;
  const w = Math.max(1, (size && size.w) || 1);
  const h = Math.max(1, (size && size.h) || 1);
  const onBoard = (x, y) => x >= 0 && y >= 0 && x + w <= boardWidth && y + h <= boardHeight;
  const footprintOccupied = (x, y) => {
    for (let fy = 0; fy < h; fy++) {
      for (let fx = 0; fx < w; fx++) if (isOccupied(x + fx, y + fy)) return true;
    }
    return false;
  };

  let x = Number(clicked.x);
  let y = Number(clicked.y);
  if (!(x >= 0 && y >= 0 && x < boardWidth && y < boardHeight)) return null;
  // A wide or tall piece clicked near the far side still has to fit.
  x = Math.min(x, boardWidth - w);
  y = Math.min(y, boardHeight - h);
  if (!onBoard(x, y)) return null;

  /*
   * The piece falls FROM where it is put and stops on the first piece below
   * it - it never passes through a piece. (It used to land on the lowest
   * empty square of the column, so in a column with a gap - a piece moved up
   * and left a hole under it - a disc dropped above passed through that piece
   * into the hole: puzzle 102's c4 landed on c2, under the disc on c3.)
   *
   * Clicking an occupied square still means "drop into this column": the
   * piece goes on top of the stack that was clicked - up against gravity to
   * the first free square, which is resting on the stack by construction.
   */
  if (footprintOccupied(x, y)) {
    while (onBoard(x, y) && footprintOccupied(x, y)) { x -= dx; y -= dy; }
    if (!onBoard(x, y)) return null;   // the whole column is full
    return { x, y };
  }
  while (onBoard(x + dx, y + dy) && !footprintOccupied(x + dx, y + dy)) { x += dx; y += dy; }
  return { x, y };
}

/** A sentence describing the rule, for the rules panel and the wizard. */
function describeGravity(gameType) {
  const gravity = gravityOf(gameType);
  if (!gravity) return null;
  const where = {
    down: 'the bottom', up: 'the top', left: 'the left edge', right: 'the right edge',
  }[gravity.direction];
  const axis = gravity.direction === 'down' || gravity.direction === 'up' ? 'column' : 'row';
  return `Pieces you place fall towards ${where}, so choosing a ${axis} is enough`
    + ' - the piece falls until it lands on another piece or the edge. Both players see the board'
    + ' the same way up.';
}

module.exports = { gravityOf, restingSquare, describeGravity };
