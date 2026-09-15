import { useState, useEffect, useRef, useMemo } from "react";
import {
  boardBeforeSetupMove,
  replayWaypoints,
  pointAlong,
  easeInOut,
  REPLAY_DELAY_MS,
  REPLAY_DURATION_MS,
} from "../../helpers/setupMoveReplay";

/*
 * Show the opponent's last move being played, before the solver touches
 * anything.
 *
 * A puzzle drops you into a position with no sense of what just happened. Every
 * puzzle already stores the move that led in - it is what gives the position
 * its en passant rights - so it can be played: hold a beat, slide the piece in,
 * then hand over. The board is the same one in all three places a puzzle is
 * drawn, so this is one hook rather than three copies of a timer.
 *
 * WHAT THE CALLER DOES WITH IT
 *
 *   displayBoard  draw this instead of the real board. It is the pre-move
 *                 position while the replay runs and the real one afterwards.
 *   replaying     true until the move has finished. Every way of acting on the
 *                 board has to check it, or a fast solver answers a position
 *                 that is still arriving.
 *   overlay       the travelling piece. Render it anywhere inside the page; it
 *                 positions itself against the board element.
 *
 * Driven by requestAnimationFrame rather than a CSS transition, because a leap
 * is an L and a transition can only take the straight line between two points.
 *
 * It refuses rather than guesses. No setup move, a move that does not describe
 * this board, no board element to measure, or a reduced-motion preference, and
 * the hook hands back the real board with replaying already false.
 */
const useSetupMoveReplay = ({
  boardRef,
  squareSize,
  board,
  setupMove,
  imageFor,
  enabled = true,
  replayKey,
  // The opening move holds a beat before it slides, so the solver registers
  // what just happened; the opponent's later replies do not - they answer a
  // move the solver just made and should feel immediate.
  immediate = false,
}) => {
  const [progress, setProgress] = useState(null);   // null = not running
  const [done, setDone] = useState(false);
  const frameRef = useRef(null);
  const timerRef = useRef(null);

  /*
   * A caller can re-arm the replay by changing `replayKey` - the home card's
   * "Play it again" bumps it so a puzzle already seen animates the opponent's
   * move afresh. Ignored on mount and when the key is not provided, so the
   * other two boards keep their once-only behaviour.
   */
  const prevKeyRef = useRef(replayKey);
  useEffect(() => {
    if (prevKeyRef.current === replayKey) return;
    prevKeyRef.current = replayKey;
    setProgress(null);
    setDone(false);
  }, [replayKey]);

  const prefersReducedMotion = useMemo(() => {
    try {
      return typeof window !== 'undefined'
        && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { return false; }
  }, []);

  /*
   * Recomputed rather than stored, so a board that arrives in pieces - the
   * position, then the piece art - settles on the same answer every time.
   */
  const rewound = useMemo(
    () => (enabled && setupMove ? boardBeforeSetupMove(board, setupMove) : null),
    [enabled, board, setupMove]
  );

  const runnable = !!rewound && !done && !prefersReducedMotion;

  const waypoints = useMemo(
    () => (rewound ? replayWaypoints(setupMove.from, setupMove.to) : null),
    [rewound, setupMove]
  );

  useEffect(() => {
    if (!runnable) return undefined;
    let cancelled = false;

    /*
     * A watchdog alongside the animation, because requestAnimationFrame does
     * not run in a hidden tab.
     *
     * Open a puzzle in a background tab and the frames never arrive, so
     * without this the board would sit on the pre-move position with every
     * control disabled until the tab was looked at - a puzzle that silently
     * refuses to be played. The timer finishes the replay regardless; whoever
     * gets there first wins, and the other is cancelled.
     */
    let watchdog = null;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      setProgress(null);
      setDone(true);
    };

    timerRef.current = setTimeout(() => {
      if (cancelled) return;
      const started = performance.now();
      const step = (now) => {
        if (cancelled) return;
        const t = Math.min(1, (now - started) / REPLAY_DURATION_MS);
        setProgress(t);
        if (t < 1) frameRef.current = requestAnimationFrame(step);
        else finish();
      };
      frameRef.current = requestAnimationFrame(step);
      // Generous, so it never cuts a running animation short - it is a
      // backstop for frames that are not coming at all.
      watchdog = setTimeout(finish, REPLAY_DURATION_MS + 1500);
    }, immediate ? 0 : REPLAY_DELAY_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (watchdog) clearTimeout(watchdog);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [runnable, immediate]);

  /*
   * A puzzle that cannot be replayed must not leave the board disabled. Marked
   * done immediately so nothing downstream has to special-case it.
   */
  useEffect(() => {
    if (enabled && setupMove && !rewound && !done) setDone(true);
    if (prefersReducedMotion && !done) setDone(true);
  }, [enabled, setupMove, rewound, done, prefersReducedMotion]);

  const replaying = runnable;

  /*
   * During the HOLD the piece sits on its origin square, which is the whole
   * point - the solver gets a moment to see where it started. Once it is
   * travelling it is the overlay's job, so the square is emptied or the piece
   * would appear twice: once stationary at the start, once in flight.
   */
  const displayBoard = useMemo(() => {
    if (!replaying || !rewound) return board;
    if (progress == null) return rewound.before;
    const moving = { ...rewound.before };
    delete moving[rewound.fromKey];
    return moving;
  }, [replaying, rewound, progress, board]);

  /*
   * The travelling piece, drawn over everything.
   *
   * Positioned against the board's own rectangle rather than inside the grid:
   * the three pages wrap the board differently, and measuring the element is
   * the one approach that does not depend on any of them.
   */
  let overlay = null;
  if (replaying && progress != null && boardRef?.current && squareSize) {
    const rect = boardRef.current.getBoundingClientRect();
    const at = pointAlong(waypoints, easeInOut(progress));
    const src = imageFor ? imageFor(rewound.mover) : null;
    if (src) {
      overlay = {
        src,
        alt: rewound.mover?.piece_name || '',
        style: {
          position: 'fixed',
          left: rect.left + at.x * squareSize,
          top: rect.top + at.y * squareSize,
          width: squareSize,
          height: squareSize,
          pointerEvents: 'none',
          zIndex: 45,
          objectFit: 'contain',
        },
      };
    }
  }

  return { displayBoard, replaying, overlay };
};

export default useSetupMoveReplay;
