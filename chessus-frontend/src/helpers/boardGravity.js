/*
 * Board gravity, on the client.
 *
 * A MIRROR of server/board-gravity.js, and only a mirror. The server resolves
 * where a dropped piece actually lands; this exists so the board can show the
 * player where it will land before they commit, and so a click on an occupied
 * square is not rejected before it ever leaves the page. If the two ever
 * disagreed the piece lands where the SERVER says and this was what was wrong.
 *
 * Kept deliberately tiny for that reason - a walk along one axis and nothing
 * else. Anything that needs judgement belongs on the server, where there is one
 * copy of it.
 */

const GRAVITY_STEPS = {
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Which way pieces fall in this game, or null when gravity is off. */
export const gravityOf = (gameType) => {
  const dir = gameType?.board_gravity;
  if (!dir || dir === 'off') return null;
  return GRAVITY_STEPS[dir] ? { direction: dir, ...GRAVITY_STEPS[dir] } : null;
};

/**
 * Where a piece dropped at (x, y) comes to rest, or null if the column is full.
 * Same walk as the server's: it falls from where it is put and stops on the
 * first piece below; a click on a piece drops onto that stack.
 */
// `size` ({ w, h }): a multi-tile piece's whole footprint falls as one and
// its anchor (top-left) is returned - same rule as the server.
export const restingSquare = (gravity, clicked, boardWidth, boardHeight, isOccupied, size = null) => {
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
};
