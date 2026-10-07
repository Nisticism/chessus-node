/*
 * The hop rules of a straight-line (directional) move or capture, as one rule.
 *
 * Three settings, each for movement and (the *_attack ones) for captures:
 *   min   - at least this many pieces hopped. "Require hopping"
 *           (directional_hop_only) is min 1; min_directional_hop_pieces raises it.
 *   max   - at most this many (max_directional_hop_pieces).
 *   landing - after hopping, land at most this many squares past the last
 *           piece hopped (hop_landing_distance). No hop, no limit.
 * Together they make the classic hoppers out of settings any piece can mix:
 * the xiangqi cannon captures over exactly one piece (attack min 1, max 1);
 * the grasshopper hops exactly one and lands right behind it (min 1, max 1,
 * landing 1). Custom squares and step-by-step moves are not straight-line
 * moves, and callers do not hold them to it.
 *
 * Its own module so the move engine (game-socket.js) and the Fairy-Stockfish
 * translator read the same rule. Mirrored by straightHopRule /
 * straightHopsBetween / hopRuleAllows in the frontend's moveEngine.js; the two
 * must agree.
 */
function straightHopRule(piece, attack) {
  const field = (name) => piece?.[attack ? `${name}_attack` : name];
  const count = (v) => (Number(v) > 0 ? Math.min(8, Math.floor(Number(v))) : null);
  const hopOnly = field('directional_hop_only') === 1 || field('directional_hop_only') === true;
  const min = Math.max(count(field('min_directional_hop_pieces')) || 0, hopOnly ? 1 : 0);
  const max = count(field('max_directional_hop_pieces'));
  const landing = count(field('hop_landing_distance'));
  return { min, max, landing, active: min > 0 || max != null || landing != null };
}

/** Pieces strictly between two squares on a line, and how far past the last of them the end square is. */
function straightHopsBetween(fromX, fromY, toX, toY, isOccupied) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  // Not a straight line (or no move at all): nothing in between to count.
  if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy))) return { count: 0, beyond: null };
  const sX = Math.sign(dx);
  const sY = Math.sign(dy);
  let count = 0;
  let beyond = null;
  for (let x = fromX + sX, y = fromY + sY; x !== toX || y !== toY; x += sX, y += sY) {
    if (isOccupied(x, y)) { count++; beyond = 0; } else if (beyond !== null) beyond++;
  }
  return { count, beyond: beyond === null ? null : beyond + 1 };
}

function hopRuleAllows(rule, hops) {
  if (hops.count < rule.min) return false;
  if (rule.max != null && hops.count > rule.max) return false;
  if (rule.landing != null && hops.count > 0 && hops.beyond > rule.landing) return false;
  return true;
}

/*
 * The path of an L-shaped (ratio) move, for a piece that does not simply jump.
 *
 * An (a, b) move is two straight legs. LEG ONE is the longer; when they are
 * equal, leg one is the sideways (x) leg. Three settings, for movement and
 * (the *_attack ones) for captures:
 *   ratio_path_order    'either' (default) - either route may be taken, so the
 *                       move is blocked only when both are; 'long_first' -
 *                       leg one, then leg two; 'short_first' - the reverse.
 *   ratio_path_blocking 'both' (default) - a piece on either leg blocks;
 *                       'long' - only on leg one; 'short' - only on leg two.
 *   ratio_path_corner_blocks  whether the square where the legs meet blocks
 *                       (default yes).
 * The defaults are the rule every L-move has always had. The xiangqi horse
 * (Betza nN) is long_first + long + no corner: blocked only by the square
 * beside it in the long direction. A piece that may hop the blocker still
 * passes, as with any path; the destination square is never part of it.
 */
function lPathRule(piece, attack) {
  const field = (name) => piece?.[attack ? `${name}_attack` : name];
  const order = ['long_first', 'short_first'].includes(field('ratio_path_order')) ? field('ratio_path_order') : 'either';
  const legs = ['long', 'short'].includes(field('ratio_path_blocking')) ? field('ratio_path_blocking') : 'both';
  const c = field('ratio_path_corner_blocks');
  const corner = c === null || c === undefined || c === '' ? true : (c === 1 || c === true || c === '1' || c === 'true');
  return { order, legs, corner, isDefault: order === 'either' && legs === 'both' && corner };
}

/** Is the L route from (fromX, fromY) by (dx, dy) open under `rule`? blocks(x, y) says whether a square stops it. */
function lRouteClear(fromX, fromY, dx, dy, rule, blocks) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const oneIsX = ax >= ay;
  const legOne = oneIsX ? { x: Math.sign(dx), y: 0, n: ax } : { x: 0, y: Math.sign(dy), n: ay };
  const legTwo = oneIsX ? { x: 0, y: Math.sign(dy), n: ay } : { x: Math.sign(dx), y: 0, n: ax };
  const counts = (isLegOne) => rule.legs === 'both' || (rule.legs === 'long') === isLegOne;
  const route = (first, second, firstIsOne) => {
    let x = fromX;
    let y = fromY;
    for (let i = 1; i <= first.n; i++) {
      x += first.x; y += first.y;
      const isCorner = i === first.n && second.n > 0;
      if ((isCorner ? rule.corner : counts(firstIsOne)) && blocks(x, y)) return false;
    }
    for (let i = 1; i < second.n; i++) {
      x += second.x; y += second.y;
      if (counts(!firstIsOne) && blocks(x, y)) return false;
    }
    return true;
  };
  if (rule.order === 'long_first') return route(legOne, legTwo, true);
  if (rule.order === 'short_first') return route(legTwo, legOne, false);
  return route(legOne, legTwo, true) || route(legTwo, legOne, false);
}

module.exports = { straightHopRule, straightHopsBetween, hopRuleAllows, lPathRule, lRouteClear };
