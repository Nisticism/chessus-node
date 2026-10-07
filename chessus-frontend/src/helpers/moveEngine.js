/**
 * Shared piece-movement engine.
 *
 * Extracted verbatim from LiveGame so that non-live board views (match replay,
 * analysis tools) compute movement and attack squares with exactly the same
 * rules the live board uses. LiveGame keeps thin wrappers over this factory,
 * so behaviour there is unchanged.
 *
 * The factory takes the small amount of game context the rules depend on:
 *   specialSquares         { range, promotion, control, special } parsed square configs
 *   gameType               game type row (simultaneous_turns, mate_condition)
 *   enPassantTarget        current en-passant target, or null when unavailable
 *   currentPlayerPosition  viewing player's position; null (spectator/replay)
 *                          skips the leave-yourself-in-check filter, matching
 *                          what a live-game spectator sees on hover.
 */
import {
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  rangedFromFootprint,
  findPieceAtSquare,
  doesPieceOccupySquare,
  doesPieceFitOnBoard,
  isDestinationClear,
  getDirectionChangeMoves,
  parseSpecialScenarioMoves,
  parseSpecialScenarioCaptures,
  repeatCap,
} from './pieceMovementUtils';
import { firstMoveVariant } from './firstMove';
import { hasPaths, pathMoves, pathAttacks } from './movePaths';

/**
 * Board indicator colours, shared by every board that draws move dots.
 *
 * A square is coloured by what the piece's patterns can do there, not by how it
 * got there — a custom-square move is just a move. "both" means the movement
 * pattern AND the capture pattern reach the square, drawn as a half-blue,
 * half-red dot: the piece can move there OR attack it, as opposed to a piece
 * that merely captures with its movement pattern.
 */
const DOT_MOVE = 'rgba(33,150,243,0.42)';
const DOT_CAPTURE = 'rgba(220,60,60,0.55)';

export const MOVE_DOT_BACKGROUNDS = {
  move: DOT_MOVE,
  capture: DOT_CAPTURE,
  both: `linear-gradient(90deg, ${DOT_MOVE} 0 50%, ${DOT_CAPTURE} 50% 100%)`,
  // --gold-muted is the site's muted gold (#9c884a); the literal is the fallback
  // for any context that doesn't inherit the global palette.
  first: 'rgba(var(--gold-muted-rgb, 156, 136, 74), 0.62)',
  castle: 'rgba(var(--gold-rgb, 212, 175, 55), 0.7)',
};

/*
 * The "blocked" dot (calculateBlockedTargets): where the piece would go if that
 * square were free. Same colours as the ordinary dots, but a dashed ring with
 * nothing inside - a filled dot means a move you can make, so it is kept for
 * those alone - and it reads as "could, but not now": over a piece of your own,
 * a piece that cannot be captured, an impassable square, or an enemy on a
 * square the piece can only move to. "both" splits the ring the way the
 * ordinary dot splits its fill: blue on the left, red on the right.
 *
 * Its OUTSIDE edge matches the solid dot's: both are 30% of the square across,
 * and border-box sizing puts the dashes inside that width rather than around it.
 */
const DOT_MOVE_LINE = 'rgba(33,150,243,0.9)';
const DOT_CAPTURE_LINE = 'rgba(220,60,60,0.9)';
const BLOCKED_DOT_BORDERS = {
  move: DOT_MOVE_LINE,
  capture: DOT_CAPTURE_LINE,
  // top right bottom left
  both: `${DOT_MOVE_LINE} ${DOT_CAPTURE_LINE} ${DOT_CAPTURE_LINE} ${DOT_MOVE_LINE}`,
};
// What the player can choose for those dots. The setting is per browser
// (useBlockedDotMode, helpers/blockedDotMode.js).
export const BLOCKED_DOT_MODES = ['pattern', 'first', 'off'];

export const blockedDotStyle = (type) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: '30%',
  aspectRatio: '1',
  translate: '-50% -50%',
  borderRadius: '50%',
  borderWidth: 'max(2px, 0.1em)',
  borderStyle: 'dashed',
  borderColor: BLOCKED_DOT_BORDERS[type] || BLOCKED_DOT_BORDERS.move,
  /*
   * Border colours are per SIDE, and on a circle the sides meet at the
   * diagonals - so "both" (left+top blue, right+bottom red) split diagonally.
   * Turned -45deg, the seams sit at the top and bottom: blue on the left, red
   * on the right, matching the solid half-and-half dot.
   */
  ...(type === 'both' ? { rotate: '-45deg' } : {}),
  background: 'none',
  boxSizing: 'border-box',
  // A faint dark edge, so the ring still reads over a white piece.
  filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))',
  pointerEvents: 'none',
  zIndex: 6,
});

/**
 * Pick the dot for one generated move. Moves produced without
 * forHoverDisplay carry no move/attack split, so they fall back to plain
 * move/capture exactly as before.
 */
/*
 * Step-by-step geometry, matching server/game-socket.js exactly.
 *
 * Which squares count as a step is a three-way choice: all eight neighbours,
 * orthogonal only (a NEGATIVE step value, kept from before this had a name), or
 * diagonal only (the *_no_orthogonal flag). The last two are mutually exclusive
 * and have to be - a piece excluding both would have no legal first step, since
 * a square's eight neighbours are four of each and nothing else.
 */
const STEP_DIRS_ALL = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const STEP_DIRS_ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STEP_DIRS_DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const stepDirections = (noDiagonal, noOrthogonal) => {
  if (noDiagonal) return STEP_DIRS_ORTHOGONAL;
  if (noOrthogonal) return STEP_DIRS_DIAGONAL;
  return STEP_DIRS_ALL;
};

/**
 * Could `maxSteps` steps cover (dx, dy) on an empty board?
 *   orthogonal only -> Manhattan distance
 *   diagonal only   -> Chebyshev distance AND dx+dy even, because a diagonal
 *                      step moves x and y together: half the board is out of
 *                      reach at any range
 *   all directions  -> Chebyshev distance
 */
export const stepInRange = (dx, dy, maxSteps, noDiagonal, noOrthogonal) => {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return false;
  if (noDiagonal) return adx + ady <= maxSteps;
  if (noOrthogonal) return ((adx + ady) % 2 === 0) && Math.max(adx, ady) <= maxSteps;
  return Math.max(adx, ady) <= maxSteps;
};

export const stepMoveNoOrthogonal = (piece) => !!(
  piece?.step_by_step_movement_no_orthogonal ?? piece?.step_movement_no_orthogonal
);

/* Without an explicit step capture range a piece captures the way it moves, so
   it inherits the movement setting there too. */
export const stepCaptureNoOrthogonal = (piece, hasExplicitCapture) => (hasExplicitCapture
  ? !!(piece?.step_by_step_capture_no_orthogonal ?? piece?.step_capture_no_orthogonal)
  : stepMoveNoOrthogonal(piece));

export const stepAttackNoOrthogonal = (piece) => !!(piece?.step_by_step_attack_no_orthogonal);

/*
 * The hop rules of a straight-line (directional) move or capture, as one rule:
 * at least `min` pieces hopped ("require hopping" is min 1), at most `max`, and,
 * after a hop, landing at most `landing` squares past the last piece hopped.
 * The xiangqi cannon captures over exactly one piece (attack min 1, max 1); the
 * grasshopper hops exactly one and lands right behind it (min 1, max 1,
 * landing 1). A MIRROR of straightHopRule in server/game-socket.js - the two
 * must agree.
 */
export const straightHopRule = (piece, attack) => {
  const field = (name) => piece?.[attack ? `${name}_attack` : name];
  const count = (v) => (Number(v) > 0 ? Math.min(8, Math.floor(Number(v))) : null);
  const hopOnly = field('directional_hop_only') === 1 || field('directional_hop_only') === true;
  const min = Math.max(count(field('min_directional_hop_pieces')) || 0, hopOnly ? 1 : 0);
  const max = count(field('max_directional_hop_pieces'));
  const landing = count(field('hop_landing_distance'));
  return { min, max, landing, active: min > 0 || max != null || landing != null };
};

/** Pieces strictly between two squares on a line, and how far past the last of them the end square is. */
export const straightHopsBetween = (fromX, fromY, toX, toY, isOccupied) => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy))) return { count: 0, beyond: null };
  const sX = Math.sign(dx);
  const sY = Math.sign(dy);
  let count = 0;
  let beyond = null;
  for (let x = fromX + sX, y = fromY + sY; x !== toX || y !== toY; x += sX, y += sY) {
    if (isOccupied(x, y)) { count++; beyond = 0; } else if (beyond !== null) beyond++;
  }
  return { count, beyond: beyond === null ? null : beyond + 1 };
};

export const hopRuleAllows = (rule, hops) => {
  if (hops.count < rule.min) return false;
  if (rule.max != null && hops.count > rule.max) return false;
  if (rule.landing != null && hops.count > 0 && hops.beyond > rule.landing) return false;
  return true;
};

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
 * A MIRROR of server/hop-rule.js - the two must agree.
 */
export const lPathRule = (piece, attack) => {
  const field = (name) => piece?.[attack ? `${name}_attack` : name];
  const order = ['long_first', 'short_first'].includes(field('ratio_path_order')) ? field('ratio_path_order') : 'either';
  const legs = ['long', 'short'].includes(field('ratio_path_blocking')) ? field('ratio_path_blocking') : 'both';
  const c = field('ratio_path_corner_blocks');
  const corner = c === null || c === undefined || c === '' ? true : (c === 1 || c === true || c === '1' || c === 'true');
  return { order, legs, corner, isDefault: order === 'either' && legs === 'both' && corner };
};

/** Is the L route from (fromX, fromY) by (dx, dy) open under `rule`? blocks(x, y) says whether a square stops it. */
export const lRouteClear = (fromX, fromY, dx, dy, rule, blocks) => {
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
};

export const getMoveDotType = (move) => {
  if (!move) return null;
  if (move.isCastling) return 'castle';
  if (move.isFirstMoveOnly) return 'first';
  if (move.reachedByMove && move.reachedByAttack) return 'both';
  if (move.reachedByAttack ?? move.isCapture) return 'capture';
  return 'move';
};

/**
 * Which indicator legend rows a given set of pieces can actually produce.
 * Pass every piece the board may show (for a replay, the starting line-up as
 * well as the current position) so an item does not disappear from the legend
 * the moment the only piece with that ability is captured.
 */
export const describeBoardIndicators = (pieces) => {
  const list = Array.isArray(pieces) ? pieces.filter(Boolean) : [];
  return {
    castle: list.some(p => p.can_castle),
    ranged: list.some(p => p.can_capture_enemy_via_range),
    attackRadius: list.some(p => (p.attack_radius || 0) > 0),
    dcVia: list.some(p => p.directional_movement_change || p.directional_capture_change),
  };
};

