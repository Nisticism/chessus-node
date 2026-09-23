import React, { useMemo } from "react";
import boardVp from "../common/boardViewport.module.scss";
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
   * The square whose piece is picked up, as "y,x". On touch it is the only
   * square that starts a drag, and the only one that keeps the finger from
   * scrolling - see .lifted in puzzleboard.module.scss.
   */
  liftedSquare = null,
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
        out.push(
          <div
            key={key}
            className={`${styles["square"]}${lifted ? ` ${styles["lifted"]}` : ''}${extra ? ` ${extra}` : ''}`}
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
               * scrolling until proven otherwise. Nothing starts here; if it
               * was a tap, the click that follows picks the piece up, and the
               * next press on it can drag.
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
    renderSquare, squareClassName, squareTitle, liftedSquare,
    onSquareClick, onSquarePointerDown, onSquareMouseEnter, onSquareMouseLeave,
  ]);

  return (
    <div
      className={`${boardVp.viewport} ${vp.hideScrollbars ? boardVp.noScrollbars : ''}`}
      ref={vp.viewportRef}
      style={vp.viewportStyle}
    >
      <div style={vp.contentStyle}>
        <div
          className={`${styles["board"]}${className ? ` ${className}` : ''}`}
          ref={boardRef}
          style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}
        >
          {squares}
        </div>
      </div>
    </div>
  );
};

export default PuzzleBoard;
