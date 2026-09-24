import React, { useCallback, useMemo, useRef } from "react";
import boardVp from "../common/boardViewport.module.scss";
import useTouchPieceGestures from "../common/useTouchPieceGestures";
import { colToFile, rowToRank } from "../../helpers/pieceMovementUtils";

import styles from "./puzzleboard.module.scss";

/*
 * Room the coordinates take beside and below the board, in px. Callers add it
 * to their useBoardViewport insets so the board still fits the space it was
 * given with the labels drawn - otherwise "fit" would be eighteen pixels too
 * big and open a scrollbar.
 */
export const NOTATION_INSET = 18;

/*
 * A puzzle is shown from the side that solves it.
 *
 * The stored position is always player 1's view - row 0 at the top - so a
 * player-2 puzzle drawn as stored had the solver looking at the board from the
 * wrong end: their pawns walking down the screen, a-h running the wrong way
 * under them. Player 2 sees it turned round, both axes mirrored, exactly as a
 * live game flips for player 2 and as the image posted to Discord already did.
 *
 * The one rule, so every board that draws a puzzle agrees with it.
 */
export const puzzleFlipped = (puzzleOrSide) => {
  const side = puzzleOrSide && typeof puzzleOrSide === 'object'
    ? puzzleOrSide.side_to_move
    : puzzleOrSide;
  return Number(side) === 2;
};

/*
 * Which square - in BOARD coordinates - a point on the screen is over, or null
 * off the board. The one copy: each page used to divide by the square size
 * itself, which is right only while the board is drawn the right way up.
 */
export const squareFromPoint = (boardEl, clientX, clientY, { squareSize, boardWidth, boardHeight, flipped = false }) => {
  const rect = boardEl?.getBoundingClientRect();
  if (!rect || !squareSize) return null;
  const col = Math.floor((clientX - rect.left) / squareSize);
  const row = Math.floor((clientY - rect.top) / squareSize);
  if (col < 0 || row < 0 || col >= boardWidth || row >= boardHeight) return null;
  return flipped
    ? { x: boardWidth - 1 - col, y: boardHeight - 1 - row }
    : { x: col, y: row };
};

/*
 * A board grid with its coordinates around it - the one copy, shared by the
 * puzzle board and the builder, so a square is called the same thing in both.
 */
