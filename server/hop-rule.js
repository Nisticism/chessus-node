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

module.exports = { straightHopRule, straightHopsBetween, hopRuleAllows };