export const createMoveEngine = ({
  specialSquares = null,
  gameType = null,
  enPassantTarget = null,
  currentPlayerPosition = null,
} = {}) => {
  // Shims so the extracted rule code below reads exactly as it did in LiveGame.
  const gameState = { gameType, enPassantTarget };
  const currentPlayer = currentPlayerPosition != null ? { position: currentPlayerPosition } : null;

  // Helper function to check if a value allows movement at a distance
  const checkMovement = (value, distance, repeating = false, cap = Infinity) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null || value === undefined) return false;
    if (value > 0) return distance <= value; // Up to X squares
    if (value < 0) {
      const exact = Math.abs(value);
      if (repeating) return distance > 0 && distance % exact === 0 && distance <= exact * cap;
      return distance === exact; // Exact X squares
    }
    return false;
  };

  // Resolve a directional value + separate exact flag into the signed convention for checkMovement.
  // DB stores values as positive with a separate boolean _exact column.
  const resolveExact = (value, exactFlag) => {
    if (!value || value === 99) return value;
    if (exactFlag === true || exactFlag === 1) return -Math.abs(value);
    return value;
  };

  /*
   * An alternate movement or capture limited to the piece's first N moves,
   * once those are used. The server skips such an option outright
   * (getPossibleMovesForPiece, canPieceAttackSquare); here it must not count
   * either, or the hop-only re-check below takes a spent first-move slide as
   * the reason a jump needs no hop.
   */
  const alternateUsedUp = (option, pieceData) => {
    const moves = pieceData.moveCount || 0;
    return !!((option.availableForMoves && moves >= option.availableForMoves) || (option.firstMoveOnly && moves > 0));
  };

  // Check if a move is from a first-move-only additional movement option
  const checkIfFirstMoveOnlyMove = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_moves) return 0;
    
    try {
      const parsed = typeof pieceData.special_scenario_moves === 'string'
        ? JSON.parse(pieceData.special_scenario_moves)
        : pieceData.special_scenario_moves;
      const additionalMovements = parsed?.additionalMovements || {};
      
      const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
      const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);
      const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      // Determine direction
      let direction = null;
      if (rowDiff < 0 && colDiff === 0) direction = 'up';
      else if (rowDiff > 0 && colDiff === 0) direction = 'down';
      else if (rowDiff === 0 && colDiff < 0) direction = 'left';
      else if (rowDiff === 0 && colDiff > 0) direction = 'right';
      else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
      
      if (!direction || !additionalMovements[direction]) return 0;
      
      // Check if any of the additional movements for this direction have firstMoves/availableForMoves value
      for (const movementOption of additionalMovements[direction]) {
        // Support both firstMoves and availableForMoves fields
        const firstMoves = movementOption.firstMoves || movementOption.availableForMoves || 0;
        // Also check firstMoveOnly boolean for backwards compatibility
        const isFirstMoveOnly = movementOption.firstMoveOnly || false;
        
        if (firstMoves === 0 && !isFirstMoveOnly) continue;
        
        const value = movementOption.value || 0;
        const matchesMove = (movementOption.infinite && distance > 0) ||
                           (movementOption.exact && distance === value) ||
                           (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
        
        // CRITICAL: Only return firstMoves if this specific move matches AND the distance doesn't match the regular movement
        // For example, pawn's 1-square move should NOT be affected by the 2-square special scenario
        if (matchesMove && distance === value) {
          // Return the number of first moves allowed (or 1 if just firstMoveOnly flag is set)
          return firstMoves || (isFirstMoveOnly ? 1 : 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return 0;
  };

  // Check if a capture is from a first-move-only additional capture option
  const checkIfFirstMoveOnlyCapture = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_captures) return 0;
    
    try {
      const parsed = typeof pieceData.special_scenario_captures === 'string'
        ? JSON.parse(pieceData.special_scenario_captures)
        : pieceData.special_scenario_captures;
      const additionalCaptures = parsed?.additionalCaptures || {};
      
      const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
      const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);
      const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      // Determine direction
      let direction = null;
      if (rowDiff < 0 && colDiff === 0) direction = 'up';
      else if (rowDiff > 0 && colDiff === 0) direction = 'down';
      else if (rowDiff === 0 && colDiff < 0) direction = 'left';
      else if (rowDiff === 0 && colDiff > 0) direction = 'right';
      else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
      
      if (!direction || !additionalCaptures[direction]) return 0;
      
      // Check if any of the additional captures for this direction have firstMoves/availableForMoves value
      for (const captureOption of additionalCaptures[direction]) {
        // Support both firstMoves and availableForMoves fields
        const firstMoves = captureOption.firstMoves || captureOption.availableForMoves || 0;
        // Also check firstMoveOnly boolean for backwards compatibility
        const isFirstMoveOnly = captureOption.firstMoveOnly || false;
        
        if (firstMoves === 0 && !isFirstMoveOnly) continue;
        
        const value = captureOption.value || 0;
        const matchesCapture = (captureOption.infinite && distance > 0) ||
                              (captureOption.exact && distance === value) ||
                              (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value);
        
        // Only return firstMoves if this exact distance matches the special scenario value
        if (matchesCapture && distance === value) {
          // Return the number of first moves allowed (or 1 if just firstMoveOnly flag is set)
          return firstMoves || (isFirstMoveOnly ? 1 : 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return 0;
  };

  // Check if piece can move to a square (not capturing)
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceMoveTo = (fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false, skipCustom = false) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    if (!skipExactRatio) {
    const utilResult = canPieceMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    if (utilResult.allowed && !(skipCustom && utilResult.isCustomOnly)) {
      return true;
    }
    }

    // For player 2, flip the perspective (so "up" is towards player 1 and "left" is towards player 1's left)
    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check directional movement (value-only: active iff any direction value is non-zero)
    const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                  pieceData.left_movement || pieceData.right_movement ||
                                  pieceData.up_left_movement || pieceData.up_right_movement ||
                                  pieceData.down_left_movement || pieceData.down_right_movement;
    
    if (hasDirectionalValues) {
      let directionalAllowed = false;
      const rep = pieceData.repeating_movement;
      const capM = repeatCap(pieceData, false);

      // Check 8 directions
      if (rowDiff < 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.up_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_movement, pieceData.up_movement_exact), Math.abs(rowDiff), rep && pieceData.up_movement_exact, capM);
      } else if (rowDiff > 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.down_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_movement, pieceData.down_movement_exact), Math.abs(rowDiff), rep && pieceData.down_movement_exact, capM);
      } else if (rowDiff === 0 && colDiff < 0) {
        if (!(skipExactRatio && pieceData.left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.left_movement, pieceData.left_movement_exact), Math.abs(colDiff), rep && pieceData.left_movement_exact, capM);
      } else if (rowDiff === 0 && colDiff > 0) {
        if (!(skipExactRatio && pieceData.right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.right_movement, pieceData.right_movement_exact), Math.abs(colDiff), rep && pieceData.right_movement_exact, capM);
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_left_movement, pieceData.up_left_movement_exact), Math.abs(rowDiff), rep && pieceData.up_left_movement_exact, capM);
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_right_movement, pieceData.up_right_movement_exact), Math.abs(rowDiff), rep && pieceData.up_right_movement_exact, capM);
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_left_movement, pieceData.down_left_movement_exact), Math.abs(rowDiff), rep && pieceData.down_left_movement_exact, capM);
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_right_movement, pieceData.down_right_movement_exact), Math.abs(rowDiff), rep && pieceData.down_right_movement_exact, capM);
      }

      if (directionalAllowed) return true;
    }

    // Check ratio movement (L-shape like knight)
    if (!skipExactRatio) {
    const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
    const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
    
    if (ratio1 > 0 && ratio2 > 0) {
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      if (pieceData.repeating_ratio) {
        const maxK = pieceData.max_ratio_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            return true;
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          return true;
        }
      }
    }
    }

    // Check step-by-step movement
    const rawStepValue = pieceData.step_by_step_movement_value ?? pieceData.step_movement_value;
    const stepValue = Number(rawStepValue);
    if (!Number.isNaN(stepValue) && stepValue !== 0) {
      const maxSteps = Math.abs(stepValue);
      // Out of step range is not "cannot move there": alternate movements and
      // custom squares are still to be checked (the exact/ratio hop rule calls
      // this with the util skipped, and a custom square was lost here).
      if (stepInRange(colDiff, rowDiff, maxSteps, stepValue < 0, stepMoveNoOrthogonal(pieceData))) return true;
    }

    // Check additional movements from special_scenario_moves
    if (pieceData.special_scenario_moves) {
      try {
        const parsed = typeof pieceData.special_scenario_moves === 'string'
          ? JSON.parse(pieceData.special_scenario_moves)
          : pieceData.special_scenario_moves;
        const additionalMovements = parsed?.additionalMovements || {};
        
        const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        
        // Determine direction
        let direction = null;
        if (rowDiff < 0 && colDiff === 0) direction = 'up';
        else if (rowDiff > 0 && colDiff === 0) direction = 'down';
        else if (rowDiff === 0 && colDiff < 0) direction = 'left';
        else if (rowDiff === 0 && colDiff > 0) direction = 'right';
        else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
        else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
        else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
        else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
        
        if (direction && additionalMovements[direction]) {
          for (const movementOption of additionalMovements[direction]) {
            if (skipExactRatio && movementOption.exact) continue;
            if (alternateUsedUp(movementOption, pieceData)) continue;
            const value = movementOption.value || 0;
            const matches = (movementOption.infinite && distance > 0) ||
                           (movementOption.exact && distance === value) ||
                           (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
            if (matches) {
              return true;
            }
          }
        }
      } catch (e) {
        console.error('Error parsing special_scenario_moves:', e);
      }
    }

    // Check custom movement squares
    if (!skipCustom && pieceData.custom_movement_squares) {
      try {
        const customSquares = typeof pieceData.custom_movement_squares === 'string'
          ? JSON.parse(pieceData.custom_movement_squares)
          : pieceData.custom_movement_squares;
        if (Array.isArray(customSquares)) {
          for (const sq of customSquares) {
            if (rowDiff === sq.row && colDiff === sq.col) {
              return true;
            }
          }
        }
      } catch { /* ignore */ }
    }

    return false;
  };

  // Check if piece can capture on a square
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceCaptureTo = (fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false, skipCustom = false) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    if (!skipExactRatio) {
    const utilCaptureResult = canCaptureOnMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    if (utilCaptureResult.allowed && !(skipCustom && utilCaptureResult.isCustomOnly)) {
      return true;
    }
    }

    // For player 2, flip the perspective (mirror both row and column)
    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check if separate capture fields are defined
    const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                     pieceData.left_capture || pieceData.right_capture || 
                                     pieceData.up_left_capture || pieceData.up_right_capture ||
                                     pieceData.down_left_capture || pieceData.down_right_capture ||
                                     pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                     pieceData.step_capture_value ||
                                     pieceData.special_scenario_captures;

    // A directional capture column of 0 means "does not capture this way" and is a
    // real answer, not an unset value (matches server canPieceAttackSquare). Only
    // columns left NULL let a capture-on-move piece fall back to capturing along
    // its movement, so a movement-only token with every value 0 captures nothing.
    const directionalCaptureColsSet =
      pieceData.up_capture != null || pieceData.down_capture != null ||
      pieceData.left_capture != null || pieceData.right_capture != null ||
      pieceData.up_left_capture != null || pieceData.up_right_capture != null ||
      pieceData.down_left_capture != null || pieceData.down_right_capture != null;

    // If piece can capture on move AND no separate capture fields, use movement logic
    if ((pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) && !hasSeparateCaptureFields && !directionalCaptureColsSet) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio);
    }

    // Check directional capture - check if any capture fields have values
    const hasDirectionalCapture = pieceData.up_capture || pieceData.down_capture || pieceData.left_capture || 
                                   pieceData.right_capture || pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture;
    
    if (hasDirectionalCapture) {
      let directionalAllowed = false;
      const repC = pieceData.repeating_capture;
      const capC = repeatCap(pieceData, true);

      if (rowDiff < 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.up_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_capture, pieceData.up_capture_exact), Math.abs(rowDiff), repC && pieceData.up_capture_exact, capC);
      } else if (rowDiff > 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.down_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_capture, pieceData.down_capture_exact), Math.abs(rowDiff), repC && pieceData.down_capture_exact, capC);
      } else if (rowDiff === 0 && colDiff < 0) {
        if (!(skipExactRatio && pieceData.left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.left_capture, pieceData.left_capture_exact), Math.abs(colDiff), repC && pieceData.left_capture_exact, capC);
      } else if (rowDiff === 0 && colDiff > 0) {
        if (!(skipExactRatio && pieceData.right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.right_capture, pieceData.right_capture_exact), Math.abs(colDiff), repC && pieceData.right_capture_exact, capC);
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_left_capture, pieceData.up_left_capture_exact), Math.abs(rowDiff), repC && pieceData.up_left_capture_exact, capC);
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_right_capture, pieceData.up_right_capture_exact), Math.abs(rowDiff), repC && pieceData.up_right_capture_exact, capC);
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_left_capture, pieceData.down_left_capture_exact), Math.abs(rowDiff), repC && pieceData.down_left_capture_exact, capC);
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_right_capture, pieceData.down_right_capture_exact), Math.abs(rowDiff), repC && pieceData.down_right_capture_exact, capC);
      }

      if (directionalAllowed) return true;
    }

    // Check ratio capture (L-shape)
    if (!skipExactRatio) {
    const ratio1 = pieceData.ratio_capture_1 || 0;
    const ratio2 = pieceData.ratio_capture_2 || 0;
    if (ratio1 > 0 && ratio2 > 0) {
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      if (pieceData.repeating_ratio_capture) {
        const maxK = pieceData.max_ratio_capture_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_capture_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            return true;
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          return true;
        }
      }
    }
    }

    // Check step-by-step capture - use sign-based diagonal exclusion
    const rawStepCaptureValue = pieceData.step_capture_value ?? pieceData.step_by_step_capture;
    const stepCaptureValue = Number(rawStepCaptureValue);
    if (!Number.isNaN(stepCaptureValue) && stepCaptureValue !== 0) {
      const maxSteps = Math.abs(stepCaptureValue);
      // An explicit step capture range carries its own exclusion; without one
      // the piece captures the way it moves.
      const hasExplicitCapture = pieceData.step_capture_value != null && pieceData.step_capture_value !== 0;
      // As for movement: out of step range, the other capture patterns still count.
      if (stepInRange(colDiff, rowDiff, maxSteps, stepCaptureValue < 0,
        stepCaptureNoOrthogonal(pieceData, hasExplicitCapture))) return true;
    }

    // Check additional captures from special_scenario_captures
    if (pieceData.special_scenario_captures) {
      try {
        const parsed = typeof pieceData.special_scenario_captures === 'string'
          ? JSON.parse(pieceData.special_scenario_captures)
          : pieceData.special_scenario_captures;
        const additionalCaptures = parsed?.additionalCaptures || {};
        
        const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        
        // Determine direction
        let direction = null;
        if (rowDiff < 0 && colDiff === 0) direction = 'up';
        else if (rowDiff > 0 && colDiff === 0) direction = 'down';
        else if (rowDiff === 0 && colDiff < 0) direction = 'left';
        else if (rowDiff === 0 && colDiff > 0) direction = 'right';
        else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
        else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
        else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
        else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
        
        if (direction && additionalCaptures[direction]) {
          for (const captureOption of additionalCaptures[direction]) {
            if (skipExactRatio && captureOption.exact) continue;
            if (alternateUsedUp(captureOption, pieceData)) continue;
            const value = captureOption.value || 0;
            if (captureOption.infinite && distance > 0) return true;
            if (captureOption.exact && distance === value) return true;
            if (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value) return true;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    // If piece can capture where it moves AND has no separate capture fields, also check movement as fallback
    if ((pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) && !hasSeparateCaptureFields && !directionalCaptureColsSet) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio, skipCustom);
    }

    // Check custom attack squares
    if (!skipCustom && pieceData.custom_attack_squares) {
      try {
        const customSquares = typeof pieceData.custom_attack_squares === 'string'
          ? JSON.parse(pieceData.custom_attack_squares)
          : pieceData.custom_attack_squares;
        if (Array.isArray(customSquares)) {
          for (const sq of customSquares) {
            if (rowDiff === sq.row && colDiff === sq.col) {
              return true;
            }
          }
        }
      } catch { /* ignore */ }
    }

    return false;
  };

  /*
   * Does an EXACT directional pattern - a fixed-distance jump, base or
   * alternate - reach the square (dx, dy) away? directional_hop_disabled only
   * switches hopping off for non-exact (sliding) directional moves, as the
   * wizard says; exact ones still hop, in the server's move walks and in its
   * final capture check (canPieceAttackSquare). Directions are named from the
   * owner's side, as canPieceMoveTo names them.
   */
  const reachesByExactDirection = (pieceData, dx, dy, isCapture) => {
    const team = pieceData?.player_id || pieceData?.team;
    const rd = team === 2 ? -dy : dy;
    const cd = team === 2 ? -dx : dx;
    if (!(rd === 0 || cd === 0 || Math.abs(rd) === Math.abs(cd))) return false;
    const dir = [rd < 0 ? 'up' : rd > 0 ? 'down' : '', cd < 0 ? 'left' : cd > 0 ? 'right' : ''].filter(Boolean).join('_');
    if (!dir) return false;
    const dist = Math.max(Math.abs(rd), Math.abs(cd));
    // A capture may also come from the movement pattern (the server's final
    // check reads the movement's exact flag for a capture-on-move piece).
    const kinds = isCapture
      ? (pieceData.can_capture_enemy_on_move ? ['capture', 'movement'] : ['capture'])
      : ['movement'];
    for (const kind of kinds) {
      const v = Math.abs(Number(pieceData[`${dir}_${kind}`]) || 0);
      if (v > 0 && v !== 99 && pieceData[`${dir}_${kind}_exact`]) {
        if (pieceData[`repeating_${kind}`] ? dist % v === 0 : dist === v) return true;
      }
      const special = kind === 'capture'
        ? parseSpecialScenarioCaptures(pieceData.special_scenario_captures).additionalCaptures
        : parseSpecialScenarioMoves(pieceData.special_scenario_moves).additionalMovements;
      const options = special?.[dir];
      if (Array.isArray(options) && options.some((o) => o.exact && !o.infinite && Math.abs(o.value || 0) === dist)) return true;
    }
    return false;
  };

  // Check if path is clear for sliding pieces (no pieces in between)
  const isPathClear = (fromX, fromY, toX, toY, pieces, pieceData, isCapture = false) => {
    // Ghostwalk: piece can pass through any piece
    const hasGhostwalk = pieceData?.ghostwalk === 1 || pieceData?.ghostwalk === true;
    if (hasGhostwalk) return true;

    const pieceTeam = pieceData?.player_id || pieceData?.team;
    // Hopping switched off for directional moves still applies to sliding ones only.
    const hopDisabledHere = (flag) => (flag === 1 || flag === true)
      && !reachesByExactDirection(pieceData, toX - fromX, toY - fromY, isCapture);
    let canHopAllies, canHopEnemies;
    if (isCapture) {
      const dirHopDisabledAtk = hopDisabledHere(pieceData?.directional_hop_disabled_attack);
      canHopAllies = !dirHopDisabledAtk && (pieceData?.can_hop_attack_over_allies === 1 || pieceData?.can_hop_attack_over_allies === true);
      canHopEnemies = !dirHopDisabledAtk && (pieceData?.can_hop_attack_over_enemies === 1 || pieceData?.can_hop_attack_over_enemies === true);
    } else {
      const directionalHopDisabled = hopDisabledHere(pieceData?.directional_hop_disabled);
      canHopAllies = !directionalHopDisabled && (pieceData?.can_hop_over_allies === 1 || pieceData?.can_hop_over_allies === true);
      canHopEnemies = !directionalHopDisabled && (pieceData?.can_hop_over_enemies === 1 || pieceData?.can_hop_over_enemies === true);
    }

    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // Check if it's a knight-like move (L-shape)
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      return true;
    }

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      const blockingPiece = findPieceAtSquare(pieces, x, y);
      // A multi-tile piece's own squares are never in its way: moving right or
      // down, each sub-square's path runs through squares the piece covers.
      if (blockingPiece && blockingPiece.id !== pieceData?.id) {
        const blockingTeam = blockingPiece.player_id || blockingPiece.team;
        const isAlly = blockingTeam === pieceTeam;
        
        if (isAlly && !canHopAllies) return false;
        if (!isAlly && !canHopEnemies) return false;
      }
      x += dx;
      y += dy;
    }

    return true;
  };

  // Helper to check both possible L-shaped paths
  const checkBothLPaths = (fromX, fromY, dx, dy, absDx, absDy, pieces, canHopOver) => {
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const targetX = fromX + dx;
    const targetY = fromY + dy;
    
    // Path 1: Move along X axis first, then Y axis
    let path1Clear = true;
    // Move along X
    for (let i = 1; i <= absDx; i++) {
      const checkX = fromX + (stepX * i);
      const checkY = fromY;
      if (checkX !== targetX || checkY !== targetY) {
        const obstruction = findPieceAtSquare(pieces, checkX, checkY);
        if (obstruction && !canHopOver(obstruction)) {
          path1Clear = false;
          break;
        }
      }
    }
    // Then move along Y from the end of X movement
    if (path1Clear) {
      for (let i = 1; i <= absDy; i++) {
        const checkX = fromX + (stepX * absDx);
        const checkY = fromY + (stepY * i);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = findPieceAtSquare(pieces, checkX, checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path1Clear = false;
            break;
          }
        }
      }
    }
    
    // Path 2: Move along Y axis first, then X axis
    let path2Clear = true;
    // Move along Y
    for (let i = 1; i <= absDy; i++) {
      const checkX = fromX;
      const checkY = fromY + (stepY * i);
      if (checkX !== targetX || checkY !== targetY) {
        const obstruction = findPieceAtSquare(pieces, checkX, checkY);
        if (obstruction && !canHopOver(obstruction)) {
          path2Clear = false;
          break;
        }
      }
    }
    // Then move along X from the end of Y movement
    if (path2Clear) {
      for (let i = 1; i <= absDx; i++) {
        const checkX = fromX + (stepX * i);
        const checkY = fromY + (stepY * absDy);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = findPieceAtSquare(pieces, checkX, checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path2Clear = false;
            break;
          }
        }
      }
    }
    
    return path1Clear || path2Clear;
  };

  // Check if L-shape path is clear considering hopping abilities
  /**
   * Is there an L route a multi-tile piece can take with its whole footprint?
   *
   * A ratio (knight-shaped) move of (dx, dy) goes one way first and then the
   * other. The whole piece takes the same route, so every one of its squares
   * travels a parallel L, and the move is open when, for either order, none of
   * those Ls crosses a piece `canPass` refuses. The piece's own squares never
   * obstruct, and the landing footprint is judged as the destination, not as
   * the path.
   */
  const footprintLRouteClear = (piece, dx, dy, pieces, canPass) => {
    const w = piece.piece_width || 1;
    const h = piece.piece_height || 1;
    const toX = piece.x + dx;
    const toY = piece.y + dy;
    const sX = Math.sign(dx);
    const sY = Math.sign(dy);
    const inLanding = (x, y) => x >= toX && x < toX + w && y >= toY && y < toY + h;
    const blocked = (x, y) => {
      if (inLanding(x, y)) return false;
      const p = findPieceAtSquare(pieces, x, y);
      return !!p && p.id !== piece.id && !canPass(p);
    };
    const routeClear = (xFirst) => {
      for (let fy = 0; fy < h; fy++) {
        for (let fx = 0; fx < w; fx++) {
          let x = piece.x + fx;
          let y = piece.y + fy;
          const legs = xFirst ? [[sX, 0, Math.abs(dx)], [0, sY, Math.abs(dy)]] : [[0, sY, Math.abs(dy)], [sX, 0, Math.abs(dx)]];
          for (const [lx, ly, n] of legs) {
            for (let i = 0; i < n; i++) {
              x += lx;
              y += ly;
              if (blocked(x, y)) return false;
            }
          }
        }
      }
      return true;
    };
    return routeClear(true) || routeClear(false);
  };

  /*
   * A rider of L-jumps (a nightrider) attacking a square several jumps away:
   * stopped by a piece standing ON an earlier landing when it stops at occupied
   * landings, and always by an enemy there (it would take that one instead).
   * The server's final check (canPieceAttackSquare) holds it to the same.
   */
  const ratioLandingBlocked = (piece, targetX, targetY, pieces) => {
    const dx = targetX - piece.x;
    const dy = targetY - piece.y;
    const r1 = piece.ratio_capture_1 || piece.ratio_movement_1 || 0;
    const r2 = piece.ratio_capture_2 || piece.ratio_movement_2 || 0;
    if (!(r1 > 0 && r2 > 0)) return false;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let k = 0;
    if (adx % r1 === 0 && ady % r2 === 0 && adx / r1 === ady / r2) k = adx / r1;
    else if (adx % r2 === 0 && ady % r1 === 0 && adx / r2 === ady / r1) k = adx / r2;
    if (k < 2) return false;
    const owner = piece.player_id || piece.team;
    const stopsAtAny = [piece.hop_stop_at_occupied_attack, piece.hop_stop_at_occupied].some((v) => v === 1 || v === true);
    for (let i = 1; i < k; i++) {
      const there = findPieceAtSquare(pieces, piece.x + (dx / k) * i, piece.y + (dy / k) * i);
      if (there && there.id !== piece.id && (stopsAtAny || (there.player_id || there.team) !== owner)) return true;
    }
    return false;
  };

  const checkRatioPathClear = (piece, targetX, targetY, pieces, attack = false) => {
    const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
    const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
    const hasGhostwalk = piece.ghostwalk === 1 || piece.ghostwalk === true;
    
    // If ghostwalk or can hop over everything, path is always clear
    if (hasGhostwalk || (canHopAllies && canHopEnemies)) {
      return true;
    }
    
    const pieceOwner = piece.player_id || piece.team;
    const dx = targetX - piece.x;
    const dy = targetY - piece.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // A multi-tile piece takes one L route with its whole footprint.
    if ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) {
      return footprintLRouteClear(piece, dx, dy, pieces, (p) => {
        const ally = (p.player_id || p.team) === pieceOwner;
        return ally ? canHopAllies : canHopEnemies;
      });
    }
    
    // The piece's own L-path rule (lPathRule): its route and legs alone decide.
    const lRule = lPathRule(piece, attack);
    if (!lRule.isDefault) {
      return lRouteClear(piece.x, piece.y, dx, dy, lRule, (cx, cy) => {
        const o = findPieceAtSquare(pieces, cx, cy);
        if (!o || o.id === piece.id) return false;
        return !((o.player_id || o.team) === pieceOwner ? canHopAllies : canHopEnemies);
      });
    }

    // If no hopping ability, check if both L-shape paths are clear
    if (!canHopAllies && !canHopEnemies) {
      return checkBothLPaths(piece.x, piece.y, dx, dy, absDx, absDy, pieces, () => false);
    }
    
    // Helper to check if piece can hop over an obstruction
    const canHopOver = (obstruction) => {
      const obstructionOwner = obstruction.player_id || obstruction.team;
      const isAlly = obstructionOwner === pieceOwner;
      return (isAlly && canHopAllies) || (!isAlly && canHopEnemies);
    };
    
    return checkBothLPaths(piece.x, piece.y, dx, dy, absDx, absDy, pieces, canHopOver);
  };

  const getStepMovementConfig = (piece) => {
    const stepValueRaw = piece?.step_by_step_movement_value ?? piece?.step_movement_value;
    const stepValue = Number(stepValueRaw);
    if (Number.isNaN(stepValue) || stepValue === 0) {
      return null;
    }

    return {
      maxSteps: Math.abs(stepValue),
      noDiagonal: stepValue < 0,
      noOrthogonal: stepMoveNoOrthogonal(piece),
    };
  };

  const isStepByStepTarget = (piece, fromX, fromY, toX, toY) => {
    const config = getStepMovementConfig(piece);
    if (!config) {
      return false;
    }

    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    if (dx === 0 && dy === 0) {
      return false;
    }

    return stepInRange(dx, dy, config.maxSteps, config.noDiagonal, config.noOrthogonal);
  };

  /*
   * The step-by-step CAPTURE range, read as canPieceCaptureTo reads it. A
   * capture inside it is reached the way the server's final capture check
   * (canPieceAttackSquare) reaches it: a walk through empty squares, by the
   * capture range and directions, not the movement's.
   */
  const getStepCaptureConfig = (piece) => {
    const raw = piece?.step_capture_value ?? piece?.step_by_step_capture;
    const value = Number(raw);
    if (raw == null || Number.isNaN(value) || value === 0) return null;
    const hasExplicitCapture = piece.step_capture_value != null && piece.step_capture_value !== 0;
    return {
      maxSteps: Math.abs(value),
      noDiagonal: value < 0,
      noOrthogonal: stepCaptureNoOrthogonal(piece, hasExplicitCapture),
    };
  };

  /*
   * A capture's path where the step capture range covers the square: the walk,
   * or else - on a straight line - the straight path another pattern found.
   * Off a line, a straight-line check is no check at all (isPathClear passes
   * any non-line square), so a step capture boxed in by pieces was offered.
   * Returns { clear, walked }: walked when the step walk itself reached the
   * square, which frees it from the directional hop rules, as on the server.
   * When step capture does not cover the square, the given result stands.
   */
  const stepCapturePathClear = (piece, toX, toY, pieces, boardWidth, boardHeight, straightClear) => {
    const config = getStepCaptureConfig(piece);
    const dx = toX - piece.x;
    const dy = toY - piece.y;
    const unchanged = { clear: straightClear, walked: false };
    if (!config || !stepInRange(dx, dy, config.maxSteps, config.noDiagonal, config.noOrthogonal)) return unchanged;
    // A multi-tile piece's step walk is not modelled square by square here.
    if ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) return unchanged;
    if (canReachStepByStep(piece, toX, toY, pieces, boardWidth, boardHeight, true, config)) return { clear: true, walked: true };
    const onLine = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    return { clear: onLine && straightClear, walked: false };
  };

  // Is (dx, dy) one of the piece's custom attack squares (mirrored for player 2)?
  const isCustomAttackOffset = (piece, dx, dy) => {
    try {
      const raw = piece.custom_attack_squares;
      const squares = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(squares)) return false;
      const flip = (piece.player_id || piece.team) === 2 ? -1 : 1;
      return squares.some((sq) => sq.row * flip === dy && sq.col * flip === dx);
    } catch { return false; }
  };

  const canReachStepByStep = (piece, targetX, targetY, pieces, boardWidth, boardHeight, allowOccupiedTarget = false, config = getStepMovementConfig(piece)) => {
    if (!config) {
      return false;
    }

    const hasGhostwalk = piece.ghostwalk === 1 || piece.ghostwalk === true;

    const occupied = new Set();
    if (!hasGhostwalk) {
      pieces.filter(p => p.id !== piece.id).forEach(p => {
        const pw = p.piece_width || 1;
        const ph = p.piece_height || 1;
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            occupied.add(`${p.x + dx},${p.y + dy}`);
          }
        }
      });
    }

    const queue = [{ x: piece.x, y: piece.y, steps: 0 }];
    const visited = new Set([`${piece.x},${piece.y}`]);
    const directions = stepDirections(config.noDiagonal, config.noOrthogonal);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.steps >= config.maxSteps) {
        continue;
      }

      for (const [dirX, dirY] of directions) {
        const nextX = current.x + dirX;
        const nextY = current.y + dirY;

        if (nextX < 0 || nextY < 0 || nextX >= boardWidth || nextY >= boardHeight) {
          continue;
        }

        const isTarget = nextX === targetX && nextY === targetY;
        const nextKey = `${nextX},${nextY}`;
        const hasPiece = occupied.has(nextKey);

        if (hasPiece && !(allowOccupiedTarget && isTarget)) {
          continue;
        }

        if (isTarget) {
          return true;
        }

        if (visited.has(nextKey)) {
          continue;
        }

        visited.add(nextKey);
        queue.push({ x: nextX, y: nextY, steps: current.steps + 1 });
      }
    }

    return false;
  };

  // BFS path-finding for step-by-step ranged attacks.
  // Respects can_fire_over_allies / can_fire_over_enemies so walls of pieces
  // correctly block the projectile.
  const canReachStepByStepRanged = (piece, targetX, targetY, allPieces, boardWidth, boardHeight) => {
    const stepAttackValue = piece.step_by_step_attack_range;
    if (!stepAttackValue) return false;
    const maxSteps = Math.abs(stepAttackValue);
    const noDiagonal = stepAttackValue < 0;
    const noOrthogonal = stepAttackNoOrthogonal(piece);
    const canFireOverAllies = piece.can_fire_over_allies === 1 || piece.can_fire_over_allies === true;
    const canFireOverEnemies = piece.can_fire_over_enemies === 1 || piece.can_fire_over_enemies === true;
    const pieceTeam = piece.player_id || piece.team;
    const directions = stepDirections(noDiagonal, noOrthogonal);
    const queue = [{ x: piece.x, y: piece.y, steps: 0 }];
    const visited = new Set([`${piece.x},${piece.y}`]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.steps >= maxSteps) continue;
      for (const [dirX, dirY] of directions) {
        const nx = current.x + dirX;
        const ny = current.y + dirY;
        if (nx < 0 || ny < 0 || nx >= boardWidth || ny >= boardHeight) continue;
        const isTarget = nx === targetX && ny === targetY;
        const nextKey = `${nx},${ny}`;
        const pieceAtSquare = findPieceAtSquare(allPieces, nx, ny);
        const squareTeam = pieceAtSquare?.player_id || pieceAtSquare?.team;
        const isAlly = pieceAtSquare && squareTeam === pieceTeam;
        const isEnemy = pieceAtSquare && squareTeam !== pieceTeam;
        if (isAlly) {
          // Ally blocks unless can fire over allies
          if (canFireOverAllies && !visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({ x: nx, y: ny, steps: current.steps + 1 });
          }
          // Ally squares are never valid targets
        } else if (isEnemy) {
          // Enemy: always a valid target; can continue BFS only if can fire over enemies
          if (isTarget) return true;
          if (canFireOverEnemies && !visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({ x: nx, y: ny, steps: current.steps + 1 });
          }
        } else {
          // Empty square: valid target (for hover/premove display); always traversable
          if (isTarget) return true;
          if (!visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({ x: nx, y: ny, steps: current.steps + 1 });
          }
        }
      }
    }
    return false;
  };

  // Apply range square bonus to a piece: +1 to all non-infinite, non-zero movement/capture/attack values
  const applyRangeSquareBonus = (piece) => {
    const rangeSquares = specialSquares?.range;
    if (!rangeSquares || Object.keys(rangeSquares).length === 0) return piece;

    const key = `${piece.y},${piece.x}`;
    if (!rangeSquares[key]) return piece;

    const bonus = rangeSquares[key].rangeBonus || 1;
    const boosted = { ...piece };

    const boost = (val) => {
      if (!val || val === 0 || val === 99) return val;
      if (val < 0) return val - bonus;
      return val + bonus;
    };

    const directions = ['up', 'down', 'left', 'right', 'up_left', 'up_right', 'down_left', 'down_right'];
    for (const dir of directions) {
      if (boosted[`${dir}_movement`]) boosted[`${dir}_movement`] = boost(boosted[`${dir}_movement`]);
      if (boosted[`${dir}_capture`]) boosted[`${dir}_capture`] = boost(boosted[`${dir}_capture`]);
      if (boosted[`${dir}_attack_range`]) boosted[`${dir}_attack_range`] = boost(boosted[`${dir}_attack_range`]);
    }

    if (boosted.step_by_step_movement_value) boosted.step_by_step_movement_value = boost(boosted.step_by_step_movement_value);
    if (boosted.step_movement_value) boosted.step_movement_value = boost(boosted.step_movement_value);
    if (boosted.step_capture_value) boosted.step_capture_value = boost(boosted.step_capture_value);
    if (boosted.step_by_step_attack_range) boosted.step_by_step_attack_range = boost(boosted.step_by_step_attack_range);

    if (boosted.ratio_movement_1) boosted.ratio_movement_1 = boost(boosted.ratio_movement_1);
    if (boosted.ratio_movement_2) boosted.ratio_movement_2 = boost(boosted.ratio_movement_2);
    if (boosted.ratio_one_attack_range) boosted.ratio_one_attack_range = boost(boosted.ratio_one_attack_range);
    if (boosted.ratio_two_attack_range) boosted.ratio_two_attack_range = boost(boosted.ratio_two_attack_range);

    if (boosted.special_scenario_moves) {
      try {
        const parsed = typeof boosted.special_scenario_moves === 'string'
          ? JSON.parse(boosted.special_scenario_moves)
          : { ...boosted.special_scenario_moves };
        if (parsed.additionalMovements) {
          const boostedMoves = {};
          for (const [dir, moveOptions] of Object.entries(parsed.additionalMovements)) {
            boostedMoves[dir] = moveOptions.map(opt => {
              if (opt.infinite || !opt.value) return opt;
              return { ...opt, value: opt.value + bonus };
            });
          }
          parsed.additionalMovements = boostedMoves;
        }
        if (parsed.additionalCaptures) {
          const boostedCaptures = {};
          for (const [dir, captureOptions] of Object.entries(parsed.additionalCaptures)) {
            boostedCaptures[dir] = captureOptions.map(opt => {
              if (opt.infinite || !opt.value) return opt;
              return { ...opt, value: opt.value + bonus };
            });
          }
          parsed.additionalCaptures = boostedCaptures;
        }
        boosted.special_scenario_moves = typeof piece.special_scenario_moves === 'string'
          ? JSON.stringify(parsed) : parsed;
        boosted.special_scenario_captures = typeof piece.special_scenario_captures === 'string'
          ? JSON.stringify(parsed) : parsed;
      } catch (e) { /* ignore */ }
    }

    return boosted;
  };

  // Check if a specific piece is under attack by any enemy piece
  /*
   * The board a piece's PATHS are walked on (movePaths.js - the server's own
   * code, server/move-paths.js; its pathBoard is this). A large piece must
   * fit, and meets whatever stands under its footprint, a piece it cannot take
   * outranking one it could. Impassable squares block (not for ghostwalk).
   * asIfEmpty: squares to treat as free (blocked-target queries).
   */
  const pathBoard = (piece, pieces, boardWidth, boardHeight, { potential = false, asIfEmpty = null } = {}) => {
    const w = piece.piece_width || 1;
    const h = piece.piece_height || 1;
    const owner = piece.player_id || piece.team;
    const others = pieces.filter((p) => p.id !== piece.id);
    const ghost = piece.ghostwalk === 1 || piece.ghostwalk === true;
    const special = specialSquares?.special || {};
    const rank = (p) => ((p.player_id || p.team) === owner ? 0 : p.cannot_be_captured ? 1 : p.ends_game_on_checkmate ? 2 : 3);
    const pieceAt = (x, y) => {
      if (asIfEmpty && asIfEmpty.has(`${x},${y}`)) return null;
      if (w === 1 && h === 1) return findPieceAtSquare(others, x, y) || null;
      const found = [];
      for (let fy = 0; fy < h; fy++) {
        for (let fx = 0; fx < w; fx++) {
          const p = findPieceAtSquare(others, x + fx, y + fy);
          if (p && !found.includes(p)) found.push(p);
        }
      }
      return found.sort((a, b) => rank(a) - rank(b))[0] || null;
    };
    const blocked = ghost ? null : (x, y) => {
      if (asIfEmpty && asIfEmpty.has(`${x},${y}`)) return false;
      for (let fy = 0; fy < h; fy++) for (let fx = 0; fx < w; fx++) if (special[`${y + fy},${x + fx}`]?.impassable) return true;
      return false;
    };
    return {
      flip: owner === 2,
      inside: (x, y) => doesPieceFitOnBoard(x, y, w, h, boardWidth, boardHeight),
      pieceAt,
      isAlly: (p) => (p.player_id || p.team) === owner,
      blocked,
      ghost,
      potential,
    };
  };

  const isPieceUnderAttack = (targetPiece, pieces, boardWidth, boardHeight) => {
    if (targetPiece.cannot_be_captured) return false;
    const targetTeam = targetPiece.player_id || targetPiece.team;
    const tw = targetPiece.piece_width || 1;
    const th = targetPiece.piece_height || 1;
    
    // Check all enemy pieces against ALL occupied squares of the target -
    // each also as it moves on a first move, while that applies (firstMove.js).
    const attackers = pieces.flatMap((p) => { const v = firstMoveVariant(p); return v ? [p, v] : [p]; });
    for (let enemyPiece of attackers) {
      const enemyTeam = enemyPiece.player_id || enemyPiece.team;
      if (enemyTeam === targetTeam) continue; // Skip friendly pieces
      
      // Apply range square bonus to attacking piece
      enemyPiece = applyRangeSquareBonus(enemyPiece);
      
      const ew = enemyPiece.piece_width || 1;
      const eh = enemyPiece.piece_height || 1;
      // Its paths (movePaths.js), as the server's canPieceAttackSquare reads them.
      const pathBoardE = hasPaths(enemyPiece) ? pathBoard(enemyPiece, pieces, boardWidth, boardHeight) : null;
      
      // For multi-tile target, check each occupied square
      for (let dy = 0; dy < th; dy++) {
        for (let dx = 0; dx < tw; dx++) {
          const sx = targetPiece.x + dx;
          const sy = targetPiece.y + dy;
          
          // For multi-tile attackers, check all anchor destinations that put (sx, sy) in footprint
          for (let edy = 0; edy < eh; edy++) {
            for (let edx = 0; edx < ew; edx++) {
              const adx = sx - edx; // potential anchor destination x
              const ady = sy - edy; // potential anchor destination y
              if (pathBoardE && pathAttacks(enemyPiece, adx, ady, pathBoardE)) return true;
              
              if (canPieceCaptureTo(enemyPiece.x, enemyPiece.y, adx, ady, enemyPiece, enemyTeam)) {
                const isRatioMove = enemyPiece.ratio_capture_1 > 0 && enemyPiece.ratio_capture_2 > 0 &&
                                   ((Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_capture_1 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_capture_2) ||
                                    (Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_capture_2 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_capture_1));
                
                const usesRatioForCapture = !isRatioMove && enemyPiece.attacks_like_movement && 
                                             enemyPiece.ratio_movement_1 > 0 && enemyPiece.ratio_movement_2 > 0 &&
                                             ((Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_movement_1 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_movement_2) ||
                                              (Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_movement_2 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_movement_1));
                
                const isStepMove = isStepByStepTarget(enemyPiece, enemyPiece.x, enemyPiece.y, adx, ady);

                // A custom attack square is a jump: nothing in between blocks it.
                // It was path-checked like a slide, so a dabbaba or alfil leap
                // never gave check over a piece in the way - the server's final
                // check (canPieceAttackSquare) says it does.
                if (isCustomAttackOffset(enemyPiece, adx - enemyPiece.x, ady - enemyPiece.y)) return true;
                let pathClear = false;
                if (isRatioMove || usesRatioForCapture) {
                  pathClear = checkRatioPathClear(enemyPiece, adx, ady, pieces, true);
                } else if (isStepMove) {
                  pathClear = canReachStepByStep(enemyPiece, adx, ady, pieces, boardWidth, boardHeight, true);
                } else {
                  pathClear = isPathClear(enemyPiece.x, enemyPiece.y, adx, ady, pieces, enemyPiece, true);
                }
                if (!isRatioMove && !usesRatioForCapture && !isCustomAttackOffset(enemyPiece, adx - enemyPiece.x, ady - enemyPiece.y)) {
                  pathClear = stepCapturePathClear(enemyPiece, adx, ady, pieces, boardWidth, boardHeight, pathClear).clear;
                  /*
                   * The straight-line hop rule for captures: a cannon gives
                   * check only over its screen, a grasshopper only from right
                   * behind its hurdle. Ignored here before, so a cannon with
                   * an open line to the king "checked" it.
                   */
                  if (pathClear && !isStepMove
                      && (enemyPiece.hop_stop_at_occupied === 1 || enemyPiece.hop_stop_at_occupied === true)
                      && exactLandingBlocked(enemyPiece, adx, ady, pieces, true)) {
                    pathClear = false;
                  }
                  const hopRule = straightHopRule(enemyPiece, true);
                  if (pathClear && hopRule.active && !isStepMove) {
                    const occupied = (cx, cy) => pieces.some((q) => q.id !== enemyPiece.id && doesPieceOccupySquare(q, cx, cy));
                    pathClear = hopRuleAllows(hopRule, straightHopsBetween(enemyPiece.x, enemyPiece.y, adx, ady, occupied));
                  }
                }
                
                // Several L-jumps away (a nightrider): not past a piece on an
                // earlier landing. Single jumps are untouched (ratioLandingBlocked).
                if (pathClear && ratioLandingBlocked(enemyPiece, adx, ady, pieces)) pathClear = false;
                if (pathClear) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  };

  // Check if a player is in check (any piece with ends_game_on_checkmate is under attack)
  /*
   * A straight line of exact jumps (a dabbaba rider, Betza DD) with
   * hop_stop_at_occupied: it hops whatever lies between its landings, but a
   * piece standing ON a landing ends the line there - as the server's walk
   * stops at it. True when such a piece sits on a landing short of (toX, toY).
   * Used for moves and for check detection alike.
   */
  const exactLandingBlocked = (piece, toX, toY, pieces, isCapture) => {
    const rowD = toY - piece.y;
    const colD = toX - piece.x;
    if (!(rowD === 0 || colD === 0 || Math.abs(rowD) === Math.abs(colD))) return false;
    // Directions are named from the owner's side, as canPieceMoveTo names them.
    const team = piece.player_id || piece.team;
    const rd = team === 2 ? -rowD : rowD;
    const cd = team === 2 ? -colD : colD;
    const dir = [rd < 0 ? 'up' : rd > 0 ? 'down' : '', cd < 0 ? 'left' : cd > 0 ? 'right' : ''].filter(Boolean).join('_');
    const exactStep = (kind) => (piece[`${dir}_${kind}_exact`] && piece[`repeating_${kind}`]
      ? Math.abs(Number(piece[`${dir}_${kind}`]) || 0) : 0);
    const step = (isCapture && exactStep('capture')) || exactStep('movement');
    const dist = Math.max(Math.abs(rowD), Math.abs(colD));
    if (!(step > 0 && dist % step === 0)) return false;
    const sx = Math.sign(colD);
    const sy = Math.sign(rowD);
    for (let k = step; k < dist; k += step) {
      const blocking = findPieceAtSquare(pieces, piece.x + sx * k, piece.y + sy * k);
      if (blocking && blocking.id !== piece.id) return true;
    }
    return false;
  };

  const checkForCheck = (pieces, playerPosition, boardWidth, boardHeight) => {
    // Find all pieces belonging to this player that have ends_game_on_checkmate
    const checkmatePieces = pieces.filter(p => {
      const pieceOwnerPosition = p.team || p.player_id;
      return pieceOwnerPosition === playerPosition && p.ends_game_on_checkmate;
    });
    
    if (checkmatePieces.length === 0) {
      return { inCheck: false, checkedPieces: [] };
    }
    
    const checkedPieces = [];
    for (const piece of checkmatePieces) {
      if (isPieceUnderAttack(piece, pieces, boardWidth, boardHeight)) {
        checkedPieces.push(piece);
      }
    }
    
    return {
      inCheck: checkedPieces.length > 0,
      checkedPieces
    };
  };

  // Check if a move would resolve check (or not leave the player in check)
  // Apply a move to a copy of the board: captures everything enemy in the
  // destination footprint, then relocates the mover.
  const simulateMove = (piece, toX, toY, pieces) => {
    // Create a simulated pieces array
    const simulatedPieces = pieces.map(p => ({ ...p }));

    // Find and remove ALL enemy pieces in the destination footprint (multi-tile captures all)
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    const pieceOwner = piece.player_id || piece.team;
    const capturedIds = new Set();
    if (pw > 1 || ph > 1) {
      for (let fdy = 0; fdy < ph; fdy++) {
        for (let fdx = 0; fdx < pw; fdx++) {
          const found = simulatedPieces.find(p => {
            if (p.id === piece.id || capturedIds.has(p.id)) return false;
            if (!doesPieceOccupySquare(p, toX + fdx, toY + fdy)) return false;
            const pOwner = p.player_id || p.team;
            // An ally under the footprint is taken too when the piece captures allies.
            return pOwner !== pieceOwner || !!piece.can_capture_allies;
          });
          if (found) capturedIds.add(found.id);
        }
      }
    } else {
      const found = simulatedPieces.find(p => p.id !== piece.id && doesPieceOccupySquare(p, toX, toY));
      if (found) {
        const fOwner = found.player_id || found.team;
        if (fOwner !== pieceOwner) capturedIds.add(found.id);
      }
    }
    if (capturedIds.size > 0) {
      for (let i = simulatedPieces.length - 1; i >= 0; i--) {
        if (capturedIds.has(simulatedPieces[i].id)) {
          simulatedPieces.splice(i, 1);
        }
      }
    }
    
    // Update the moving piece's position
    const movingPieceIndex = simulatedPieces.findIndex(p => p.id === piece.id);
    if (movingPieceIndex !== -1) {
      simulatedPieces[movingPieceIndex] = { ...simulatedPieces[movingPieceIndex], x: toX, y: toY };
    }

    return simulatedPieces;
  };

  // Check if a move would resolve check (or not leave the player in check)
  const wouldMoveResolveCheck = (piece, toX, toY, pieces, playerPosition, boardWidth, boardHeight) => {
    const simulatedPieces = simulateMove(piece, toX, toY, pieces);
    // Check if player would still be in check after this move
    const checkResult = checkForCheck(simulatedPieces, playerPosition, boardWidth, boardHeight);
    return !checkResult.inCheck;
  };

  // Which of a player's pieces end the game the moment they are taken.
  //   checkmate pieces  — only when the game type actually runs a mate condition;
  //                       leaving one attacked is an illegal move, not just a bad one
  //   capture-loss pieces — losing one ends the game outright, whatever the game's
  //                       other win conditions are, so hanging one is self-defeating
  // Games that decide on points, control squares, elimination or piece counts have
  // no such piece, and correctly report nothing here.
  const getGameLosingPieces = (pieces, playerPosition) => pieces.filter(p => {
    const owner = p.team || p.player_id;
    if (owner !== playerPosition) return false;
    if (p.ends_game_on_capture) return true;
    return !!(p.ends_game_on_checkmate && gameType?.mate_condition);
  });

  // True when the game type gives this side anything to lose by moving — i.e.
  // whether a "hide self-defeating moves" filter has any work to do at all.
  const hasGameLosingPieces = (pieces, playerPosition) =>
    getGameLosingPieces(pieces, playerPosition).length > 0;

  // Board-level legality for a destination square, independent of the piece's
  // movement pattern: impassable squares can never be landed on, and a piece
  // confined to a restriction zone cannot step outside it. These are the rules
  // permissive display deliberately ignores.
  const isSquareLegalDestination = (piece, toX, toY) => {
    const map = specialSquares?.special || {};
    const cfg = map[`${toY},${toX}`];
    if (cfg?.impassable) return false;
    if (piece?.cannot_move_outside_zone) {
      const zoneKeys = Object.entries(map)
        .filter(([, c]) => c && c.asRestrictionZone)
        .map(([key]) => key);
      // Mirrors the ranged-attack rule above: the confinement only bites once
      // the piece is standing on a zone square.
      const pieceOnZone = zoneKeys.includes(`${piece.y},${piece.x}`);
      if (pieceOnZone && !zoneKeys.includes(`${toY},${toX}`)) return false;
    }
    return true;
  };

  // Whether an "illegal moves" filter has anything to do on this board: a piece
  // whose loss ends the game, a piece that cannot be captured or must be
  // checkmated, or squares carrying impassable / restriction-zone rules.
  const hasIllegalMoveRules = (pieces) => {
    const list = Array.isArray(pieces) ? pieces : [];
    if ([1, 2].some(pos => hasGameLosingPieces(list, pos))) return true;
    if (list.some(p => p && (p.cannot_be_captured || p.ends_game_on_checkmate || p.cannot_move_outside_zone))) return true;
    return Object.values(specialSquares?.special || {})
      .some(cfg => cfg && (cfg.impassable || cfg.asRestrictionZone || cfg.restrictFirstMoveToCustom || cfg.disableFirstMoveHere));
  };

  // Generalised replacement for the check-only filter: would this move leave one
  // of the mover's game-losing pieces capturable? Covers classic "moving into
  // check" and equally covers capture-loss (royal-piece) games that have no mate
  // condition at all.
  const wouldMoveLoseTheGame = (piece, toX, toY, pieces, playerPosition, boardWidth, boardHeight) => {
    const atRisk = getGameLosingPieces(pieces, playerPosition);
    if (atRisk.length === 0) return false;
    const simulatedPieces = simulateMove(piece, toX, toY, pieces);
    const atRiskIds = new Set(atRisk.map(p => p.id));
    return simulatedPieces.some(p =>
      atRiskIds.has(p.id) && isPieceUnderAttack(p, simulatedPieces, boardWidth, boardHeight)
    );
  };

  // Calculate valid moves for a piece using actual piece movement data
  // forPremove: when true, includes potential capture squares even when empty (for premove highlighting)
  // permissive: report what the piece's own patterns can reach "in normal
  // circumstances", ignoring rules that make a specific square illegal for
  // reasons outside the piece — an enemy piece that can't be captured or ends
  // the game on checkmate, and board rules like restriction zones and
  // first-move custom squares. Blocking by pieces in the way still applies,
  // because that is physical reach rather than legality. Used by the replay
  // board's default hover view; leave it off for anything that has to be legal.
  //
  // opts.onlySquares / opts.asIfEmpty (Sets of "x,y"), for calculateBlockedTargets:
  // evaluate only those destinations, each as if nothing stood ON it (the rest
  // of the board, and so every path to it, unchanged), and return straight
  // after the per-square pass. One pass answers "would it reach this square if
  // the square were free?" for every candidate at once.
  /*
   * Every move the piece can make, with its FIRST-MOVE movement too while it
   * applies (helpers/firstMove.js): the same code run on a copy of the piece
   * with its first-move movement and attack swapped in. calculateShapeMoves is
   * the ordinary movement alone. Mirrors the server's getPossibleMovesForPiece.
   */
  const calculateValidMoves = (piece, pieces, ...rest) => {
    const moves = calculateShapeMoves(piece, pieces, ...rest) || [];
    const variant = firstMoveVariant(piece);
    if (!variant) return moves;
    const keyOf = (m) => `${m.x},${m.y}|${m.via ? `${m.via.x},${m.via.y}` : ''}|${m.isRangedAttack ? 'R' : ''}`;
    const seen = new Set(moves.map(keyOf));
    const out = [...moves];
    for (const m of calculateShapeMoves(variant, pieces, ...rest) || []) {
      const k = keyOf(m);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...m, isFirstMoveOnly: true });
    }
    return out;
  };

  const calculateShapeMoves = (piece, pieces, boardWidth, boardHeight, skipCheckFilter = false, forPremove = false, forHoverDisplay = false, forFog = false, permissive = false, opts = null) => {
    const onlySquares = opts?.onlySquares || null;
    const asIfEmpty = opts?.asIfEmpty || null;
    // Apply range square bonus
    piece = applyRangeSquareBonus(piece);

    let moves = [];
    const pieceTeam = piece.player_id || piece.team;
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    // A piece in the path that is not the mover. A multi-tile piece moving right
    // or down walks its anchor across squares it already covers; those are not
    // pieces it hops over.
    const otherPieceAt = (x, y) => {
      const p = findPieceAtSquare(pieces, x, y);
      return p && p.id !== piece.id ? p : null;
    };

    // Determine whether this piece's first-move-only abilities are blocked because of
    // custom-square configuration:
    //   - "Disable first-move abilities here" (disableFirstMoveHere) on the piece's CURRENT square
    //   - "Restrict first-move to these squares" (restrictFirstMoveToCustom) set somewhere on the
    //      board, with the piece NOT currently on one of those squares.
    // When true, any move tagged isFirstMoveOnly should be filtered out (highlights match the
    // server-side rules in shouldBlockFirstMoveAbilities).
    const customSquareMap = specialSquares?.special || {};
    let blockFirstMove = false;
    {
      const currentCfg = customSquareMap[`${piece.y},${piece.x}`];
      if (currentCfg && currentCfg.disableFirstMoveHere) {
        blockFirstMove = true;
      } else {
        let restrictExists = false;
        let onAllowed = false;
        for (const [key, cfg] of Object.entries(customSquareMap)) {
          if (cfg && cfg.restrictFirstMoveToCustom) {
            restrictExists = true;
            if (key === `${piece.y},${piece.x}`) onAllowed = true;
          }
        }
        if (restrictExists && !onAllowed) blockFirstMove = true;
      }
    }
    // A board rule, not a property of the piece, so permissive display ignores it.
    if (permissive) blockFirstMove = false;

    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        // Skip current position
        if (toX === piece.x && toY === piece.y) continue;
        if (onlySquares && !onlySquares.has(`${toX},${toY}`)) continue;
        const treatEmpty = !!(asIfEmpty && asIfEmpty.has(`${toX},${toY}`));
        // Paths are searched as if the piece standing ON that square (a single-square one) were gone.
        const pathPieces = treatEmpty
          ? pieces.filter((p) => !(p.x === toX && p.y === toY && (p.piece_width || 1) === 1 && (p.piece_height || 1) === 1))
          : pieces;

        // For multi-tile pieces, check the piece would fit on the board
        if (!doesPieceFitOnBoard(toX, toY, pw, ph, boardWidth, boardHeight)) continue;

        // For multi-tile pieces, scan entire destination footprint for enemies
        let occupyingPiece = null;
        let blockedByInvincible = false;
        if (treatEmpty) {
          // Asked as if the square were free: nothing at the destination counts.
        } else if (pw > 1 || ph > 1) {
          // Find any enemy (or ally if can_capture_allies) in the destination footprint
          for (let dy = 0; dy < ph && !blockedByInvincible; dy++) {
            for (let dx = 0; dx < pw && !blockedByInvincible; dx++) {
              const found = pieces.find(p =>
                p.id !== piece.id && doesPieceOccupySquare(p, toX + dx, toY + dy)
              );
              if (found) {
                const foundTeam = found.player_id || found.team;
                const isFriendly = foundTeam === pieceTeam;
                if (forPremove && isFriendly && !piece.can_capture_allies) {
                  // For premoves: block only own checkmate piece, ignore other friendlies
                  if (found.ends_game_on_checkmate) {
                    blockedByInvincible = true;
                  }
                } else if (forPremove && !isFriendly && found.ends_game_on_checkmate) {
                  // For premoves: allow targeting enemy checkmate pieces (they might move away)
                  // but still block invincible pieces
                  if (found.cannot_be_captured) blockedByInvincible = true;
                } else if ((found.cannot_be_captured || found.ends_game_on_checkmate) && !permissive) {
                  blockedByInvincible = true;
                } else if ((foundTeam !== pieceTeam || piece.can_capture_allies) && !occupyingPiece) {
                  occupyingPiece = found; // Track first enemy for capture flag
                }
              }
            }
          }
          if (blockedByInvincible) continue;
          // Only friendly pieces should block the destination (enemies are captured)
          // For premoves, skip this check (friendly pieces might be captured before premove executes)
          // (A piece that captures allies takes a friend under its footprint too.)
          if (!forPremove && !piece.can_capture_allies && !isDestinationClear(piece, toX, toY, pieces.filter(p => {
            const pTeam = p.player_id || p.team;
            return pTeam === pieceTeam && p.id !== piece.id;
          }), null)) continue;
        } else {
          occupyingPiece = findPieceAtSquare(pieces, toX, toY);
          const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;
          const isFriendlyTarget = occupyingPiece && occupyingPiece.id !== piece.id && occupyingTeam === pieceTeam;
          // Skip if enemy piece cannot be captured or is a checkmate piece
          // For premoves: allow targeting enemy checkmate pieces (they might move away)
          // Target immunity is a rule about the target, not about what this
          // piece's patterns reach, so permissive display keeps these squares —
          // otherwise the piece delivering checkmate appears to attack nothing.
          if (occupyingPiece && occupyingPiece.id !== piece.id && !isFriendlyTarget && !permissive) {
            if (occupyingPiece.cannot_be_captured) continue;
            if (occupyingPiece.ends_game_on_checkmate && !forPremove) continue;
          }
          // Handle friendly pieces at target
          const simulAllyCapture = !!(gameState?.gameType?.simultaneous_turns && (piece.can_capture_enemy_on_move || piece.can_capture_enemy_via_range));
          if (isFriendlyTarget && !piece.can_capture_allies && !simulAllyCapture) {
            if (forPremove) {
              // Allow premove targeting friendly pieces (enemy might capture them first)
              // Exception: never premove-target own checkmate piece (e.g. your king)
              if (occupyingPiece.ends_game_on_checkmate) continue;
              occupyingPiece = null; // Treat as potentially empty
            } else {
              continue;
            }
          }
          // Skip moves to squares within the piece's own footprint
          if (occupyingPiece && occupyingPiece.id === piece.id) continue;
        }

        const isCapture = !!(occupyingPiece && occupyingPiece.id !== piece.id);

        // Check if move is valid based on piece movement rules
        let isValidMove = false;
        let isPotentialCapture = false; // For premoves: empty square that could be a capture
        
        if (isCapture) {
          // Check capture rules
          isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        } else {
          // Check movement rules
          isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          
          // For premoves or fog: also check if this empty square is a valid capture square
          // (e.g., pawn diagonal attack - for premoves the piece might move there;
          //  for fog the piece can "see" squares it can attack even without a target).
          if ((forPremove || forFog) && !isValidMove) {
            const canCaptureThere = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
            if (canCaptureThere) {
              isValidMove = true;
              isPotentialCapture = true;
            }
          }
        }

        // Check if this is a custom-square-only move (direct jump, no path check needed).
        // Custom squares are drawn from the owner's side, so player 2's are mirrored
        // on both axes - as canPieceMoveTo reads them, and as the server applies them
        // (getPossibleMovesForPiece and canPieceAttackSquare: isPlayer2 ? -sq.col : sq.col).
        // Reading them unmirrored made player 2's custom jumps path-checked like slides.
        let isCustomSquareMove = false;
        if (isValidMove) {
          const rawRowOffset = pieceTeam === 2 ? piece.y - toY : toY - piece.y;
          const rawColOffset = pieceTeam === 2 ? piece.x - toX : toX - piece.x;
          // For captures, prefer custom_attack_squares; fall back to custom_movement_squares
          // when can_capture_enemy_on_move is set (piece captures using its movement pattern).
          const atkCustom = piece.custom_attack_squares;
          const movCustom = piece.custom_movement_squares;
          const toCheckCustom = isCapture
            ? (atkCustom || (piece.can_capture_enemy_on_move ? movCustom : null))
            : movCustom;
          if (toCheckCustom) {
            try {
              const customs = typeof toCheckCustom === 'string' ? JSON.parse(toCheckCustom) : toCheckCustom;
              if (Array.isArray(customs) && customs.some(sq => sq.row === rawRowOffset && sq.col === rawColOffset)) {
                isCustomSquareMove = true;
              }
            } catch { /* ignore */ }
          }
        }

        // If move is valid, check if path is clear
        // For ratio movements (L-shape), use special path checking
        const ratio1m = piece.ratio_movement_1 || 0;
        const ratio2m = piece.ratio_movement_2 || 0;
        const absRowDist = Math.abs(toY - piece.y);
        const absColDist = Math.abs(toX - piece.x);
        let isRatioMove = false;
        if (ratio1m > 0 && ratio2m > 0) {
          if ((absColDist === ratio1m && absRowDist === ratio2m) ||
              (absColDist === ratio2m && absRowDist === ratio1m)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio) {
            const maxK = piece.max_ratio_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * ratio2m && absColDist === k * ratio1m) ||
                  (absRowDist === k * ratio1m && absColDist === k * ratio2m)) {
                isRatioMove = true;
                break;
              }
            }
          }
        }
        // Also check ratio capture
        const rc1 = piece.ratio_capture_1 || 0;
        const rc2 = piece.ratio_capture_2 || 0;
        if (!isRatioMove && rc1 > 0 && rc2 > 0 && isCapture) {
          if ((absRowDist === rc1 && absColDist === rc2) ||
              (absRowDist === rc2 && absColDist === rc1)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio_capture) {
            const maxK = piece.max_ratio_capture_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_capture_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * rc1 && absColDist === k * rc2) ||
                  (absRowDist === k * rc2 && absColDist === k * rc1)) {
                isRatioMove = true;
                break;
              }
            }
          }
        }
        
        const isStepMove = isStepByStepTarget(piece, piece.x, piece.y, toX, toY);

        let pathClear = false;
        // Reached by a step-by-step walk: the directional hop rules below
        // (hop-only, hop limits) do not apply to it, as the wizard says.
        let stepWalkReached = false;
        if (forPremove) {
          // Premoves skip path checking — pieces may move out of the way before execution
          pathClear = true;
        } else if (isCustomSquareMove) {
          // Custom square moves are direct jumps — no path obstruction
          pathClear = true;
        } else if (isRatioMove) {
          // Check L-shape paths with hopping abilities
          pathClear = checkRatioPathClear(piece, toX, toY, pathPieces, isCapture);
        } else if (isStepMove) {
          pathClear = canReachStepByStep(piece, toX, toY, pathPieces, boardWidth, boardHeight, isCapture);
          stepWalkReached = pathClear;
        } else if (pw > 1 || ph > 1) {
          // For multi-tile pieces, check path from ALL sub-squares to their destination sub-squares
          pathClear = true;
          for (let sdy = 0; sdy < ph && pathClear; sdy++) {
            for (let sdx = 0; sdx < pw && pathClear; sdx++) {
              if (!isPathClear(piece.x + sdx, piece.y + sdy, toX + sdx, toY + sdy, pathPieces, piece, isCapture)) {
                pathClear = false;
              }
            }
          }
        } else {
          pathClear = isPathClear(piece.x, piece.y, toX, toY, pathPieces, piece, isCapture);
        }
        if (isCapture && !forPremove && !isCustomSquareMove && !isRatioMove) {
          const stepCapture = stepCapturePathClear(piece, toX, toY, pathPieces, boardWidth, boardHeight, pathClear);
          pathClear = stepCapture.clear;
          if (stepCapture.walked) stepWalkReached = true;
        }

        // For repeating ratio moves, check intermediate landing positions are clear.
        // Only applies when hop_stop_at_occupied is explicitly true (1).
        // When false/null/undefined the piece hops past occupied intermediate multiples.
        const hopStopAtOccupied = piece.hop_stop_at_occupied === 1 || piece.hop_stop_at_occupied === true;
        if (pathClear && isRatioMove && hopStopAtOccupied) {
          const rr1 = isCapture ? (rc1 || ratio1m) : ratio1m;
          const rr2 = isCapture ? (rc2 || ratio2m) : ratio2m;
          if (rr1 > 0 && rr2 > 0) {
            let stepRow = 0, stepCol = 0;
            const rowSign = Math.sign(toY - piece.y);
            const colSign = Math.sign(toX - piece.x);
            if (absRowDist > 0 && absColDist > 0) {
              if (absRowDist % rr1 === 0 && absColDist % rr2 === 0 && absRowDist / rr1 === absColDist / rr2) {
                stepRow = rr1 * rowSign; stepCol = rr2 * colSign;
              } else if (absRowDist % rr2 === 0 && absColDist % rr1 === 0 && absRowDist / rr2 === absColDist / rr1) {
                stepRow = rr2 * rowSign; stepCol = rr1 * colSign;
              }
            }
            if (stepRow !== 0 || stepCol !== 0) {
              let cx = piece.x + stepCol;
              let cy = piece.y + stepRow;
              while (cx !== toX || cy !== toY) {
                const blocking = findPieceAtSquare(pieces, cx, cy);
                if (blocking && blocking.id !== piece.id) {
                  pathClear = false;
                  break;
                }
                cx += stepCol;
                cy += stepRow;
              }
            }
          }
        }

        // The same rule for a straight line of exact jumps (exactLandingBlocked).
        if (pathClear && hopStopAtOccupied && !isRatioMove && !isCustomSquareMove && !isStepMove
            && exactLandingBlocked(piece, toX, toY, pieces, isCapture)) {
          pathClear = false;
        }

        // Hop capture: piece has capture_on_hop, destination is empty, enemies are in the path.
        // capture_on_hop inherently means the piece hops over enemies to capture them (like checkers),
        // so enemies in the path are always hoppable — no separate can_hop_over_enemies flag needed.
        // The destination must be within the piece's normal movement/capture range.
        let isHopCapture = false;
        let hopCapturedPieceIds = [];
        if (!isCapture && piece.capture_on_hop && !isStepMove && !isRatioMove) {
          // Hop capture only works if the destination is within the piece's actual movement/capture range.
          // isValidMove already tells us if normal movement covers this square.
          // If not, check if the capture range covers it.
          let hopDirValid = isValidMove;
          if (!hopDirValid) {
            hopDirValid = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          }
          if (hopDirValid) {
            // Walk the path: enemies are capture targets (always hoppable for capture_on_hop),
            // allies block unless the piece has ally-hop ability.
            const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
            const hopCapturedSet = new Set();
            let hopBlocked = false;
            const hdx = Math.sign(toX - piece.x);
            const hdy = Math.sign(toY - piece.y);
            const hxDiff = Math.abs(toX - piece.x);
            const hyDiff = Math.abs(toY - piece.y);
            if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
              // Each square of a multi-tile piece travels its own parallel
              // line, and hops whatever that line passes over (as the server's
              // getPiecesHoppedOver does). One line for a single square.
              for (let sdy = 0; sdy < ph && !hopBlocked; sdy++) {
                for (let sdx = 0; sdx < pw && !hopBlocked; sdx++) {
                  let cx = piece.x + sdx + hdx;
                  let cy = piece.y + sdy + hdy;
                  while ((cx !== toX + sdx || cy !== toY + sdy) && !hopBlocked) {
                    const hopPiece = findPieceAtSquare(pieces, cx, cy);
                    if (hopPiece && hopPiece.id !== piece.id) {
                      const hopTeam = hopPiece.player_id || hopPiece.team;
                      if (hopTeam !== pieceTeam) {
                        if ((hopPiece.cannot_be_captured || hopPiece.ends_game_on_checkmate) && !permissive) {
                          hopBlocked = true;
                        } else {
                          hopCapturedSet.add(hopPiece.id);
                        }
                      } else if (!canHopAllies) {
                        hopBlocked = true;
                      }
                    }
                    cx += hdx;
                    cy += hdy;
                  }
                }
              }
            }
            if (!hopBlocked && hopCapturedSet.size > 0) {
              hopCapturedPieceIds = [...hopCapturedSet];
              isHopCapture = true;
              isValidMove = true;
              pathClear = true;
            }
          }
        }

        // Hop-only restriction: if exact_ratio_hop_only is set and no hop occurred,
        // re-validate excluding exact directional and ratio abilities.
        // If the move only works via exact/ratio, reject it (nothing was hopped over).
        // Skip for premoves — the server validates the actual board state when the premove executes.
        const isAttackMove = isCapture || isPotentialCapture;
        const exactRatioHopOnlyApplies = isAttackMove
          ? (piece.exact_ratio_hop_only_attack === 1 || piece.exact_ratio_hop_only_attack === true)
          : (piece.exact_ratio_hop_only === 1 || piece.exact_ratio_hop_only === true);
        if (!forPremove && exactRatioHopOnlyApplies && isValidMove && pathClear && !isHopCapture && !isStepMove && !stepWalkReached && !isRatioMove) {
          const stillValid = isCapture
            ? canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true)
            : canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true);
          if (!stillValid) {
            // Move relies on exact/ratio — only allow if something was hopped in the path
            let hasHop = false;
            const hdx2 = Math.sign(toX - piece.x);
            const hdy2 = Math.sign(toY - piece.y);
            const hxDiff = Math.abs(toX - piece.x);
            const hyDiff = Math.abs(toY - piece.y);
            if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
              let hx2 = piece.x + hdx2;
              let hy2 = piece.y + hdy2;
              while (hx2 !== toX || hy2 !== toY) {
                const hp = findPieceAtSquare(pieces, hx2, hy2);
                if (hp && hp.id !== piece.id) { hasHop = true; break; }
                hx2 += hdx2;
                hy2 += hdy2;
              }
            }
            if (!hasHop) isValidMove = false;
          }
        }
        // For ratio moves with hop-only: a piece must stand on either L route,
        // as the server's generator and final capture check require
        // (getRatioHasAnyPiece / ratioPathHasPieceAtk). This used to refuse
        // every such ratio move, hop or no hop.
        if (!forPremove && exactRatioHopOnlyApplies && isValidMove && pathClear && !isHopCapture && isRatioMove) {
          const ldx = toX - piece.x;
          const ldy = toY - piece.y;
          const sx = Math.sign(ldx);
          const sy = Math.sign(ldy);
          let hopped = false;
          const xFirst = [[sx, 0, Math.abs(ldx)], [0, sy, Math.abs(ldy)]];
          const yFirst = [[0, sy, Math.abs(ldy)], [sx, 0, Math.abs(ldx)]];
          for (const legs of [xFirst, yFirst]) {
            let cx = piece.x;
            let cy = piece.y;
            for (const [lx, ly, n] of legs) {
              for (let i = 0; i < n && !hopped; i++) {
                cx += lx;
                cy += ly;
                if ((cx !== toX || cy !== toY) && otherPieceAt(cx, cy)) hopped = true;
              }
            }
          }
          if (!hopped) isValidMove = false;
        }

        // The hop requirements and limits below are directional rules. A custom
        // square is its own jump and is held to none of them (the wizard says so,
        // and the server generates and checks custom squares apart from them).
        // The straight-line hop rule (straightHopRule): at least / at most so
        // many pieces hopped, and how far past the last one it may land - for
        // a move, and separately for a capture. Not a rule for custom squares,
        // step walks or checkers-style hop captures (excluded above).
        if (!forPremove && isValidMove && !isHopCapture && !isCustomSquareMove && !stepWalkReached) {
          const rule = straightHopRule(piece, isCapture || isPotentialCapture);
          if (rule.active && !hopRuleAllows(rule, straightHopsBetween(piece.x, piece.y, toX, toY, (cx, cy) => !!otherPieceAt(cx, cy)))) {
            isValidMove = false;
          }
        }

        if (isValidMove && pathClear) {
          // Check if this move requires a certain number of first moves
          const firstMovesRequired = (isCapture || isPotentialCapture || isHopCapture)
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          // If this move requires first moves, check if the piece has moved too many times
          if (firstMovesRequired > 0) {
            // Custom-square first-move blockers (restrictFirstMoveToCustom on another square,
            // or disableFirstMoveHere on the piece's current square) gate first-move-only moves
            // entirely regardless of moveCount.
            if (blockFirstMove) {
              continue;
            }
            // Use the server-maintained moveCount on the piece directly.
            // This is more reliable than filtering moveHistory (avoids type-coercion
            // mismatches and missing entries for games restored from the DB).
            const pieceMovesCount = piece.moveCount || 0;
            if (pieceMovesCount >= firstMovesRequired) {
              continue;
            }
          }
          
          // Use already-computed custom square detection
          const isCustomMove = !isCapture && !isPotentialCapture && !isHopCapture && isCustomSquareMove;
          const isCustomAttack = (isCapture || isPotentialCapture || isHopCapture) && isCustomSquareMove;

          // Move/attack split for display. A square can be reachable by the
          // movement pattern, the capture pattern, or both — and boards draw a
          // half-and-half dot for "both". Occupancy already tells us one side of
          // it; the other needs one extra pattern + path test, so it runs only
          // for hover display, never on the live move-selection path.
          //   reachedByMove   — the movement pattern got us here
          //   reachedByAttack — the capture pattern covers this square
          const reachedByMove = !isCapture && !isPotentialCapture && !isHopCapture;
          let reachedByAttack = !reachedByMove;
          if (forHoverDisplay && reachedByMove &&
              canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam)) {
            // The capture pattern reaches it too, but attacks use their own
            // hop flags, so the path has to be re-checked as an attack.
            let attackPathClear;
            if (isCustomSquareMove) {
              attackPathClear = true;
            } else if (isRatioMove) {
              attackPathClear = checkRatioPathClear(piece, toX, toY, pathPieces, true);
            } else if (isStepMove) {
              attackPathClear = canReachStepByStep(piece, toX, toY, pathPieces, boardWidth, boardHeight, true);
            } else if (pw > 1 || ph > 1) {
              attackPathClear = true;
              for (let sdy = 0; sdy < ph && attackPathClear; sdy++) {
                for (let sdx = 0; sdx < pw && attackPathClear; sdx++) {
                  if (!isPathClear(piece.x + sdx, piece.y + sdy, toX + sdx, toY + sdy, pathPieces, piece, true)) {
                    attackPathClear = false;
                  }
                }
              }
            } else {
              attackPathClear = isPathClear(piece.x, piece.y, toX, toY, pathPieces, piece, true);
            }
            reachedByAttack = attackPathClear;
          }

          moves.push({
            x: toX,
            y: toY,
            isCapture: isCapture || isPotentialCapture || isHopCapture,
            isHopCapture,
            hopCapturedPieceIds,
            isFirstMoveOnly: firstMovesRequired > 0,
            isCustomMove,
            isCustomAttack,
            isPotentialCapture,
            reachedByMove,
            reachedByAttack
          });
        }
      }
    }
    
    // Paths: moves made of legs - the griffon, the rose, the crooked bishop
    // (movePaths.js, the server's own code).
    if (hasPaths(piece)) {
      const board = pathBoard(piece, pieces, boardWidth, boardHeight, { potential: forPremove || forFog, asIfEmpty });
      for (const m of pathMoves(piece, board)) {
        if (onlySquares && !onlySquares.has(`${m.x},${m.y}`)) continue;
        if (m.capture && m.target && m.target.ends_game_on_checkmate && !forPremove && !permissive) continue;
        if (moves.some((e) => e.x === m.x && e.y === m.y && !e.isRangedAttack)) continue;
        moves.push({
          x: m.x,
          y: m.y,
          isCapture: m.capture || (m.byAttack && !m.capture),
          isFirstMoveOnly: false,
          isPath: true,
          isPotentialCapture: m.byAttack && !m.capture,
          reachedByMove: m.byMove,
          reachedByAttack: m.byAttack,
        });
      }
    }

    // A blocked-target query (opts.onlySquares) wants the per-square answers only.
    if (onlySquares) return moves;

    // Check for castling moves
    if (piece.can_castle && !piece.hasMoved) {
      const castleDist = piece.castling_distance || 2;
      // Check left castling
      if (piece.castling_partner_left_id) {
        const partner = pieces.find(p => p.id === piece.castling_partner_left_id);
        if (partner && !partner.hasMoved) {
          const targetX = piece.x - castleDist;
          const targetY = piece.y;
          // King-traversal path must be clear. Partner is exempt because it
          // teleports during castling (so castling_distance=1 with the partner
          // at the corner is fine — only the king's own path matters).
          let pathClear = true;
          for (let x = piece.x - 1; x >= piece.x - castleDist; x--) {
            const occupant = pieces.find(p => p.id !== partner.id && doesPieceOccupySquare(p, x, piece.y));
            if (occupant) { pathClear = false; break; }
          }
          if (pathClear) {
            moves.push({
              x: targetX,
              y: targetY,
              isCapture: false,
              isCastling: true,
              castlingWith: piece.castling_partner_left_id,
              castlingDirection: 'left'
            });
          }
        }
      }
      
      // Check right castling
      if (piece.castling_partner_right_id) {
        const partner = pieces.find(p => p.id === piece.castling_partner_right_id);
        if (partner && !partner.hasMoved) {
          const targetX = piece.x + castleDist;
          const targetY = piece.y;
          // King-traversal path must be clear. Partner is exempt because it
          // teleports during castling (so castling_distance=1 with the partner
          // at the corner is fine — only the king's own path matters).
          let pathClear = true;
          for (let x = piece.x + 1; x <= piece.x + castleDist; x++) {
            const occupant = pieces.find(p => p.id !== partner.id && doesPieceOccupySquare(p, x, piece.y));
            if (occupant) { pathClear = false; break; }
          }
          if (pathClear) {
            moves.push({
              x: targetX,
              y: targetY,
              isCapture: false,
              isCastling: true,
              castlingWith: piece.castling_partner_right_id,
              castlingDirection: 'right'
            });
          }
        }
      }
    }
    
    // Check for en passant capture
    if (piece.can_en_passant && gameState?.enPassantTarget) {
      const ept = gameState.enPassantTarget;
      // Check if capturing piece is horizontally adjacent to the vulnerable piece
      const vulnerablePiece = pieces.find(p => 
        p.id === ept.pieceId && p.x === ept.piecePosition.x && p.y === ept.piecePosition.y
      );
      if (vulnerablePiece) {
        const vulnerableTeam = vulnerablePiece.player_id || vulnerablePiece.team;
        // Must be enemy piece
        if (vulnerableTeam !== pieceTeam && !vulnerablePiece.cannot_be_captured && !vulnerablePiece.ends_game_on_checkmate) {
          // Must be same piece type (e.g., pawn can only en passant capture another pawn)
          if (piece.piece_id === vulnerablePiece.piece_id) {
            // Check if current piece is horizontally adjacent to the vulnerable piece
            if (piece.y === vulnerablePiece.y && Math.abs(piece.x - vulnerablePiece.x) === 1) {
              // Check if capture square isn't already in moves
              const captureSquare = ept.captureSquare;
              if (!moves.some(m => m.x === captureSquare.x && m.y === captureSquare.y)) {
                moves.push({
                  x: captureSquare.x,
                  y: captureSquare.y,
                  isCapture: true,
                  isEnPassant: true,
                  enPassantVictimId: vulnerablePiece.id
                });
              }
            }
          }
        }
      }
    }
    
    // Check for ranged attack targets
    if (piece.can_capture_enemy_via_range) {
      // Restriction zone: if the piece is on a zone square, only ranged attacks
      // to other zone squares are legal — unless the current zone square also
      // has allowRangedOutsideZone enabled.
      const zoneSquares = piece.cannot_move_outside_zone
        ? Object.entries(customSquareMap)
            .filter(([, cfg]) => cfg && cfg.asRestrictionZone)
            .map(([key]) => key)
        : null;
      const pieceZoneKey = `${piece.y},${piece.x}`;
      const pieceIsOnZone = zoneSquares && zoneSquares.includes(pieceZoneKey);
      const rangedOutsideAllowed = pieceIsOnZone
        && !!(customSquareMap[pieceZoneKey]?.allowRangedOutsideZone);

      for (let toY = 0; toY < boardHeight; toY++) {
        for (let toX = 0; toX < boardWidth; toX++) {
          if (toX === piece.x && toY === piece.y) continue;
          // Restriction zone: skip ranged attacks that exit the zone (unless exempted).
          if (pieceIsOnZone && !rangedOutsideAllowed && !permissive && !zoneSquares.includes(`${toY},${toX}`)) continue;
          const targetPiece = findPieceAtSquare(pieces, toX, toY);
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          // Skip friendly pieces - in simul-turns games, self-sacrifice is allowed
          const isSimulGame = !!(gameState?.gameType?.simultaneous_turns);
          if (targetPiece && targetTeam === pieceTeam && !isSimulGame) continue;
          // Skip pieces that cannot be captured or are checkmate pieces
          if (targetPiece && (targetPiece.cannot_be_captured || targetPiece.ends_game_on_checkmate) && !permissive) continue;
          // Skip if a ranged entry already exists for this square (avoid duplicates).
          // Do NOT skip when only a regular move exists — a piece can both move to a square
          // and ranged-attack it, and both indicators should be shown simultaneously.
          if (moves.some(m => m.x === toX && m.y === toY && m.isRangedAttack)) continue;
          // From any square of a multi-tile piece's footprint; step-by-step
          // ranged uses BFS path-finding so walls block correctly.
          const isStepByStepRanged = !!piece.step_by_step_attack_range;
          const stepReach = isStepByStepRanged
            ? (shooter, tx, ty, others) => canReachStepByStepRanged(shooter, tx, ty, others, boardWidth, boardHeight)
            : null;
          if (!rangedFromFootprint(piece, toX, toY, pieces, pieceTeam, stepReach).clear) continue;
          {
            const hasTarget = !!targetPiece;
            // For premoves, include empty ranged squares as potential targets
            // For hover display, include all reachable ranged squares (even empty) to show the full threat zone
            if (hasTarget || forPremove || forHoverDisplay) {
              moves.push({
                x: toX,
                y: toY,
                isCapture: hasTarget,
                isFirstMoveOnly: false,
                isRangedAttack: true,
                isPotentialRangedTarget: !hasTarget && (forPremove || forHoverDisplay)
              });
            }
          }
        }
      }
    }
    
    // Check for direction-change moves
    if (piece.directional_movement_change || piece.directional_capture_change ||
        (piece.attacks_like_movement && piece.directional_movement_change)) {
      const dcMovement = getDirectionChangeMoves(piece, piece.x, piece.y, pieceTeam, boardWidth, boardHeight, 'movement', pieces);
      const dcCapture = getDirectionChangeMoves(piece, piece.x, piece.y, pieceTeam, boardWidth, boardHeight, 'capture', pieces);
      for (const dcMove of [...dcMovement, ...dcCapture]) {
        // Deduplicate by coordinate + via (same destination reachable via different via squares = distinct moves)
        if (!moves.some(m => m.isDirectionChange && m.x === dcMove.x && m.y === dcMove.y && !!m.isCapture === !!dcMove.isCapture && m.via?.x === dcMove.via?.x && m.via?.y === dcMove.via?.y)) {
          moves.push(dcMove);
        }
      }
    }

    // Enforce require_direction_change (movement) and require_direction_change_capture:
    // when set, straight-line destinations only accessible if they also appear as a DC destination.
    const requireDCMov = !!(piece.directional_movement_change && piece.require_direction_change);
    const requireDCCap = !!(piece.require_direction_change_capture &&
      (piece.directional_capture_change || (piece.attacks_like_movement && piece.directional_movement_change)));
    if (requireDCMov || requireDCCap) {
      const dcMovDests = new Set();
      const dcCapDests = new Set();
      for (const m of moves) {
        if (!m.isDirectionChange) continue;
        if (m.isCapture) dcCapDests.add(`${m.x},${m.y}`);
        else dcMovDests.add(`${m.x},${m.y}`);
      }
      moves = moves.filter(m => {
        if (m.isDirectionChange) return true;
        if (m.isCapture && requireDCCap) return dcCapDests.has(`${m.x},${m.y}`);
        if (!m.isCapture && requireDCMov) return dcMovDests.has(`${m.x},${m.y}`);
        return true;
      });
    }

    // Filter out moves that would leave the player in check (if mate_condition is enabled and not skipped).
    // Only apply this filter to the current player's own pieces — applying it to opponent pieces
    // would incorrectly remove the opponent's check-giving moves from their hover display.
    const pieceTeamForCheckFilter = piece.player_id || piece.team;
    const isOwnPieceForCheckFilter = !!piece.is_neutral || (currentPlayer && pieceTeamForCheckFilter === currentPlayer.position);
    if (!skipCheckFilter && gameState?.gameType?.mate_condition && currentPlayer && isOwnPieceForCheckFilter) {
      // Don't filter ranged attacks through check filter (they don't move the piece)
      const regularMoves = moves.filter(m => !m.isRangedAttack);
      const rangedMoves = moves.filter(m => m.isRangedAttack);
      const filteredRegular = regularMoves.filter(move => 
        wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
      );
      return [...filteredRegular, ...rangedMoves];
    }
    
    return moves;
  };

  /*
   * Blocked targets: where the piece's pattern reaches but it cannot go now.
   * Drawn as hollow, dashed dots wherever the board draws no ordinary dot, so a
   * player can see what stops a piece: their own piece in the way, an
   * impassable square, an enemy that cannot be captured, an enemy on a square
   * the piece can only MOVE to, a move that check rules out.
   *
   * Two modes (BLOCKED_DOT_MODES; the player picks in settings):
   *
   *   'pattern' (default) - every square the piece reaches on an otherwise
   *     EMPTY board that it cannot reach now: the blockers and everything
   *     behind them. One extra pass with a single piece on the board, so it
   *     costs next to nothing on any board.
   *
   *   'first' - only the square that actually stops it: where the piece WOULD
   *     go if that one square were a free, empty square with no constraints.
   *     Squares behind a blocker (which would need more than one square freed)
   *     are left alone. Not for multi-tile pieces: they need a whole footprint
   *     free, so one square says nothing.
   *
   * How, in 'first' mode: every square that holds another piece or is
   * impassable is a candidate. One engine pass (opts.onlySquares/asIfEmpty)
   * asks each candidate "could the piece land here if nothing stood on it?",
   * permissively and without the check filter, with the board's own hover
   * flags. Cost: one pass over the candidate squares only.
   *
   * Returns Map "x,y" -> dot type ('move' | 'capture' | 'both'). Boards draw it
   * only where they draw no ordinary dot.
   */
  // Bare patterns for 'pattern' mode, per piece and square (see below). One per
  // engine, so per board and rule set.
  const patternCache = new Map();
  const calculateBlockedTargets = (piece, pieces, boardWidth, boardHeight, { forHoverDisplay = true, forFog = true, mode = 'pattern' } = {}) => {
    const out = new Map();
    if (!piece || !Array.isArray(pieces) || mode === 'off') return out;
    const list = pieces.filter(Boolean);
    const impassable = new Set(Object.entries(specialSquares?.special || {})
      .filter(([, c]) => c && c.impassable)
      .map(([k]) => { const [y, x] = k.split(',').map(Number); return `${x},${y}`; }));
    /*
     * Squares that already carry an ordinary dot are NOT taken out here: every
     * board draws a blocked dot only where it draws no ordinary one. Working
     * them out again would repeat the board's own full-board move pass - which
     * was most of the cost on a large board.
     */
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    const ownSquare = (x, y) => x >= piece.x && x < piece.x + pw && y >= piece.y && y < piece.y + ph;
    const typeOf = (m) => {
      const t = getMoveDotType(m);
      return t === 'both' || t === 'capture' ? t : 'move';
    };

    if (mode !== 'first') {
      /*
       * The piece alone on the board, no rules - its bare pattern. It depends
       * only on the piece and where it stands, never on the other pieces, so it
       * is kept: hovering the same piece again (the usual case) costs nothing.
       */
      const cacheKey = [piece.piece_id ?? piece.id, piece.player_id ?? piece.team, piece.x, piece.y,
        piece.hasMoved ? 1 : 0, piece.moveCount || 0, boardWidth, boardHeight, forHoverDisplay ? 1 : 0, forFog ? 1 : 0].join('|');
      let open = patternCache.get(cacheKey);
      if (!open) {
        open = calculateValidMoves(piece, [piece], boardWidth, boardHeight, true, false, forHoverDisplay, forFog, true) || [];
        if (patternCache.size >= 400) patternCache.clear();
        patternCache.set(cacheKey, open);
      }
      for (const m of open) {
        if (m.isRangedAttack || ownSquare(m.x, m.y)) continue;
        const k = `${m.x},${m.y}`;
        const prev = out.get(k);
        const next = typeOf(m);
        out.set(k, prev && prev !== next ? 'both' : next);
      }
      return out;
    }

    // A multi-tile piece needs its whole footprint clear to land, so "if this one
    // square were free" does not say whether it could - no blocked dots for it.
    if (pw > 1 || ph > 1) return out;

    // Every square some other piece covers, plus every impassable square.
    const candidates = new Map(); // "x,y" -> the piece standing there (or null)
    for (const other of list) {
      if (other.id === piece.id) continue;
      const w = other.piece_width || 1;
      const h = other.piece_height || 1;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const x = other.x + dx;
          const y = other.y + dy;
          if (x >= 0 && y >= 0 && x < boardWidth && y < boardHeight) candidates.set(`${x},${y}`, other);
        }
      }
    }
    for (const k of impassable) if (!candidates.has(k)) candidates.set(k, null);

    const ask = new Set();
    for (const k of candidates.keys()) {
      const [x, y] = k.split(',').map(Number);
      if (ownSquare(x, y)) continue; // its own square
      ask.add(k);
    }
    if (!ask.size) return out;

    /*
     * ONE pass for every candidate: the engine checks just these squares, each
     * as if nothing stood on it, with the rest of the board in place. A piece
     * earlier on the path still blocks it, so only the square that stops the
     * piece is ever marked, never one behind it. (Recomputing the whole move set
     * once per candidate cost seconds on a 48x24 board.)
     */
    const reach = calculateValidMoves(piece, list, boardWidth, boardHeight, true, false, forHoverDisplay, forFog, true,
      { onlySquares: ask, asIfEmpty: ask }) || [];
    for (const m of reach) {
      if (m.isRangedAttack) continue;
      const k = `${m.x},${m.y}`;
      if (!ask.has(k)) continue;
      const merged = out.get(k);
      const next = typeOf(m);
      out.set(k, merged && merged !== next ? 'both' : next);
    }
    return out;
  };

  return {
    calculateBlockedTargets,
    checkMovement,
    resolveExact,
    checkIfFirstMoveOnlyMove,
    checkIfFirstMoveOnlyCapture,
    canPieceMoveTo,
    canPieceCaptureTo,
    isPathClear,
    checkBothLPaths,
    checkRatioPathClear,
    getStepMovementConfig,
    isStepByStepTarget,
    canReachStepByStep,
    canReachStepByStepRanged,
    applyRangeSquareBonus,
    isPieceUnderAttack,
    checkForCheck,
    simulateMove,
    wouldMoveResolveCheck,
    getGameLosingPieces,
    hasGameLosingPieces,
    isSquareLegalDestination,
    hasIllegalMoveRules,
    wouldMoveLoseTheGame,
    calculateValidMoves,
  };
};

export default createMoveEngine;
