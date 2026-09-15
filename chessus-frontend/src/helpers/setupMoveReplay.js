/*
 * Playing the opponent's last move onto the board before you solve.
 *
 * A puzzle stores the position AFTER their move, which is the position you
 * have to solve - but it drops you into it cold, with no sense of what just
 * happened. Every puzzle already knows the move that led in (setup_move, which
 * is what gives it en passant rights), so it can be shown: hold the board a
 * beat, slide the piece in, then hand over.
 *
 * The pieces here are the two parts that are not React: turning the stored
 * post-move position back into the pre-move one, and working out the path the
 * piece should travel.
 */

/** Board keys are "y,x" everywhere a puzzle is drawn. */
const keyOf = (x, y) => `${y},${x}`;

/**
 * The board as it stood BEFORE the opponent's last move.
 *
 * The mover is put back on its origin square. What it captured cannot be
 * restored - the stored position is after the fact and the taken piece is
 * simply gone - so a capture replays as a piece sliding onto an empty square.
 * That is a small lie about one square, and much less of one than showing no
 * move at all.
 *
 * Returns null when the move cannot be replayed against this board, which is
 * the signal to skip the whole thing rather than animate something wrong.
 */
export const boardBeforeSetupMove = (board, setupMove) => {
  if (!board || !setupMove?.from || !setupMove?.to) return null;
  const toKey = keyOf(setupMove.to.x, setupMove.to.y);
  const fromKey = keyOf(setupMove.from.x, setupMove.from.y);
  const mover = board[toKey];
  // Nothing on the destination, or the origin already occupied: the stored
  // move does not describe this position, so there is nothing safe to show.
  if (!mover || board[fromKey]) return null;

  const before = { ...board };
  delete before[toKey];
  before[fromKey] = { ...mover, x: setupMove.from.x, y: setupMove.from.y };
  return { before, mover, fromKey, toKey };
};

/**
 * The squares a piece passes through on its way from one square to another.
 *
 * A straight run - along a rank, a file, or a true diagonal - is one segment,
 * because that is what the piece actually does.
 *
 * Anything else is a LEAP: a displacement like (1, 2) is a ratio move, and
 * drawing it as a straight line would send the piece diagonally across squares
 * it never visits. Those get the L that a knight is always drawn making, the
 * longer leg first. Where a game defines the ratio explicitly the same L is
 * one of its valid paths; where several are valid this picks one, which is all
 * the animation needs to be honest about.
 *
 * Returns board-coordinate waypoints INCLUDING both ends.
 */
export const replayWaypoints = (from, to) => {
  const start = { x: Number(from.x), y: Number(from.y) };
  const end = { x: Number(to.x), y: Number(to.y) };
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // A rank, a file, or a true diagonal: the piece really does travel that way.
  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
    return [start, end];
  }

  // A leap. Longer leg first, which is how the move reads when a person makes
  // it on a physical board.
  const corner = Math.abs(dx) >= Math.abs(dy)
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
  return [start, corner, end];
};

/**
 * Where along a polyline a fraction of the journey lands.
 *
 * Distance is measured in SQUARES rather than in segments, so an L-shaped path
 * does not slow down on its short leg - the piece keeps one speed the whole
 * way, which is what makes it read as one movement rather than two.
 */
export const pointAlong = (waypoints, t) => {
  if (!waypoints || waypoints.length < 2) return waypoints?.[0] || { x: 0, y: 0 };

  const legs = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    legs.push({ a, b, len });
    total += len;
  }
  if (total === 0) return waypoints[0];

  let travelled = Math.max(0, Math.min(1, t)) * total;
  for (const leg of legs) {
    if (travelled <= leg.len || leg === legs[legs.length - 1]) {
      const f = leg.len === 0 ? 1 : Math.min(1, travelled / leg.len);
      return {
        x: leg.a.x + (leg.b.x - leg.a.x) * f,
        y: leg.a.y + (leg.b.y - leg.a.y) * f,
      };
    }
    travelled -= leg.len;
  }
  return waypoints[waypoints.length - 1];
};

/** Eased so the piece starts and stops rather than jerking. */
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** How long the board sits still before the move plays, and how long it takes. */
export const REPLAY_DELAY_MS = 1000;
export const REPLAY_DURATION_MS = 500;