export const BoardCoordinates = ({ boardWidth, boardHeight, squareSize, show = true, flipped = false, children }) => {
  if (!show) return children;
  return (
    <div className={styles["with-coords"]}>
      <div
        className={styles["rank-labels"]}
        style={{ gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)` }}
        aria-hidden="true"
      >
        {Array.from({ length: boardHeight }, (_, i) => (
          <span key={i}>{rowToRank(flipped ? i : boardHeight - 1 - i)}</span>
        ))}
      </div>
      <div>
        {children}
        <div
          className={styles["file-labels"]}
          style={{ gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)` }}
          aria-hidden="true"
        >
          {Array.from({ length: boardWidth }, (_, i) => (
            <span key={i}>{colToFile(flipped ? boardWidth - 1 - i : i)}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

/*
 * The board a puzzle is drawn on, in one place.
 *
 * The solver page, the builder and the home-page card all draw the same thing:
 * a grid of fixed-size squares in a scroll/zoom frame, alternating colours, with
 * whatever that page wants inside each square. That last part is the only real
 * difference between them, so it is the only part left to the caller.
 *
 * WHAT THIS OWNS: the geometry. The viewport frame, the grid, the square size,
 * the light/dark alternation, and the event wiring. Nothing decorative.
 *
 * WHAT THE CALLER OWNS: what goes IN a square (renderSquare), and any classes
 * that mark one up (squareClassName) - selection, fog, move dots, highlights.
 * Those differ per page and belong in that page's own stylesheet.
 *
 * Squares are sized in PIXELS from useBoardViewport rather than as grid
 * fractions. That is not incidental: a grid with implicit rows sizes each rank
 * to its contents, so a rank with no pieces on it collapses to nothing and the
 * board comes out short. Fixed sizes cannot do that.
 */
const PuzzleBoard = ({
  vp,
  boardWidth,
  boardHeight,
  lightColor,
  darkColor,
  renderSquare,
  squareClassName,
  squareTitle,
  onSquareClick,
  onSquarePointerDown,
  /*
   * Touch - see useTouchPieceGestures for the rules every board shares.
   *
   * liftedSquare   "y,x" of the piece that is picked up. The only square a
   *                touch press drags from straight away, and the only one that
   *                keeps a finger from scrolling.
   * squarePiece    (x, y) => 'own' | 'other' | null: whether a piece sits there
   *                and whether this user may move it right now. A long press
   *                only picks up an 'own' piece; a tap on either kind shows its
   *                hover styles.
   * onSquareLift   (x, y) => void: a long press picked this piece up. Optional -
   *                a caller whose press handler already selects can omit it.
   */
  liftedSquare = null,
  squarePiece = null,
  onSquareLift = null,
  /*
   * Algebraic coordinates, the live game's way round: files a, b, c... left to
   * right along the bottom, ranks with 1 at the bottom. A puzzle is a position
   * from somebody's invented game, often with nothing on it as directional as
   * a pawn, and without them there was no telling which way the board faced.
   */
  showNotation = true,
  // Drawn from player 2's side - see puzzleFlipped. Every callback still
  // receives BOARD coordinates; only the drawing turns round.
  flipped = false,
  onSquareMouseEnter,
  onSquareMouseLeave,
  className,
  // The solver measures the board element to turn a pointer position into a
  // square while dragging, so it needs a handle on it.
  boardRef,
}) => {
  const squares = useMemo(() => {
    const out = [];
    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        const x = flipped ? boardWidth - 1 - col : col;
        const y = flipped ? boardHeight - 1 - row : row;
        const key = `${y},${x}`;
        const extra = squareClassName ? squareClassName(x, y) : '';
        const lifted = key === liftedSquare;
        const piece = squarePiece ? squarePiece(x, y) : null;
        out.push(
          <div
            key={key}
            className={`${styles["square"]}${extra ? ` ${extra}` : ''}`}
            data-piece-key={piece ? key : undefined}
            data-piece-own={piece === 'own' ? '1' : undefined}
            data-piece-lifted={piece === 'own' && lifted ? '1' : undefined}
            style={{
              background: (x + y) % 2 === 0 ? lightColor : darkColor,
              width: vp.squareSize,
              height: vp.squareSize,
            }}
            title={squareTitle ? squareTitle(x, y) : undefined}
            onClick={onSquareClick ? () => onSquareClick(x, y) : undefined}
            /*
             * preventDefault on the press, and on any drag the browser tries to
             * start for itself. Without both, pressing a piece and moving begins
             * a TEXT selection, which paints the board and the copy beside it
             * blue for the whole drag.
             */
            onPointerDown={(e) => {
              /*
               * A finger on a piece that is not picked up yet is somebody
               * scrolling until proven otherwise. Nothing starts here: a tap
               * picks the piece up through the click that follows, and a long
               * press through the gesture hook below.
               */
              if (e.pointerType === 'touch' && !lifted) return;
              e.preventDefault();
              if (onSquarePointerDown) onSquarePointerDown(e, x, y);
            }}
            onDragStart={(e) => e.preventDefault()}
            onMouseEnter={onSquareMouseEnter ? () => onSquareMouseEnter(x, y) : undefined}
            onMouseLeave={onSquareMouseLeave ? () => onSquareMouseLeave(x, y) : undefined}
          >
            {renderSquare ? renderSquare(x, y) : null}
          </div>
        );
      }
    }
    return out;
  }, [
    boardWidth, boardHeight, lightColor, darkColor, vp.squareSize,
    renderSquare, squareClassName, squareTitle, liftedSquare, squarePiece, flipped,
    onSquareClick, onSquarePointerDown, onSquareMouseEnter, onSquareMouseLeave,
  ]);

  const boardEl = useRef(null);
  const setBoardEl = useCallback((el) => {
    boardEl.current = el;
    if (typeof boardRef === 'function') boardRef(el);
    else if (boardRef) boardRef.current = el;
  }, [boardRef]);

  const squareOf = (key) => {
    const [y, x] = String(key).split(',').map(Number);
    return { x, y };
  };

  useTouchPieceGestures(boardEl, {
    // A tap shows the piece's hover styles, as a pointer resting on it would.
    // The click that follows then does whatever a click does - selects your
    // own piece, or answers with the one already selected.
    onTap: (info) => {
      const { x, y } = squareOf(info.key);
      if (onSquareMouseLeave) onSquareMouseLeave(x, y);
      if (onSquareMouseEnter) onSquareMouseEnter(x, y);
    },
    // A long press: pick the piece up, then hand the caller the same press a
    // pointer would have, so its own drag carries on from there.
    onLift: (info, point) => {
      const { x, y } = squareOf(info.key);
      if (onSquareLift) onSquareLift(x, y);
      if (onSquarePointerDown) {
        onSquarePointerDown({
          clientX: point.clientX, clientY: point.clientY,
          pointerType: 'touch', button: 0, fromLongPress: true,
          preventDefault() {}, stopPropagation() {},
        }, x, y);
      }
    },
  });

  return (
    <div
      className={`${boardVp.viewport} ${vp.hideScrollbars ? boardVp.noScrollbars : ''}`}
      ref={vp.viewportRef}
      style={vp.viewportStyle}
    >
      <div style={vp.contentStyle}>
        <BoardCoordinates
          boardWidth={boardWidth}
          boardHeight={boardHeight}
          squareSize={vp.squareSize}
          show={showNotation}
          flipped={flipped}
        >
          <div
            className={`${styles["board"]}${className ? ` ${className}` : ''}`}
            ref={setBoardEl}
            data-touch-board=""
            style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}
          >
            {squares}
          </div>
        </BoardCoordinates>
      </div>
    </div>
  );
};

export default PuzzleBoard;
