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
 * Walks from the clicked square in the direction of gravity for as long as the
 * next square is empty and on the board. Returns null when the clicked square
 * is itself occupied AND cannot fall - which is how a full column is refused,
 * rather than by a separate emptiness test that would have to know about
 * gravity to be right.
 *
 * Deliberately tolerant about WHERE in the column you click: in Connect Four
 * you pick a column, not a square, so a click on an occupied square still
 * drops into the lowest empty one beneath it... except there is none, because
 * the pieces below it are what it is resting on. So the walk starts from the
 * clicked square when that is empty, and from the far edge of the column when
 * it is not - which is the same thing said from the other end, and is what
 * makes clicking anywhere in a column work.
 *
 * @param {{x:number,y:number}} clicked  the square the player picked
 * @param {(x:number,y:number)=>boolean} isOccupied
 * @returns {{x:number,y:number}|null}  the resting square, or null if the
 *   column is full
 */
function restingSquare(gravity, clicked, boardWidth, boardHeight, isOccupied) {
  if (!gravity) return clicked;

  const { dx, dy } = gravity;
  const onBoard = (x, y) => x >= 0 && y >= 0 && x < boardWidth && y < boardHeight;

  /*
   * Start at the far edge of the column the click landed in and walk BACK
   * against gravity until the first empty square. That square is where the
   * piece comes to rest, whichever square in the column was clicked - which is
   * the behaviour a player expects from a board that drops pieces.
   */
  let x = Number(clicked.x);
  let y = Number(clicked.y);
  if (!onBoard(x, y)) return null;

  // Run to the far edge in the direction of the fall.
  while (onBoard(x + dx, y + dy)) { x += dx; y += dy; }

  // Then walk back until a square is free.
  while (onBoard(x, y) && isOccupied(x, y)) { x -= dx; y -= dy; }

  if (!onBoard(x, y)) return null;   // the whole column is full
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
    + ' - the piece lands on the first free square. Both players see the board'
    + ' the same way up.';
}

module.exports = { gravityOf, restingSquare, describeGravity };
