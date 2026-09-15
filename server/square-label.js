/*
 * Naming a square the way a player reads it.
 *
 * The file letter is bijective base-26 - a..z, then aa..az, ba.., zz, aaa -
 * because `String.fromCharCode(97 + x)` walks straight past 'z' into '{', '|',
 * '}', '~' and then into control characters, which is what a board wider than
 * 26 columns was showing. "Bijective" is the load-bearing part: there is no
 * zero digit, so the column after 'z' is 'aa' rather than 'ba', which is the
 * numbering spreadsheets use and the one anybody reading a wide board expects.
 *
 * Mirrored by colToFile in chessus-frontend/src/helpers/pieceMovementUtils.js.
 * Two copies because the server cannot import from the bundle; they are a
 * dozen lines of arithmetic with no inputs but a number, and this comment is
 * the link between them.
 *
 * NOT for the Fairy-Stockfish translator. What it emits is protocol, not
 * prose: the engine has its own notion of a file and does not support boards
 * this wide anyway, so changing that would corrupt the conversation rather
 * than improve it.
 */

/** A 0-based column as its file letter: 0 -> 'a', 25 -> 'z', 26 -> 'aa'. */
function colToFile(col) {
  if (col === null || col === undefined) return '';
  const n = Math.floor(Number(col));
  if (!Number.isFinite(n) || n < 0) return '';

  let out = '';
  let remaining = n;
  while (remaining >= 0) {
    out = String.fromCharCode(97 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return out;
}

/**
 * A square as a player would say it.
 *
 * y is measured from the TOP of the board in this codebase, and ranks are
 * counted from the bottom, so the rank is the height minus y.
 */
function squareLabel(x, y, boardHeight = 8) {
  return `${colToFile(x)}${(Number(boardHeight) || 8) - Number(y)}`;
}

module.exports = { colToFile, squareLabel };
