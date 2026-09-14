/*
 * Winning by making a LINE, or by making a CONNECTION.
 *
 * The one shape of win condition the engine had no way to express. Everything
 * else here is about pieces - capture this one, have the most of them, run out
 * of moves - and this is about where they are relative to each other. Without
 * it, a game whose whole point is a pattern on the board could be BUILT on this
 * site (an empty board, a piece that cannot move, placement turned on) and then
 * could never be won.
 *
 * Deliberately two modes rather than one, because the two famous shapes are not
 * the same shape:
 *
 *   in_a_row      N of your pieces in an unbroken straight line. Noughts and
 *                 crosses is this with N = 3; gomoku is N = 5; Connect Four is
 *                 N = 4, with the gravity supplied by the board rather than by
 *                 this.
 *
 *   edge_to_edge  A connected group of your pieces touching two opposite sides
 *                 of the board. This is a road in Tak and a chain in Hex - the
 *                 length is whatever the board demands, so there is no N.
 *
 * Both are answered over OWNERSHIP, not piece type, because that is the rule in
 * every game that uses them: a Tak road may mix flats and capstones, and a
 * noughts-and-crosses line is three of your marks. A game that wants one piece
 * type throughout says so with line_same_piece_type, which is off by default.
 *
 * Neutral pieces belong to nobody and count for nobody. Letting them complete a
 * line would hand a win to whichever player the board happened to favour, which
 * is not a rule anybody wrote.
 *
 * Pure: it reads a position and answers a question. Nothing here mutates the
 * state, emits, or touches the database, so it can be called from the move path
 * and the placement path alike - and tested without a game.
 */

/** Direction pairs, one per axis, so a line is never counted from both ends. */
const AXES_ORTHOGONAL = [[1, 0], [0, 1]];
const AXES_DIAGONAL = [[1, 1], [1, -1]];

const axesFor = (directions) => {
  if (directions === 'orthogonal') return AXES_ORTHOGONAL;
  if (directions === 'diagonal') return AXES_DIAGONAL;
  return [...AXES_ORTHOGONAL, ...AXES_DIAGONAL];
};

/** Neighbour offsets for connectivity, from the same setting. */
const STEPS_ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STEPS_DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const stepsFor = (directions) => {
  if (directions === 'orthogonal') return STEPS_ORTHOGONAL;
  if (directions === 'diagonal') return STEPS_DIAGONAL;
  return [...STEPS_ORTHOGONAL, ...STEPS_DIAGONAL];
};

/**
 * The line settings for a game type, or null when it does not use them.
 *
 * Every value is clamped here rather than trusted, because these arrive from a
 * wizard form and land in a loop: a line length of zero would report a win on
 * an empty board, and a negative one would never terminate.
 */
function lineRules(gameType) {
  if (!gameType || !gameType.line_condition) return null;

  const winType = gameType.line_win_type === 'edge_to_edge' ? 'edge_to_edge' : 'in_a_row';
  const directions = ['orthogonal', 'diagonal', 'all'].includes(gameType.line_directions)
    ? gameType.line_directions
    : 'all';
  const edges = ['horizontal', 'vertical', 'either'].includes(gameType.line_edges)
    ? gameType.line_edges
    : 'either';

  const rawLength = parseInt(gameType.line_length, 10);
  const length = Number.isFinite(rawLength) ? Math.max(2, Math.min(64, rawLength)) : 3;

  return {
    winType,
    length,
    directions,
    edges,
    samePieceType: !!gameType.line_same_piece_type,
  };
}

/** Who owns a piece, as a player POSITION. 0 means neutral - nobody. */
const ownerOf = (piece) => Number(piece?.team ?? piece?.player_id ?? 0) || 0;

/**
 * Index the board by "y,x" for the pieces one player owns.
 *
 * Multi-square pieces occupy every square they cover, so a piece two wide can
 * be part of a line through either of them - which is what a player looking at
 * the board would expect.
 */
function ownedSquares(pieces, position) {
  const map = new Map();
  for (const piece of (pieces || [])) {
    if (ownerOf(piece) !== Number(position)) continue;
    const w = Math.max(1, Number(piece.piece_width) || 1);
    const h = Math.max(1, Number(piece.piece_height) || 1);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        map.set(`${Number(piece.y) + dy},${Number(piece.x) + dx}`, piece);
      }
    }
  }
  return map;
}

