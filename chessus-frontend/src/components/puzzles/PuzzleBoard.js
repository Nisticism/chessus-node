import React, { useCallback, useMemo, useRef } from "react";
import boardVp from "../common/boardViewport.module.scss";
import useTouchPieceGestures from "../common/useTouchPieceGestures";
import styles from "./puzzleboard.module.scss";

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
  onSquareMouseEnter,
  onSquareMouseLeave,
  className,
  // The solver measures the board element to turn a pointer position into a
  // square while dragging, so it needs a handle on it.
  boardRef,
}) => {
  const squares = useMemo(() => {
    const out = [];
    for (let y = 0; y < boardHeight; y++) {
      for (let x = 0; x < boardWidth; x++) {
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
    renderSquare, squareClassName, squareTitle, liftedSquare, squarePiece,
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
        <div
          className={`${styles["board"]}${className ? ` ${className}` : ''}`}
          ref={setBoardEl}
          data-touch-board=""
          style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}
        >
          {squares}
        </div>
      </div>
    </div>
  );
};

export default PuzzleBoard;