/** N of this player's pieces in an unbroken straight line, or null. */
function findRow(owned, rules, boardWidth, boardHeight) {
  const axes = axesFor(rules.directions);

  for (const [startKey, startPiece] of owned) {
    const [sy, sx] = startKey.split(',').map(Number);
    for (const [dx, dy] of axes) {
      /*
       * Only start a line where one cannot already be running: if the square
       * BEHIND this one is also ours, this is the middle of a line and the
       * walk from its true start has already covered it.
       */
      if (owned.has(`${sy - dy},${sx - dx}`)) continue;

      const squares = [{ x: sx, y: sy }];
      let last = startPiece;
      for (let step = 1; step < rules.length; step++) {
        const nx = sx + dx * step;
        const ny = sy + dy * step;
        if (nx < 0 || ny < 0 || nx >= boardWidth || ny >= boardHeight) break;
        const next = owned.get(`${ny},${nx}`);
        if (!next) break;
        if (rules.samePieceType && Number(next.piece_id) !== Number(last.piece_id)) break;
        squares.push({ x: nx, y: ny });
        last = next;
      }
      if (squares.length >= rules.length) return squares;
    }
  }
  return null;
}

/**
 * A connected group of this player's pieces touching two opposite sides.
 *
 * A flood fill from one side; reaching the other is the win. Run for the two
 * orientations the setting allows - a Tak road counts in either direction, and
 * a game that wants only one says so.
 */
function findConnection(owned, rules, boardWidth, boardHeight) {
  const steps = stepsFor(rules.directions);

  const run = (startKeys, reached) => {
    const seen = new Set();
    const queue = [];
    for (const key of startKeys) {
      if (owned.has(key) && !seen.has(key)) { seen.add(key); queue.push(key); }
    }
    while (queue.length) {
      const key = queue.shift();
      const [y, x] = key.split(',').map(Number);
      if (reached(x, y)) {
        return [...seen].map((k) => {
          const [ky, kx] = k.split(',').map(Number);
          return { x: kx, y: ky };
        });
      }
      for (const [dx, dy] of steps) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= boardWidth || ny >= boardHeight) continue;
        const nk = `${ny},${nx}`;
        if (seen.has(nk) || !owned.has(nk)) continue;
        /*
         * A same-piece-type road must be one type throughout, so the fill
         * refuses to step onto a different one rather than filtering
         * afterwards - a group split by a foreign piece is two groups.
         */
        if (rules.samePieceType
            && Number(owned.get(nk).piece_id) !== Number(owned.get(key).piece_id)) continue;
        seen.add(nk);
        queue.push(nk);
      }
    }
    return null;
  };

  const wantHorizontal = rules.edges === 'either' || rules.edges === 'horizontal';
  const wantVertical = rules.edges === 'either' || rules.edges === 'vertical';

  if (wantHorizontal) {
    const left = [];
    for (let y = 0; y < boardHeight; y++) left.push(`${y},0`);
    const hit = run(left, (x) => x === boardWidth - 1);
    if (hit) return hit;
  }
  if (wantVertical) {
    const top = [];
    for (let x = 0; x < boardWidth; x++) top.push(`0,${x}`);
    const hit = run(top, (_x, y) => y === boardHeight - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Has this player made their line?
 *
 * @returns {{squares: Array<{x,y}>, winType: string}|null}
 */
function findWinningLine(gameState, position) {
  const rules = lineRules(gameState?.gameType);
  if (!rules) return null;
  if (!Number(position)) return null;   // neutral never wins

  const boardWidth = Number(gameState.gameType?.board_width) || 8;
  const boardHeight = Number(gameState.gameType?.board_height) || 8;
  const owned = ownedSquares(gameState.pieces, position);
  if (!owned.size) return null;

  const squares = rules.winType === 'edge_to_edge'
    ? findConnection(owned, rules, boardWidth, boardHeight)
    : findRow(owned, rules, boardWidth, boardHeight);

  return squares ? { squares, winType: rules.winType } : null;
}

/**
 * The first player with a line, checked over everyone.
 *
 * Used where the caller does not already know who just acted - the generic win
 * check after a move, which is reached from paths that moved somebody else's
 * piece (a neutral one, a trample) as well as their own.
 */
function findAnyWinningLine(gameState) {
  if (!lineRules(gameState?.gameType)) return null;
  for (const player of (gameState.players || [])) {
    const hit = findWinningLine(gameState, player.position);
    if (hit) return { ...hit, position: player.position, playerId: player.id };
  }
  return null;
}

/** A sentence describing the rule, for the rules panel and the wizard. */
function describeLineRule(gameType) {
  const rules = lineRules(gameType);
  if (!rules) return null;
  const how = rules.directions === 'orthogonal'
    ? 'horizontally or vertically'
    : (rules.directions === 'diagonal' ? 'diagonally' : 'in any direction, including diagonally');

  if (rules.winType === 'edge_to_edge') {
    const which = rules.edges === 'horizontal' ? 'the left and right sides'
      : (rules.edges === 'vertical' ? 'the top and bottom' : 'two opposite sides');
    return `Connect ${which} of the board with an unbroken chain of your pieces`
      + `, joined ${how}${rules.samePieceType ? ', all of one piece type' : ''}.`;
  }
  return `Get ${rules.length} of your pieces in a row, ${how}`
    + `${rules.samePieceType ? ', all of one piece type' : ''}.`;
}

module.exports = {
  lineRules,
  findWinningLine,
  findAnyWinningLine,
  describeLineRule,
};
