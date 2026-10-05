/*
 * Puzzle validation.
 *
 * A puzzle is judged by exactly the same rules as a live game: the move engine is
 * reused wholesale from game-socket.js (already exported as pure functions for
 * the AI), so there is no second implementation to drift.
 *
 * THE SETUP MOVE
 *
 * A puzzle has no move history, which used to mean two things were permanently
 * wrong: en passant could never be the answer, and nothing could say whether a
 * piece had already moved. Both are fixed by storing the opponent's LAST MOVE -
 * the one that set the position up. The position is still what the solver sees;
 * setup_move just says how it got there.
 *
 * From that one move the state derives:
 *   - gameState.enPassantTarget, via the same deriveEnPassantTarget a live game
 *     uses. If the setup move was not a first-move double step, no piece can
 *     capture en passant this turn - which is the correct answer, not a missing
 *     feature.
 *   - moveCount on the piece that made it, so it is not treated as unmoved.
 *
 * WHAT CAN BE CHECKED
 *
 * Every goal in MECHANICAL_GOALS is decided by the engine: each legal move is
 * enumerated and tested, so a creator is told when some OTHER move also achieves
 * the goal - which they genuinely cannot eyeball on a site where the pieces are
 * user-defined. Which goals are on offer depends on the game's own win
 * conditions; see goalsForGameType.
 *
 * A line longer than one move still cannot be judged for forcedness: the
 * opponent's replies are the creator's script, not an engine's best defence.
 * What IS checked is that every move in the line is legal from the position the
 * one before it leaves behind, and whether the final position achieves the goal.
 *
 * NOTHING HERE BLOCKS PUBLISHING. The result is advice for the creator.
 */
const {
  getAllLegalMovesForPlayer,
  validateAndApplyMove,
  isCheckmate,
  checkForCheck,
  checkWinCondition,
  deriveEnPassantTarget,
  initializeCastlingPartners,
  getPromotionOptions,
  applyPromotionToPiece,
  applyCapturePoints,
  getPlayerScore,
  resolveSurroundCaptures,
  applySurroundCaptureScoring,
  placementViolatesSelfCapture,
  placementRepeatsBannedPosition,
  isPlacementSquareAllowed,
  getPlacementConfinementZone,
  isPlaceableEligibleFor,
  parseCustomSquares,
  getValidFlankingPlacements,
  applyFlankingCaptures,
  getImageUrlForPlayer,
} = require('./game-socket');
const { gravityOf, restingSquare } = require('./board-gravity');
const { squareLabel } = require('./square-label');

const VALIDATION = {
  VALID: 'valid',
  AMBIGUOUS: 'ambiguous',
  UNSOLVABLE: 'unsolvable',
  NOT_CHECKABLE: 'not_checkable',
};

const other = (side) => (Number(side) === 1 ? 2 : 1);

/* ------------------------------------------------------------------ goals -- */

/*
 * Every goal the builder can offer.
 *
 * `available(gameType)` decides whether a goal is even meaningful for a game -
 * "stalemate them" is not a puzzle in a game with no stalemate rule - so the
 * builder can offer the goals this game actually has instead of a fixed list of
 * four. `achieved` runs AFTER the solver's move has been applied and is handed
 * the resulting state; returning true means the goal is met.
 *
 * `describe` is the sentence shown to the solver. A puzzle whose creator wrote
 * no description still tells them what they are looking for.
 */
const GOAL_DEFS = {
  checkmate_in_1: {
    label: 'Checkmate',
    describe: () => 'Find the move that delivers checkmate.',
    available: (gt) => !!gt.mate_condition,
    mechanical: true,
    achieved: (state, side) => !!isCheckmate(state, other(side)),
  },

  capture_target: {
    label: 'Capture the key piece',
    describe: () => 'Find the move that captures the piece the game ends on.',
    available: (gt) => !!gt.capture_condition,
    mechanical: true,
    achieved: (state, side, ctx) => {
      const win = checkWinCondition(state, ctx.captured);
      return !!(win && win.gameOver && win.winner === `puzzle_p${side}`
        && (win.reason === 'capture' || win.reason === 'checkmate'));
    },
  },

  stalemate_them: {
    label: 'Stalemate the opponent',
    describe: () => 'Find the move that leaves the opponent with no legal move, and not in '
      + 'check. In this game that is a draw, not a win - which may be the best available.',
    /*
     * NOT offered in a game where being stalemated WINS.
     *
     * It used to be, with copy that said "Stalemate wins this game" - which
     * read as encouragement and was precisely backwards: the rule is that the
     * STALEMATED player wins, so stalemating your opponent hands them the
     * game. Two published puzzles were built on that reading.
     *
     * There is no one-move version of the right idea either. Winning by
     * stalemate means being stalemated yourself, and after your move it is
     * their turn - so it takes at least their reply to reach, which is a line
     * the checker cannot judge for forcedness anyway.
     */
    available: (gt) => !gt.stalemate_win_condition && !!gt.stalemate_draw_condition,
    /*
     * Ranked below the goals that actually win. Stalemate only ever splits the
     * point here now, so "find the stalemate" should not be the first thing
     * the builder suggests - or the one a generator reaches for.
     */
    rank: () => 1,
    mechanical: true,
    achieved: (state, side) => {
      const them = other(side);
      if (checkForCheck(state, them).inCheck) return false;
      return (getAllLegalMovesForPlayer(state, them) || []).length === 0;
    },
  },

  no_moves_them: {
    label: 'Leave the opponent with no legal moves',
    describe: () => 'Find the move that leaves the opponent unable to move at all.',
    available: (gt) => !!gt.no_moves_condition,
    mechanical: true,
    achieved: (state, side) =>
      (getAllLegalMovesForPlayer(state, other(side)) || []).length === 0,
  },

  /*
   * Being stalemated WINS in this game (Antichess and its relatives), so the
   * goal is to be the one left without a move - which only the opponent's
   * reply can do: after your own move it is their turn, not yours. So it is
   * judged on the position their reply leaves (a reply-completed goal, below),
   * and never on a move of the solver's own: a solver who happens to have no
   * moves while it is the opponent's turn has not been stalemated.
   */
  get_stalemated: {
    label: 'Get yourself stalemated',
    describe: () => 'In this game the player left with no legal move, and not in check, wins. '
      + 'Find the moves that leave your opponent no choice but to stalemate you.',
    available: (gt) => !!gt.stalemate_win_condition,
    mechanical: true,
    achieved: (state, side, ctx) => {
      const mover = ctx?.movingPiece;
      if (mover && Number(mover.team ?? mover.player_id) === Number(side)) return false;
      if (checkForCheck(state, side).inCheck) return false;
      return (getAllLegalMovesForPlayer(state, side) || []).length === 0;
    },
  },

  lose_all_pieces: {
    label: 'Lose your last piece',
    describe: () => 'This game is won by losing everything. Find the move that gets you there.',
    available: (gt) => !!gt.lose_all_pieces_condition,
    mechanical: true,
    achieved: (state, side) =>
      !state.pieces.some(p => Number(p.team ?? p.player_id) === Number(side)),
  },

  promote_a_piece: {
    label: 'Promote a piece',
    describe: (gt) => (gt.promotion_condition
      ? 'Reaching a promotion square wins this game. Find the move that gets there.'
      : 'Find the move that promotes a piece.'),
    available: (gt) => !!gt.promotion_condition || !!gt.promotion_squares_string,
    mechanical: true,
    achieved: (state, side, ctx) => {
      if (!ctx.promotionEligible || !ctx.promotionEligible.eligible) return false;
      /*
       * When reaching the square is the WIN, this goal inherits the win's own
       * condition - so a game that only wins on an empty square does not treat
       * arriving by capture as solving the puzzle. Where promotion is an
       * ordinary promotion rather than a win, the flag says nothing and the
       * move promotes either way.
       */
      if (state.gameType?.promotion_condition) {
        if (state.gameType.promotion_condition_requires_empty && ctx.destinationWasOccupied) return false;
        if (state.gameType.promotion_condition_requires_no_capture && ctx.capturedSomething) return false;
        // On unless explicitly turned off, matching the column's default.
        const allowsDead = state.gameType.promotion_condition_requires_survival === 0
          || state.gameType.promotion_condition_requires_survival === false;
        if (!allowsDead && ctx.moverSurvived === false) return false;
      }
      return true;
    },
  },

  reach_points: {
    label: 'Reach the winning score',
    describe: (gt) => `Captures score points in this game. Find the move that takes you to `
      + `${gt.points_to_win} and wins it.`,
    available: (gt) => Number(gt.points_to_win) > 0,
    mechanical: true,
    achieved: (state, side, ctx) => {
      const target = Number(state.gameType?.points_to_win) || 0;
      if (!target) return false;
      return getPlayerScore(state, Number(side)) >= target;
    },
  },

  control_square: {
    label: 'Take a control square',
    describe: () => 'Find the move that puts one of your pieces on a control square.',
    available: (gt) => !!gt.squares_condition || !!gt.control_squares_string,
    mechanical: true,
    achieved: (state, side, ctx) => {
      const squares = controlSquareKeys(state.gameType);
      if (!squares.size) return false;
      const moved = ctx.movingPiece;
      return !!moved && squares.has(`${moved.y},${moved.x}`)
        && Number(moved.team ?? moved.player_id) === Number(side);
    },
  },

  win_in_1: {
    label: 'Win on the spot',
    describe: () => 'Find the move that ends the game in your favor.',
    // The catch-all for games whose win condition has no goal of its own.
    available: () => true,
    mechanical: true,
    achieved: (state, side, ctx) => {
      const win = checkWinCondition(state, ctx.captured);
      return !!(win && win.gameOver && win.winner === `puzzle_p${side}`);
    },
  },

  // Judged by the creator and by the people solving it, not by the server.
  win_material: {
    label: 'Win material',
    describe: (gt, p) => p.goal_description || 'Win material.',
    available: () => true,
    mechanical: false,
  },
  specific_move: {
    label: 'Find this exact move',
    describe: (gt, p) => p.goal_description || 'Find the move the creator had in mind.',
    available: () => true,
    mechanical: false,
  },
  custom: {
    label: 'Something else',
    describe: (gt, p) => p.goal_description || 'See the description.',
    available: () => true,
    mechanical: false,
  },
};

const GOALS = Object.fromEntries(Object.keys(GOAL_DEFS).map(k => [k.toUpperCase(), k]));
/*
 * Goals the OPPONENT's move completes: they take your last piece, or their reply
 * leaves you stalemated. A line for one ends on that reply, the search looks
 * through it (puzzle-search.js), and the last solver move has to be the only
 * one that works - the solve route cannot credit a different finishing move
 * when the finish is the opponent's.
 */
const REPLY_COMPLETED_GOALS = new Set(['lose_all_pieces', 'get_stalemated']);

const MECHANICAL_GOALS = new Set(
  Object.entries(GOAL_DEFS).filter(([, d]) => d.mechanical).map(([k]) => k)
);

/** Control squares, merged with any custom square flagged asControl. Keyed "y,x". */
function controlSquareKeys(gameType) {
  const out = new Set();
  if (!gameType) return out;
  const parse = (v) => {
    if (!v) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; }
  };
  const control = parse(gameType.control_squares_string);
  if (control && typeof control === 'object') for (const k of Object.keys(control)) out.add(k);
  const special = parse(gameType.special_squares_string);
  if (special && typeof special === 'object') {
    for (const [k, cfg] of Object.entries(special)) if (cfg && cfg.asControl) out.add(k);
  }
  return out;
}

/**
 * Which goals this game type can actually offer, in the order the builder should
 * list them. The catch-all and the declarative goals are always last.
 */
function goalsForGameType(gameType) {
  const gt = gameType || {};
  /*
   * 0  a goal that decides the game outright
   * 1  the generic "win on the spot" catch-all
   * 2  a goal its own rank() demotes - stalemate in a game where it only draws
   * 3  the declarative ones the server cannot judge
   *
   * Ties keep declaration order, which runs roughly most to least specific.
   */
  const rank = (key) => {
    const d = GOAL_DEFS[key];
    if (!d.mechanical) return 3;
    if (key === 'win_in_1') return 1;
    return typeof d.rank === 'function' ? (d.rank(gt) ? 2 : 0) : 0;
  };
  return Object.entries(GOAL_DEFS)
    .filter(([, d]) => d.available(gt))
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([value, d]) => ({ value, label: d.label, mechanical: d.mechanical }));
}

/** The sentence shown to a solver, so a goal is never a mystery. */
function describeGoal(puzzle, gameType) {
  const def = GOAL_DEFS[puzzle?.goal];
  if (!def) return puzzle?.goal_description || null;
  return def.describe(gameType || {}, puzzle || {});
}

/* ------------------------------------------------------------------ state -- */

/** Stable identity for a move, so two descriptions of the same move compare equal. */
/* --------------------------------------------------------- placement plies --
 *
 * In some games a turn is not "move a piece from here to there" - it is "put a
 * piece down". Go is the pure case: a stone has every movement column set to
 * zero, so placing one IS the game and a puzzle whose answer must be a move
 * could never be written for it at all.
 *
 * A placement ply borrows the live game's own shape rather than inventing one:
 * { type: 'place', placePieceId, to: {x, y} }. The same three fields the socket
 * handler reads off a deploy. WHOSE piece it is is deliberately not stored - it
 * is whoever's turn it is at that point in the line, which removes a whole
 * class of ply that disagrees with the position it sits in.
 */
const isPlacementPly = (ply) => !!ply && ply.type === 'place';

/** The game's placement settings, or null when it does not place pieces. */
function placementRules(gameType) {
  const data = parseOtherGameData(gameType);
  if (!data?.place_pieces_action) return null;
  return {
    data,
    templates: Array.isArray(data.placeable_pieces) ? data.placeable_pieces : [],
  };
}

/** other_game_data as an object, whether it arrived as one or as JSON text. */
function parseOtherGameData(gameType) {
  const raw = gameType?.other_game_data;
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function moveKey(move) {
  if (!move) return '';
  const extra = move.promotionPieceId ? `|P${move.promotionPieceId}` : '';
  return boardMoveKey(move) + extra;
}

/**
 * The move WITHOUT its promotion choice.
 *
 * Two different ways to answer a puzzle are two different moves; promoting the
 * same pawn to a queen or to a rook is one move with a choice attached. Counting
 * distinct solutions on the full moveKey makes every promoting move look like as
 * many solutions as there are pieces to promote into, so a single forced
 * promotion reports as "4 moves achieve this" and the creator is told their
 * unique puzzle is ambiguous.
 *
 * The choice still matters to a solver - moveKey keeps it, so answering with the
 * wrong piece is off the line - it just does not make a second solution.
 */
function boardMoveKey(move) {
  if (!move) return '';
  /*
   * A placement has no origin square, so the piece being placed takes the
   * origin's place in the key. Two different pieces put on the same square are
   * two different answers; the same piece on two squares likewise.
   */
  if (isPlacementPly(move)) {
    const to = move.to ? `${move.to.x},${move.to.y}` : '?';
    return `place${move.placePieceId ?? ''}>${to}`;
  }
  const from = move.from ? `${move.from.x},${move.from.y}` : '?';
  const to = move.to ? `${move.to.x},${move.to.y}` : '?';
  const extra = [
    move.pieceId ?? '',
    move.isRangedAttack ? 'R' : '',
    move.isCastling ? `C${move.castlingWith ?? ''}` : '',
    move.via ? `V${move.via.x},${move.via.y}` : '',
  ].filter(Boolean).join('|');
  return `${from}>${to}${extra ? '#' + extra : ''}`;
}

/**
 * A puzzle is solved from a game-shaped state; build one the engine accepts.
 *
 * The setup move is what makes this more than a bag of pieces - see the note at
 * the top of the file. Applying it costs nothing (the piece is already on its
 * destination) but it is what tells the engine whether en passant is live.
 */
function buildGameState(puzzle, gameType) {
  const state = {
    // Deep-copied per candidate move: validateAndApplyMove mutates.
    pieces: JSON.parse(JSON.stringify(puzzle.position)),
    gameType,
    // applyPromotionToPiece reads this to find the per-placement overrides that
    // make custom promotion custom.
    gameTypeId: gameType?.id ?? puzzle.game_type_id ?? null,
    currentTurn: puzzle.side_to_move,
    status: 'active',
    moveHistory: [],
    players: [
      { id: 'puzzle_p1', position: 1, username: 'Player 1' },
      { id: 'puzzle_p2', position: 2, username: 'Player 2' },
    ],
    timeControl: null,
    /*
     * PARSED, not the raw column. game_types.other_game_data is JSON text, and
     * handing the string through meant every rule that reads it - placement,
     * flanking, surround capture, the scoring model - was reading undefined off
     * a String. A live game parses it in every one of its own entry points;
     * this was the one path that did not.
     */
    otherGameData: parseOtherGameData(gameType),
    // What a placed piece can do, by piece id (puzzle-hydrate's
    // placeableDefinitions). The placeable template itself is only a name and
    // artwork.
    placeableDefs: puzzle.placeable_definitions || null,
    enPassantTarget: null,
    /*
     * The game's STARTING roster, not this puzzle's handful of pieces.
     *
     * getPromotionOptions works out what a piece may become from the piece types
     * the game started with, so that a queen already captured is still on the
     * promotion menu. Hand it a puzzle position instead and a pawn racing to the
     * eighth rank with only kings left on the board is offered nothing at all,
     * and the promotion is silently skipped. The caller hydrates this from the
     * game type's pieces_string; without it the sparse position is the fallback
     * and behaves as it always did.
     */
    initialPieces: Array.isArray(puzzle.initial_pieces) && puzzle.initial_pieces.length
      ? puzzle.initial_pieces
      : null,
    /*
     * The running score. A points game is won by reaching a total, so a puzzle
     * in one has to start from a real score rather than zero - otherwise "find
     * the move that wins" is unanswerable, because no single capture could ever
     * get there from nothing.
     *
     * Stored on the puzzle when it matters; otherwise the game type's opening
     * points, which is what a live game starts from.
     */
    captureScores: {
      1: Number(puzzle.capture_scores?.[1] ?? gameType?.starting_points_p1 ?? 0) || 0,
      2: Number(puzzle.capture_scores?.[2] ?? gameType?.starting_points_p2 ?? 0) || 0,
    },
  };

  /*
   * A puzzle is a mid-game position, so any piece that is "inactive for the
   * first N plies" (min_turns_per_move) has long since woken up. There is no
   * real ply count to reconstruct, so seed it past every such restriction in
   * the position - otherwise the move generator reads gamePly 0 and these
   * pieces generate no moves at all, which is why a turn-limited rook or king
   * showed nothing on hover and could not appear in a solution.
   */
  state.totalHalfMoves = state.pieces.reduce(
    (m, p) => Math.max(m, Number(p.min_turns_per_move) || 0), 0);

  /*
   * Resolve castling partners before anything asks for a move.
   *
   * The game type stores partners as KEYS ("row,col" of the starting square) or
   * leaves them to be auto-discovered along the rank; the move generator wants
   * board ids. A live game resolves them once when the game is set up, and a
   * puzzle has to do the same or piece.castling_partner_left_id is undefined for
   * every piece and castling is never generated - which looked exactly like
   * "puzzles do not support castling".
   */
  initializeCastlingPartners(state);

  applySetupMove(state, puzzle.setup_move);
  return state;
}

/**
 * Teach the state what the opponent just did.
 *
 * The piece is already standing on the destination - the position is post-move -
 * so nothing is applied. What this does is mark the piece as having moved and
 * ask the live-game helper whether that move left an en passant target behind.
 *
 * A piece that made a first-move-only double step necessarily had moveCount 0
 * before it, which is why setting 1 here is safe rather than a guess: any move
 * deriveEnPassantTarget accepts is one only an unmoved piece could have made.
 */
function applySetupMove(state, setupMove) {
  if (!setupMove || !setupMove.from || !setupMove.to) return;
  const { from, to } = setupMove;
  const piece = state.pieces.find(p => Number(p.x) === Number(to.x) && Number(p.y) === Number(to.y));
  if (!piece) return;

  piece.moveCount = Math.max(Number(piece.moveCount) || 0, 1);
  piece.hasMoved = true;
  state.enPassantTarget = deriveEnPassantTarget(piece, from, to) || null;
}

/* ------------------------------------------------------------------ plies -- */

/**
 * Apply one ply to a state, promotion included.
 *
 * The engine reports that a move promotes but deliberately does not carry it
 * out - a live game stops and asks the player what to become. A puzzle has to
 * make that same choice explicitly, so a promoting ply carries promotionPieceId
 * (and promotionPlayer, for the cross-player and neutral promotions the game
 * wizard allows). Without it the rest of the line would be validated against a
 * board where the piece never promoted.
 *
 * Returns { ok, reason, promotionEligible, captured, movingPiece }.
 */
/**
 * Put a piece down, under exactly the rules a live game would apply.
 *
 * Every check here is the live handler's check, called through the same
 * exported function rather than reimplemented - square empty, square allowed,
 * the piece eligible for this player, the self-capture ban, the repetition
 * (ko) ban - and the two capture resolutions that follow a deploy, flanking
 * (Othello) and surround (Go). A puzzle that accepted a placement the game
 * would refuse would be teaching a variant that does not exist.
 *
 * TWO DELIBERATE DIFFERENCES from the live handler, both because a puzzle is a
 * position rather than a game with a history:
 *
 *  - Reserves are not counted. A limited piece bank is spent over a whole game,
 *    and a puzzle has no record of what came before it; treating the position
 *    as "whatever is left" is the only answer that does not invent a number.
 *  - The turn is not advanced here. applyPly's callers own the turn, because a
 *    solution line alternates by index rather than by what the engine did.
 *
 * Returns the same { ok, reason } shape as a move, so callers do not branch.
 */
async function applyPlacementPly(state, ply) {
  const rules = placementRules(state.gameType);
  if (!rules) return { ok: false, reason: 'this game does not place pieces' };

  const rawX = Number(ply?.to?.x);
  const rawY = Number(ply?.to?.y);
  const width = Number(state.gameType?.board_width) || 8;
  const height = Number(state.gameType?.board_height) || 8;
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)
      || rawX < 0 || rawX >= width || rawY < 0 || rawY >= height) {
    return { ok: false, reason: 'that square is not on the board' };
  }

  /*
   * Gravity, resolved the same way the live game resolves it: the square in
   * the ply is where the solver aimed, and the piece lands at the foot of that
   * column. Without this a puzzle in a Connect-Four-shaped game would accept
   * an answer hanging in mid-air.
   */
  const gravity = gravityOf(state.gameType);
  let x = rawX;
  let y = rawY;
  if (gravity) {
    const landed = restingSquare(
      gravity, { x, y }, width, height,
      (gx, gy) => (state.pieces || []).some((p) => Number(p.x) === gx && Number(p.y) === gy)
    );
    if (!landed) return { ok: false, reason: 'that column is full' };
    x = landed.x;
    y = landed.y;
  } else if ((state.pieces || []).some((p) => Number(p.x) === x && Number(p.y) === y)) {
    return { ok: false, reason: 'that square is occupied' };
  }

  const player = Number(state.currentTurn);
  const customSquares = parseCustomSquares(state.gameType);
  if (customSquares && !isPlacementSquareAllowed(customSquares, player, x, y)) {
    return { ok: false, reason: 'a piece may not be placed on that square' };
  }

  const template = ply.placePieceId != null
    ? rules.templates.find((t) => Number(t.piece_id) === Number(ply.placePieceId))
    : rules.templates[0];
  if (!template) return { ok: false, reason: 'that piece cannot be placed in this game' };
  if (!isPlaceableEligibleFor(template, player)) {
    return { ok: false, reason: `Player ${player} cannot place that piece` };
  }

  if (placementViolatesSelfCapture(state, x, y, player, template)) {
    return { ok: false, reason: 'that placement would capture itself' };
  }
  if (placementRepeatsBannedPosition(state, x, y, player, template)) {
    return { ok: false, reason: 'that placement would repeat a previous board position' };
  }

  /*
   * Flanking games (Othello) may REQUIRE a deploy to flank something. Asked
   * before the piece goes down, exactly as the live handler asks it.
   */
  let flankingHere = null;
  if (rules.data.flanking_captures) {
    const valid = getValidFlankingPlacements(state, player) || [];
    flankingHere = valid.find((v) => Number(v.x) === x && Number(v.y) === y) || null;
    if (rules.data.must_flank && !flankingHere) {
      return { ok: false, reason: 'a piece must be placed where it flanks an opponent' };
    }
  }

  /*
   * The engine piece. Spread from the template first, the same way the live
   * handler does, so a placeable piece's movement and capture rules survive
   * into the position - a placed piece that can later move must be able to.
   */
  const placedIsNeutral = !!template.is_neutral;
  const team = placedIsNeutral ? 0 : player;
  /*
   * The placing side's own artwork, chosen exactly as the live game chooses
   * it. The template's image_url is ONE picture - usually player 1's - and
   * every board prefers image_url over the per-player list, so copying it
   * painted the opponent's placements in the solver's colour (Clobber Four,
   * puzzles 93 and 95).
   */
  const placedImageUrl = template.image_location
    ? getImageUrlForPlayer(template.image_location, player, placedIsNeutral ? (template.neutral_image_index ?? null) : null)
    : template.image_url;
  state.pieces.push({
    // The piece's own definition first, as the live game's enriched template
    // does, so a placed piece moves and captures like any other.
    ...(state.placeableDefs?.[Number(template.piece_id)] || {}),
    ...template,
    id: `placed_${x}_${y}_${state.pieces.length}`,
    piece_id: Number(template.piece_id),
    piece_name: template.name || template.piece_name || 'Placed Piece',
    image_url: placedImageUrl,
    image_location: template.image_location,
    x, y,
    team,
    player_id: team,
    is_neutral: placedIsNeutral,
    // A piece that has just been placed has not moved, whatever the geography
    // would otherwise infer - it did not walk there.
    hasMoved: false,
    moveCount: 0,
    hit_points: template.hit_points ?? 1,
    current_hp: template.hit_points ?? 1,
    attack_damage: template.attack_damage ?? 1,
    piece_width: template.piece_width ?? 1,
    piece_height: template.piece_height ?? 1,
  });

  let captured = [];
  if (flankingHere) {
    captured = applyFlankingCaptures(state, x, y, player) || [];
  }

  const surrounded = resolveSurroundCaptures(state, player) || [];
  if (surrounded.length) {
    applySurroundCaptureScoring(state, surrounded, player);
    captured = captured.concat(surrounded);
  }

  // A deploy brings new material to the board, so it resets the drawn-game
  // counter for the same reason a pawn move does in chess.
  state.movesWithoutCapture = 0;
  state.moveHistory.push({ type: 'place', to: { x, y }, position: player });

  return { ok: true, reason: null, promotedTo: null, promotionEligible: null, captured };
}

async function applyPly(state, ply, { autoPromote = false, listPromotions = false } = {}) {
  if (isPlacementPly(ply)) return applyPlacementPly(state, ply);

  let applied;
  try {
    applied = await validateAndApplyMove(state, ply, { skipTurnCheck: true });
  } catch (err) {
    return { ok: false, reason: `engine rejected the move: ${err.message}` };
  }
  if (applied && applied.valid === false) {
    return { ok: false, reason: applied.reason || 'illegal move' };
  }

  let promotedTo = null;
  const eligible = applied?.promotionEligible;
  if (eligible && eligible.eligible) {
    let pieceId = ply.promotionPieceId;
    let player = ply.promotionPlayer;

    if (pieceId == null && autoPromote) {
      /*
       * Testing somebody ELSE'S move for the uniqueness check. The creator never
       * chose anything for it, so take the game's first offered option - which is
       * what the engine considers the default - rather than skipping the
       * promotion and comparing against a board that could not occur.
       */
      const options = await getPromotionOptions(state, applied.movingPiece);
      if (options && options.length) {
        pieceId = options[0].id ?? options[0].piece_id;
        player = options[0].player ?? null;
      }
    }

    if (pieceId == null) {
      /*
       * listPromotions: the search (puzzle-search.js) plays every choice as its
       * own move, since an under-promotion can be the only win - or the only
       * defence - and autoPromote's first option would never find it.
       */
      let promotionOptions;
      if (listPromotions) {
        const options = await getPromotionOptions(state, applied.movingPiece);
        promotionOptions = (options || []).map(o => ({
          promotionPieceId: o.id ?? o.piece_id,
          promotionPlayer: o.player ?? null,
        })).filter(o => o.promotionPieceId != null);
      }
      return {
        ok: false,
        reason: 'this move promotes - record which piece it becomes',
        needsPromotionChoice: true,
        promotionEligible: eligible,
        promotionOptions,
      };
    }
    try {
      await applyPromotionToPiece(state, applied.movingPiece.id, pieceId, player ?? null);
      promotedTo = { promotionPieceId: pieceId, promotionPlayer: player ?? null };
    } catch (err) {
      return { ok: false, reason: `promotion failed: ${err.message}` };
    }
  }

  /*
   * Capture points, through the same helper the live game uses. Without this a
   * points puzzle's score never moves and its goal can never be met.
   */
  const taken = applied?.allCaptured?.length
    ? applied.allCaptured
    : (applied?.captured ? [applied.captured] : []);
  applyCapturePoints(state, taken, Number(state.currentTurn));

  return {
    ok: true,
    reason: null,
    promotedTo,
    promotionEligible: eligible || null,
    // For promotion_condition_requires_empty: see promotionReachWins in
    // server/game-socket.js. A puzzle whose goal is "get there and win" has to
    // agree with the live game about when getting there is a win.
    destinationWasOccupied: !!applied?.destinationWasOccupied,
    capturedSomething: !!(applied?.captured
      || applied?.allCaptured?.length
      || applied?.hoppedCaptures?.length),
    // undefined from an engine path that does not report it means "survived";
    // only an explicit false is a death.
    moverSurvived: applied?.moverSurvived !== false,
    captured: applied?.allCaptured?.length ? applied.allCaptured : (applied?.captured || null),
    movingPiece: state.pieces.find(p => p.id === applied?.movingPiece?.id) || applied?.movingPiece || null,
  };
}

/** Apply a move to a fresh copy of the position. */
async function applyToFreshState(puzzle, gameType, move, opts) {
  const state = buildGameState(puzzle, gameType);
  const res = await applyPly(state, move, opts);
  return { ok: res.ok, state: res.ok ? state : null, reason: res.reason, ctx: res };
}

/**
 * Apply a whole line, ply by ply, to one state.
 *
 * Returns { ok, state, plyIndex, reason }. plyIndex is the move that failed,
 * counted from 0, so a creator can be told WHICH move in the line is wrong.
 */
async function playLine(puzzle, gameType, line) {
  const state = buildGameState(puzzle, gameType);
  const them = other(puzzle.side_to_move);
  let last = null;
  for (let i = 0; i < line.length; i++) {
    /*
     * The engine decides whose piece a move may touch from gameState.currentTurn
     * and does not advance it itself - a live game does that in its own flow.
     * Alternate it by hand or every reply comes back as "Not your piece".
     */
    state.currentTurn = i % 2 === 0 ? puzzle.side_to_move : them;
    // eslint-disable-next-line no-await-in-loop -- strictly sequential: each move
    // is made from the position the previous one left behind.
    const res = await applyPly(state, line[i]);
    if (!res.ok) return { ok: false, state, plyIndex: i, reason: res.reason, ctx: res };
    last = res;
  }
  return { ok: true, state, plyIndex: -1, reason: null, ctx: last };
}

/**
 * En passant captures that are available but would never be enumerated.
 *
 * getAllLegalMovesForPlayer builds its list from getPossibleMovesForPiece, which
 * is handed the pieces and the game type but not the game state - so it cannot
 * see enPassantTarget and never offers the capture. validateAndApplyMove accepts
 * it perfectly well; it is only the enumeration that is blind.
 *
 * That gap does not stop an en passant puzzle from validating (the intended move
 * is applied directly), but it would quietly weaken the uniqueness check: a
 * position with two ways to mate would be reported as having one. These
 * candidates are offered on the same conditions the engine itself applies, and
 * anything not actually legal is rejected when it is played.
 */
function enPassantCandidates(state, side) {
  const ept = state.enPassantTarget;
  if (!ept || !ept.captureSquare) return [];
  const victim = state.pieces.find(p => p.id === ept.pieceId);
  if (!victim) return [];
  if (Number(victim.team ?? victim.player_id) === Number(side)) return [];

  return state.pieces
    .filter(p => p.can_en_passant
      && Number(p.team ?? p.player_id) === Number(side)
      && p.piece_id === victim.piece_id
      && p.y === victim.y
      && Math.abs(p.x - victim.x) === 1)
    .map(p => ({
      pieceId: p.id,
      from: { x: p.x, y: p.y },
      to: { x: ept.captureSquare.x, y: ept.captureSquare.y },
    }));
}

/** Does this state meet the puzzle's goal for the side to move? */
/**
 * Every piece this player could put down, as candidate plies.
 *
 * Needed for the same reason the moves are enumerated: a "find the move"
 * uniqueness check that only looked at moves would report "no legal move
 * achieves this" for a game whose every turn is a placement, and would miss a
 * second winning placement in a game that has both.
 *
 * Cheap because it only proposes: every empty square times every template the
 * player may deploy, with the expensive rules (self-capture, ko, flanking)
 * left to applyPlacementPly, which the caller runs on each candidate anyway.
 * On a 9x9 Go board with one stone that is 81 proposals; the enumeration of
 * moves it sits beside is routinely larger.
 *
 * Returns [] for every game that does not place pieces, which is nearly all of
 * them - so nothing about validating a chess puzzle changes.
 */
function placementCandidates(state, side) {
  const rules = placementRules(state.gameType);
  if (!rules || !rules.templates.length) return [];

  const width = Number(state.gameType?.board_width) || 8;
  const height = Number(state.gameType?.board_height) || 8;
  const occupied = new Set((state.pieces || []).map((p) => `${Number(p.y)},${Number(p.x)}`));
  const customSquares = parseCustomSquares(state.gameType);
  const zone = customSquares ? getPlacementConfinementZone(customSquares, side) : null;

  /*
   * On a gravity board there is one square per column, not one per empty
   * square - a piece dropped anywhere in a column lands at the same place, so
   * every other square in it is the same answer wearing a different hat. The
   * live move generator makes the same distinction.
   */
  const gravity = gravityOf(state.gameType);
  const isOccupied = (gx, gy) => occupied.has(`${gy},${gx}`);

  const out = [];
  for (const template of rules.templates) {
    if (!isPlaceableEligibleFor(template, side)) continue;
    const pieceId = Number(template.piece_id);
    if (!Number.isFinite(pieceId)) continue;
    const seen = new Set();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let tx = x;
        let ty = y;
        if (gravity) {
          const landed = restingSquare(gravity, { x, y }, width, height, isOccupied);
          if (!landed) continue;
          tx = landed.x;
          ty = landed.y;
          const key = `${ty},${tx}`;
          if (seen.has(key)) continue;
          seen.add(key);
        } else if (occupied.has(`${y},${x}`)) {
          continue;
        }
        if (customSquares && !isPlacementSquareAllowed(customSquares, side, tx, ty, zone)) continue;
        out.push({ type: 'place', placePieceId: pieceId, to: { x: tx, y: ty } });
      }
    }
  }
  return out;
}

/**
 * Who, if anybody, wins in this position - INCLUDING by stalemate.
 *
 * checkWinCondition does not answer this on its own. Stalemate is decided in
 * the live game's move handler, not there, so a position where the player to
 * move has no legal moves comes back from checkWinCondition as
 * `{ gameOver: false }` - which is how a puzzle could be built whose solution
 * hands the game to the opponent and have every check pass.
 *
 * The order below mirrors that handler exactly, and the order is the whole
 * point:
 *
 *   no_moves_condition      wins outright, and the stalemate rules are skipped
 *                           entirely when it is set - a player with no legal
 *                           move LOSES, in check or not.
 *   in check, no moves      checkmate: the player to move loses.
 *   stalemate_win_condition the STALEMATED player wins. This is the inverted
 *                           case, and it takes priority over the draw flag
 *                           when a game sets both - as Antichess does.
 *   stalemate_draw          a draw.
 *   none of the above       nothing happens; the live game skips the turn.
 *
 * @param toMove the player whose turn it is in the position being judged
 * @returns {{winner: number|null, reason: string}|null} - null when the game
 *   continues, and `winner: null` for a draw.
 */
function terminalOutcome(state, toMove, ctx) {
  const mover = Number(toMove);
  const opponent = other(mover);

  // Anything the shared win check already decides - capture, elimination, a
  // line, points, the lot.
  try {
    const win = checkWinCondition(state, ctx?.captured);
    if (win && win.gameOver) {
      const match = /^puzzle_p(\d+)$/.exec(String(win.winner || ''));
      return { winner: match ? Number(match[1]) : null, reason: win.reason || 'win' };
    }
  } catch (_) { /* fall through to the move-based endings */ }

  const gameType = state.gameType || {};
  let hasMoves = true;
  try {
    hasMoves = (getAllLegalMovesForPlayer(state, mover) || []).length > 0;
  } catch (_) { return null; }
  if (hasMoves) return null;

  if (gameType.no_moves_condition) {
    return { winner: opponent, reason: 'no_moves' };
  }

  let inCheck = false;
  try { inCheck = !!checkForCheck(state, mover).inCheck; } catch (_) { inCheck = false; }
  if (inCheck) {
    return gameType.mate_condition ? { winner: opponent, reason: 'checkmate' } : null;
  }

  if (gameType.stalemate_win_condition) {
    // The stalemated player WINS. Antichess and its relatives.
    return { winner: mover, reason: 'stalemate_win' };
  }
  if (gameType.stalemate_draw_condition !== false && gameType.stalemate_draw_condition !== 0) {
    return { winner: null, reason: 'stalemate' };
  }
  return null;   // no stalemate rule: the live game just skips the turn
}

function goalMet(goal, state, side, ctx) {
  const def = GOAL_DEFS[goal];
  if (!def || !def.mechanical) return false;
  let achieved;
  try {
    achieved = !!def.achieved(state, side, ctx || {});
  } catch (_) {
    return false;
  }
  if (!achieved) return false;

  /*
   * And the game must not have been handed to the OPPONENT.
   *
   * Every goal above describes a thing to do; none of them asked who ends up
   * winning, which is fine until a game inverts an outcome. Antichess is the
   * case that found this: stalemating the opponent satisfies "stalemate the
   * opponent" perfectly, and in a game where being stalemated WINS it means
   * the opponent has just won. A puzzle built on that tells the solver they
   * have succeeded while showing them a loss.
   *
   * Checked here rather than inside each goal so it cannot be forgotten by the
   * next goal somebody adds. A draw is deliberately allowed through: the
   * stalemate goal in a stalemate-DRAW game says out loud that it splits the
   * point, which may be the best available.
   */
  const outcome = terminalOutcome(state, other(side), ctx);
  if (outcome && outcome.winner != null && Number(outcome.winner) !== Number(side)) {
    return false;
  }
  return true;
}

/* -------------------------------------------------------------- validate -- */

/**
 * Check a puzzle as far as the server is able.
 *
 * Returns { status, solutions, intendedWorks, detail }. Callers should treat a
 * non-VALID status as something to show the creator, never as a reason to
 * refuse the save.
 */

/**
 * Every move this player can ACTUALLY make from this position.
 *
 * getAllLegalMovesForPlayer is a generator, not an arbiter: it enumerates what
 * the pieces reach and leaves the rules that refuse a move to the engine. In a
 * forced-capture game it happily lists all fourteen rook moves when thirteen of
 * them would be rejected. So each candidate is offered to the engine, on its
 * own copy of the position, and only the ones it accepts are counted.
 *
 * En passant and placements are added the way the one-ply checker adds them,
 * because the generator cannot see them - and a missed candidate here would
 * make a position look MORE forced than it is, which is the direction that
 * matters.
 *
 * Capped, because this is a move application per candidate. Over the cap it
 * returns null, meaning "too many to establish", and the caller falls back to
 * the honest "your call" answer.
 */
async function trulyLegalMoves(state, player, cap = 80) {
  const candidates = [
    ...(getAllLegalMovesForPlayer(state, player) || []),
    ...enPassantCandidates(state, player),
    ...placementCandidates(state, player),
  ];
  if (candidates.length > cap) return null;

  const accepted = [];
  for (const candidate of candidates) {
    const trial = { ...state, pieces: JSON.parse(JSON.stringify(state.pieces)), moveHistory: [] };
    trial.currentTurn = player;
    // eslint-disable-next-line no-await-in-loop -- the engine mutates the
    // pieces it is given, so these must not overlap.
    const res = await applyPly(trial, candidate, { autoPromote: true });
    if (res.ok || res.needsPromotionChoice) accepted.push(candidate);
  }
  return accepted;
}

/**
 * Was every one of the opponent's replies in this line their ONLY legal move?
 *
 * The note at the top of this file says a longer line cannot be judged for
 * forcedness, because the replies are the creator's script rather than an
 * engine's best defence. That is true when the opponent has a choice. It is
 * not true when they have exactly one move - and a forced-capture game
 * produces that constantly, which is the whole mechanism behind a bait in
 * antichess.
 *
 * Returns { forced, checked }. forced is false the moment a reply had an
 * alternative, or a position had too many candidates to establish.
 */
async function repliesWereForced(puzzle, gameType, line) {
  const state = buildGameState(puzzle, gameType);
  let toMove = Number(puzzle.side_to_move);
  let checked = 0;

  for (let i = 0; i < line.length; i++) {
    if (i % 2 === 1) {
      // eslint-disable-next-line no-await-in-loop
      const legal = await trulyLegalMoves(state, toMove);
      if (!legal || legal.length !== 1) return { forced: false, checked };
      if (moveKey(legal[0]) !== moveKey(line[i])) return { forced: false, checked };
      checked++;
    }
    state.currentTurn = toMove;
    // eslint-disable-next-line no-await-in-loop
    const res = await applyPly(state, line[i], { autoPromote: true });
    if (!res.ok) return { forced: false, checked };
    toMove = other(toMove);
  }
  return { forced: checked > 0, checked };
}

/**
 * Which OTHER opening moves also win by force, if any.
 *
 * Asked only when the replies are forced, and only for a two-ply line - which
 * is what a bait is: your move, their one answer. Anything longer becomes a
 * search, and a search is what this file deliberately does not do.
 *
 * For each alternative first move the opponent's replies are enumerated the
 * same honest way; if EVERY reply leaves the goal met, that alternative forces
 * the result too and the puzzle has more than one answer.
 *
 * Returns null when there were too many candidates to establish.
 */
async function otherForcedWins(puzzle, gameType, intended) {
  const side = Number(puzzle.side_to_move);
  const first = await trulyLegalMoves(buildGameState(puzzle, gameType), side);
  if (!first) return null;

  const others = [];
  for (const candidate of first) {
    if (boardMoveKey(candidate) === boardMoveKey(intended)) continue;

    const state = buildGameState(puzzle, gameType);
    state.currentTurn = side;
    // eslint-disable-next-line no-await-in-loop
    const mine = await applyPly(state, candidate, { autoPromote: true });
    if (!mine.ok) continue;

    // eslint-disable-next-line no-await-in-loop
    const replies = await trulyLegalMoves(state, other(side));
    if (!replies || !replies.length) continue;

    let alwaysWins = true;
    for (const reply of replies) {
      const after = { ...state, pieces: JSON.parse(JSON.stringify(state.pieces)), moveHistory: [] };
      after.currentTurn = other(side);
      // eslint-disable-next-line no-await-in-loop
      const res = await applyPly(after, reply, { autoPromote: true });
      if (!res.ok) { alwaysWins = false; break; }
      after.currentTurn = side;
      if (!goalMet(puzzle.goal, after, side, res)) { alwaysWins = false; break; }
    }
    if (alwaysWins) others.push(candidate);
  }
  return others;
}

/*
 * First moves that win the game outright, by whatever rule this game is won.
 *
 * A "Mate in four" whose first move can simply take the King is not a mate in
 * four (puzzle 52: a hopping piece already lined up on a King in a game won by
 * capture). The creator's line may be perfectly legal and still not be the
 * puzzle, because the solver has something quicker. Asked only of multi-move
 * lines; a one-move puzzle's own enumeration already covers its alternatives.
 *
 * Same candidate list as the one-move check, including the creator's own first
 * move - a line whose FIRST move already ends the game has moves after the end.
 */
async function immediateWins(puzzle, gameType, intended) {
  const side = Number(puzzle.side_to_move);
  const base = buildGameState(puzzle, gameType);
  const candidates = [
    ...(getAllLegalMovesForPlayer(base, side) || []),
    ...enPassantCandidates(base, side),
    ...placementCandidates(base, side),
  ];
  if (intended && !candidates.some((m) => moveKey(m) === moveKey(intended))) candidates.push(intended);

  const wins = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = boardMoveKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    // eslint-disable-next-line no-await-in-loop -- the engine mutates shared structures
    const { ok, state, ctx } = await applyToFreshState(puzzle, gameType, candidate, { autoPromote: true });
    if (!ok) continue;
    const outcome = terminalOutcome(state, other(side), ctx);
    if (outcome && Number(outcome.winner) === side) wins.push(candidate);
  }
  return wins;
}

/*
 * What a line misses, in words: "at your move 2, after Rook a1 to a8, the
 * opponent can defend with King g8 to h7 or King g8 to f7, and then ..."
 *
 * All the defenses when there are three or fewer; otherwise one, with how many
 * more there are. Also names a move that DOES force it there, when one does -
 * the fix, usually. `others` is that step's forcing moves (verifyPuzzleLine).
 */
async function describeNotForced(puzzle, gameType, line, step, label, others = [], opts = {}) {
  const { defensesAgainst } = require('./puzzle-search');
  let found = null;
  try {
    found = await defensesAgainst(puzzle, gameType, line, step, { aim: opts.aim || puzzle.goal, budgetMs: opts.budgetMs || 60000, dutyCycle: opts.dutyCycle, max: 3 });
  } catch (_) { found = null; }
  const lineMoveText = found?.before ? describeMoveOn(found.before, gameType, line[(step - 1) * 2]) : null;
  let sentence;
  if (!found || found.notAMove) {
    sentence = `your move ${step} does not force ${label} in the moves left - the opponent has a defense the line does not play.`;
  } else if (found.lastMoveMisses) {
    sentence = `your last move${lineMoveText ? ` (${lineMoveText})` : ''} does not achieve ${label}.`;
  } else if (!found.defenses.length) {
    sentence = `your move ${step}${lineMoveText ? ` (${lineMoveText})` : ''} does not force ${label} in the moves left, `
      + 'but the search ran out of time before it could name the defense.';
  } else {
    const named = found.defenses.map((d) => describeMoveOn(found.after, gameType, d));
    const list = named.length === 1 ? named[0]
      : `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`;
    let which;
    if (found.complete && found.total <= 3) {
      which = found.total === 1 ? `the opponent can defend with ${list}` : `the opponent has ${found.total} defenses: ${list}`;
    } else if (found.complete) {
      which = `the opponent can defend with ${named[0]} (one of ${found.total} defenses)`;
    } else {
      which = `the opponent can defend with ${list} (and maybe more - the search ran out of time)`;
    }
    sentence = `at your move ${step}, after ${lineMoveText || 'the line\'s move'}, ${which} - and then ${label} can no longer be forced in the moves left.`;
  }
  const fixes = (others || []).filter((m) => moveKey(m) !== moveKey(line[(step - 1) * 2]));
  if (fixes.length && found?.before) {
    const shown = fixes.slice(0, 3).map((m) => describeMoveOn(found.before, gameType, m));
    sentence += fixes.length === 1
      ? ` A different move there does force it: ${shown[0]}.`
      : ` ${fixes.length} other moves there do force it: ${shown.join('; ')}${fixes.length > 3 ? ', ...' : ''}.`;
  }
  return sentence;
}

/*
 * A goal named inside a sentence about a whole line: "forces 'checkmate'",
 * and "forces the win" rather than "forces 'win on the spot'", which reads
 * wrongly about a line several moves long.
 */
function lineGoalLabel(goal) {
  if (goal === 'win_in_1') return 'the win';
  return `'${(GOAL_DEFS[goal]?.label || goal || 'the goal').toLowerCase()}'`;
}

/** "Bisasam on d1 takes the King on d8", for telling a creator which move. */
function describeFirstMove(puzzle, gameType, move) {
  return describeMoveOn(buildGameState(puzzle, gameType).pieces, gameType, move);
}

/** The same sentence for a move in any position, given that position's pieces. */
function describeMoveOn(pieces, gameType, move) {
  if (move?.pass) return 'passing (they have no legal move)';
  const base = { pieces };
  const height = Number(gameType?.board_height) || 8;
  const to = move.to ? squareLabel(move.to.x, move.to.y, height) : '?';
  if (isPlacementPly(move)) return `placing a piece on ${to}`;
  const piece = base.pieces.find((p) => p.id === move.pieceId);
  const target = move.to && base.pieces.find((p) => p.id !== move.pieceId && p.x === move.to.x && p.y === move.to.y);
  const from = move.from ? squareLabel(move.from.x, move.from.y, height) : '?';
  const name = piece?.piece_name || 'a piece';
  return target
    ? `${name} on ${from} takes the ${target.piece_name || 'piece'} on ${to}`
    : `${name} from ${from} to ${to}`;
}

/*
 * The two-move check. Budgeted: validation runs while a creator waits, and a
 * search that cannot finish in time says nothing rather than something wrong.
 */
const SEARCH_BUDGET_MS = 15000;

async function checkTwoMoveLine(puzzle, gameType, intended, reached) {
  // Required here: puzzle-search requires this file.
  const { searchWinInTwo } = require('./puzzle-search');
  const label = lineGoalLabel(puzzle.goal);
  const mine = await searchWinInTwo(puzzle, gameType, { aim: puzzle.goal, firstMove: intended, budgetMs: SEARCH_BUDGET_MS });
  if (!mine.supported || !mine.complete || mine.winsInOne.length) return null;

  if (!mine.winsInTwo.length) {
    const refutation = mine.refuted[0]?.refutation || null;
    let said = 'a reply';
    try {
      const after = await playLine(puzzle, gameType, [intended]);
      if (after.ok && refutation) said = describeMoveOn(after.state.pieces, gameType, refutation);
    } catch (_) { /* the plain wording will do */ }
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions: [],
      intendedWorks: false,
      goalReached: reached,
      refutation,
      searched: true,
      detail: `the line is legal, but it is not forced: after your first move the opponent can defend with ${said}, `
        + `and then no move achieves ${label}.`,
    };
  }

  const all = await searchWinInTwo(puzzle, gameType, { aim: puzzle.goal, budgetMs: SEARCH_BUDGET_MS });
  if (!all.complete) {
    return {
      status: VALIDATION.NOT_CHECKABLE,
      solutions: [intended],
      intendedWorks: true,
      goalReached: true,
      searched: true,
      detail: `your first move forces ${label} against every defense (checked). There was not time to check `
        + 'whether a different first move also does.',
    };
  }
  const others = all.winsInTwo.filter((w) => boardMoveKey(w.move) !== boardMoveKey(intended)).map((w) => w.move);
  if (others.length) {
    return {
      status: VALIDATION.AMBIGUOUS,
      solutions: [intended, ...others],
      intendedWorks: true,
      goalReached: true,
      searched: true,
      unique: false,
      detail: `your first move forces ${label} against every defense, but so ${others.length === 1 ? 'does' : 'do'} `
        + `${others.slice(0, 3).map((m) => describeFirstMove(puzzle, gameType, m)).join('; ')}`
        + `${others.length > 3 ? ` and ${others.length - 3} more` : ''}.`,
    };
  }
  return {
    status: VALIDATION.VALID,
    solutions: [intended],
    intendedWorks: true,
    goalReached: true,
    searched: true,
    detail: `checked against every defense: your first move is the only one that forces ${label} in two.`,
  };
}

/** A first move that forces the goal in two, or null (none, or the search could not finish). */
async function forcedWinInTwo(puzzle, gameType) {
  const { searchWinInTwo } = require('./puzzle-search');
  const r = await searchWinInTwo(puzzle, gameType, { aim: puzzle.goal, stopAtFirst: true, budgetMs: SEARCH_BUDGET_MS });
  return r.supported && r.winsInTwo.length ? r.winsInTwo[0] : null;
}

/*
 * The whole-line check (opts.deepLines), for lines of two or three of the
 * solver's moves: every step of the line searched for
 * every move that forces the goal in the moves left (puzzle-search.js
 * verifyPuzzleLine). Seconds to minutes, so it runs only where something has
 * asked for it - the background verification worker - never inside a request
 * or the daily scheduler, where it would hold up the whole server.
 */
async function checkWholeLine(puzzle, gameType, line, reached, opts) {
  const { verifyPuzzleLine } = require('./puzzle-search');
  const label = lineGoalLabel(puzzle.goal);
  const r = await verifyPuzzleLine(puzzle, gameType, line, {
    aim: puzzle.goal, budgetMs: opts.budgetMs || 120000, dutyCycle: opts.dutyCycle, onProgress: opts.onProgress,
  });
  if (!r.supported || !r.complete) return null;
  const pieces = buildGameState(puzzle, gameType).pieces;
  const broken = r.steps.find((st) => !st.lineIncluded);
  if (broken) {
    const why = await describeNotForced(puzzle, gameType, line, broken.step, label, broken.forcing,
      { budgetMs: Math.min(60000, opts.budgetMs || 60000), dutyCycle: opts.dutyCycle });
    return {
      status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false, goalReached: reached, searched: true,
      verification: r, unique: false,
      detail: `the line is legal, but it is not forced: ${why}`,
    };
  }
  /*
   * A puzzle that accepts only the creator's own line (require_exact_line, or a
   * "find this exact move" puzzle checked as a win) tells a solver who finds a
   * different winning LAST move that they are wrong - so there, the last step
   * has to be unique as well.
   */
  // A lose-all line is finished by the opponent's reply, so the solve route
  // cannot recognise a different last move as finishing it either.
  const exact = !!puzzle.require_exact_line || REPLY_COMPLETED_GOALS.has(puzzle.goal);
  const extra = (exact ? r.steps : r.steps.slice(0, -1)).find((st) => st.count > 1);
  if (extra) {
    const others = extra.step === 1
      ? extra.forcing.filter((m) => boardMoveKey(m) !== boardMoveKey(line[0])).slice(0, 3).map((m) => describeMoveOn(pieces, gameType, m))
      : [];
    return {
      status: VALIDATION.AMBIGUOUS, solutions: extra.step === 1 ? extra.forcing : [line[0]], intendedWorks: true,
      goalReached: true, searched: true, verification: r, unique: false,
      detail: `at your move ${extra.step}, ${extra.count} different moves force ${label}`
        + `${others.length ? ` (also ${others.join('; ')})` : ''}. `
        + (exact ? 'This puzzle accepts only your exact line, ' : 'Before the last move only the line\'s move is accepted, ')
        + 'so a solver who finds another would be told it is wrong.',
    };
  }
  const last = r.steps[r.steps.length - 1];
  return {
    status: VALIDATION.VALID, solutions: [line[0]], intendedWorks: true, goalReached: true, searched: true,
    verification: r, unique: r.unique,
    detail: `checked against every defense: at each step your move is the only one that forces ${label}`
      + (last.count > 1 && !exact ? ` (the final move can be played ${last.count} ways, and any of them is accepted).` : '.'),
  };
}

/** The line ends with the solver having won the game. */
async function lineWinsGame(puzzle, gameType, line) {
  if (!line.length) return false;
  const played = await playLine(puzzle, gameType, line);
  if (!played.ok) return false;
  const side = Number(puzzle.side_to_move);
  played.state.currentTurn = other(side);
  const outcome = terminalOutcome(played.state, other(side), played.ctx);
  return !!(outcome && Number(outcome.winner) === side);
}

/*
 * A "find this exact move" puzzle whose line wins the game, validated as a win
 * puzzle that accepts only its own line. null when the line does not win (the
 * creator's call, as before).
 */
async function checkExactLineAsWin(puzzle, gameType, line, opts) {
  if (!(await lineWinsGame(puzzle, gameType, line))) return null;
  const result = await validatePuzzle(
    { ...puzzle, goal: 'win_in_1', require_exact_line: 1 }, gameType, { ...opts, asWin: true }
  );
  return {
    ...result,
    checkedAs: 'win_in_1',
    detail: `Your line wins the game, so it was checked as a win: ${result.detail || (result.status === VALIDATION.VALID ? 'exactly one move wins, and it is yours.' : '')}`,
  };
}

async function validatePuzzle(puzzle, gameType, opts = {}) {
  const line = Array.isArray(puzzle.solution_line)
    ? puzzle.solution_line
    : [puzzle.solution_line].filter(Boolean);
  const intended = line[0];
  const side = puzzle.side_to_move;

  if (!intended) {
    return { status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false, detail: 'no intended solution recorded' };
  }

  const isMechanical = MECHANICAL_GOALS.has(puzzle.goal);

  // Only the opponent's reply can stalemate you, so the line has to include it.
  if (puzzle.goal === 'get_stalemated' && line.length % 2 === 1) {
    return {
      status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false,
      detail: 'you can only be stalemated by the opponent\'s reply - record their reply after your last move too.',
    };
  }

  /*
   * "Find this exact move" is the creator's call - unless the line WINS THE
   * GAME. Then there is something to check it against: the game's own win.
   * Connect-four puzzles are the case that asked for this ("Connect four in
   * four", in a game won by making a line). Checked exactly as a win would be,
   * except that the solve route accepts only the creator's own line here, so
   * the last move has to be the only winner too.
   */
  if (!isMechanical && puzzle.goal === 'specific_move' && !opts.asWin) {
    const asWin = await checkExactLineAsWin(puzzle, gameType, line, opts);
    if (asWin) return asWin;
  }

  /*
   * The goal has to be a way this game is actually won.
   *
   * The builder only offers those (goalsForGameType), but a generator once
   * filed every puzzle as "checkmate", capture-only games included - so a
   * "Mate in four" in a game with no checkmate rule, won instead by taking a
   * piece. The engine's isCheckmate will still answer for such a game (it
   * knows what check looks like), which is exactly why this has to be asked
   * first rather than left to the goal test.
   */
  const goalDef = GOAL_DEFS[puzzle.goal];
  if (isMechanical && gameType && !goalDef.available(gameType)) {
    const offered = goalsForGameType(gameType).filter((g) => g.mechanical).map((g) => `'${g.label}'`);
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions: [],
      intendedWorks: false,
      goalUnavailable: true,
      detail: `'${goalDef.label}' is not a way to win this game, so it cannot be the goal. `
        + `This game's goals: ${offered.length > 1 ? `${offered.slice(0, -1).join(', ')} or ${offered[offered.length - 1]}` : offered[0] || 'none the server can check'}.`,
    };
  }

  /*
   * A multi-move line: check it can actually be played, and say whether the
   * position it reaches meets the goal. Uniqueness is out of reach - see the
   * note at the top - so this comes back as advice either way.
   */
  if (line.length > 1) {
    const played = await playLine(puzzle, gameType, line);
    if (!played.ok) {
      const which = played.plyIndex % 2 === 0
        ? `your move ${Math.floor(played.plyIndex / 2) + 1}`
        : `the opponent's reply ${Math.floor(played.plyIndex / 2) + 1}`;
      return {
        status: VALIDATION.UNSOLVABLE,
        solutions: [],
        intendedWorks: false,
        detail: `${which} cannot be played: ${played.reason}`,
        needsPromotionChoice: !!played.ctx?.needsPromotionChoice,
        promotionPlyIndex: played.ctx?.needsPromotionChoice ? played.plyIndex : undefined,
      };
    }
    played.state.currentTurn = other(side);
    const reached = isMechanical && goalMet(puzzle.goal, played.state, side, played.ctx);
    const moves = Math.ceil(line.length / 2);

    // A win on the very first move makes the rest of the line beside the point.
    const quicker = await immediateWins(puzzle, gameType, intended);
    if (quicker.length) {
      const named = quicker.slice(0, 3).map((m) => describeFirstMove(puzzle, gameType, m));
      const more = quicker.length > 3 ? ` (and ${quicker.length - 3} more)` : '';
      return {
        status: VALIDATION.AMBIGUOUS,
        solutions: quicker,
        intendedWorks: true,
        goalReached: reached,
        quickerWin: true,
        unique: false,
        detail: `the game can be won on the first move - ${named.join('; ')}${more} - `
          + `so the ${moves}-move line is not the solution. Change the position so nothing wins at once.`,
      };
    }

    /*
     * Searched, not taken on trust: a two-move line is checked against EVERY
     * defence (puzzle-search.js), and a longer one for a forced win in two that
     * would make it redundant. null from either means the search could not
     * finish or does not apply, and the older advice below stands.
     */
    /*
     * Up to three of the solver's moves. A line normally ends on the solver's
     * move (3 or 5 plies); a lose-all line ends on the opponent's capture of
     * the last piece (2, 4 or 6), and the search looks through that reply.
     */
    const solverMoveCount = Math.ceil(line.length / 2);
    const replyCompleted = REPLY_COMPLETED_GOALS.has(puzzle.goal);
    // A ONE-move reply-completed line (2 plies) is cheap to search - every move,
    // every reply - so it is searched right away, not only in the background.
    const oneMoveReplyCompleted = replyCompleted && line.length === 2;
    if (isMechanical && (opts.deepLines || oneMoveReplyCompleted)
        && (line.length >= 3 || oneMoveReplyCompleted) && solverMoveCount <= 3
        && (line.length % 2 === 1 || replyCompleted)) {
      const searched = await checkWholeLine(puzzle, gameType, line, reached, opts);
      if (searched) return searched;
    }
    if (isMechanical && line.length === 3) {
      const searched = await checkTwoMoveLine(puzzle, gameType, intended, reached);
      if (searched) return searched;
    }
    if (isMechanical && line.length > 3) {
      const shorter = await forcedWinInTwo(puzzle, gameType);
      if (shorter) {
        return {
          status: VALIDATION.AMBIGUOUS,
          solutions: [shorter.move],
          intendedWorks: true,
          goalReached: reached,
          quickerWin: true,
          unique: false,
          detail: `${GOAL_DEFS[puzzle.goal].label.toLowerCase()} can be forced in two moves, starting with `
            + `${describeFirstMove(puzzle, gameType, shorter.move)} - so the ${moves}-move line is not the solution.`,
        };
      }
    }

    /*
     * A line whose every reply was FORCED is as checkable as a one-move
     * puzzle, and should not be filed under "your call".
     *
     * The caveat at the top of this file - that replies are the creator's
     * script rather than a best defence - holds when the opponent has a
     * choice. It does not hold when they have exactly one move, which a
     * forced-capture game produces constantly. That is the mechanism behind a
     * bait in antichess: you offer the piece where taking it is the only thing
     * they are allowed to do.
     *
     * Claimed only when the goal is genuinely reached, the replies were
     * forced, AND no other opening move forces the same result - the same
     * standard the one-move check applies, so "valid" means the same thing
     * whichever branch produced it. Two plies only; past that this is a search.
     */
    if (isMechanical && reached && line.length === 2) {
      const forced = await repliesWereForced(puzzle, gameType, line);
      if (forced.forced) {
        const rivals = await otherForcedWins(puzzle, gameType, intended);
        if (rivals && !rivals.length) {
          return {
            status: VALIDATION.VALID,
            solutions: [intended],
            intendedWorks: true,
            goalReached: true,
            forcedLine: true,
            unique: true,
            detail: "the opponent's reply is their only legal move, and no other move of yours "
              + 'forces the same result - so this is checked, not merely plausible.',
          };
        }
        if (rivals && rivals.length) {
          return {
            status: VALIDATION.AMBIGUOUS,
            solutions: [intended, ...rivals],
            intendedWorks: true,
            goalReached: true,
            forcedLine: true,
            unique: false,
            detail: `${rivals.length + 1} different moves force the same result. That is allowed - `
              + 'solvers may simply find another one.',
          };
        }
      }
    }

    return {
      status: VALIDATION.NOT_CHECKABLE,
      solutions: [intended],
      intendedWorks: true,
      goalReached: reached,
      detail: `the whole ${moves}-move line is legal${reached ? ` and reaches the goal (${GOAL_DEFS[puzzle.goal].label.toLowerCase()})` : ''}. `
        + 'Whether the opponent could have defended differently is your call - the replies are the ones you wrote.',
    };
  }

  // Goals the server cannot score. Confirm the move is at least legal, so a
  // puzzle whose answer cannot be played is still caught.
  if (!isMechanical) {
    const { ok, reason, ctx } = await applyToFreshState(puzzle, gameType, intended);
    return {
      status: ok ? VALIDATION.NOT_CHECKABLE : VALIDATION.UNSOLVABLE,
      solutions: ok ? [intended] : [],
      intendedWorks: ok,
      needsPromotionChoice: !!ctx?.needsPromotionChoice,
      detail: ok
        ? `'${puzzle.goal}' is judged by the creator; the server only confirmed the move is legal`
        : `the recorded solution is not a legal move: ${reason}`,
    };
  }

  /*
   * One ply, one checkable goal: enumerate everything and see what else works.
   *
   * The enumeration is not quite complete, and cannot be made so from here.
   * getPossibleMovesForPiece leaves out two kinds of move that
   * validateAndApplyMove nonetheless accepts: en passant (it never sees the
   * target) and the capture of a royal piece (it refuses on principle, even in a
   * game won BY capturing the royal). So the creator's own move is added to the
   * list explicitly - otherwise a perfectly good royal-capture puzzle validates
   * as "no legal move achieves this", which is both wrong and baffling.
   *
   * The consequence is that ambiguity is found among the moves the engine will
   * enumerate, plus the one that was recorded. For a royal-capture goal a second
   * way to capture the royal would not be reported.
   */
  const base = buildGameState(puzzle, gameType);
  const candidates = [
    ...(getAllLegalMovesForPlayer(base, side) || []),
    ...enPassantCandidates(base, side),
    ...placementCandidates(base, side),
  ];
  if (!candidates.some((m) => moveKey(m) === moveKey(intended))) candidates.push(intended);

  const solutions = [];
  const seenSolutions = new Set();
  for (const candidate of candidates) {
    const key = boardMoveKey(candidate);
    if (seenSolutions.has(key)) continue;
    // eslint-disable-next-line no-await-in-loop -- the engine mutates shared
    // structures, so these must not overlap.
    const { ok, state, ctx } = await applyToFreshState(puzzle, gameType, candidate, { autoPromote: true });
    if (ok && goalMet(puzzle.goal, state, side, ctx)) {
      seenSolutions.add(key);
      solutions.push(candidate);
    }
  }

  const intendedKey = boardMoveKey(intended);
  const intendedRun = await applyToFreshState(puzzle, gameType, intended);
  if (!intendedRun.ok && intendedRun.ctx?.needsPromotionChoice) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions,
      intendedWorks: false,
      needsPromotionChoice: true,
      detail: 'your move promotes - record which piece it becomes',
    };
  }
  const intendedWorks = intendedRun.ok
    && goalMet(puzzle.goal, intendedRun.state, side, intendedRun.ctx);

  const goalLabel = GOAL_DEFS[puzzle.goal].label.toLowerCase();

  if (solutions.length === 0 && !intendedWorks) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions: [],
      intendedWorks: false,
      detail: `no legal move achieves '${goalLabel}' (${candidates.length} legal moves examined)`,
    };
  }
  if (!intendedWorks) {
    return {
      status: VALIDATION.UNSOLVABLE,
      solutions,
      intendedWorks: false,
      detail: `the recorded solution does not achieve '${goalLabel}', though ${solutions.length} other move(s) do`,
    };
  }
  if (solutions.length > 1) {
    // Named the way a person reads a board, not as engine keys ("6,0>0,0#183_7_7").
    const others = solutions.filter((m) => boardMoveKey(m) !== intendedKey)
      .map((m) => describeMoveOn(base.pieces, gameType, m));
    return {
      status: VALIDATION.AMBIGUOUS,
      solutions,
      intendedWorks: true,
      unique: false,
      detail: `${solutions.length} moves achieve '${goalLabel}': also ${others.slice(0, 4).join('; ')}`
        + `${others.length > 4 ? ` and ${others.length - 4} more` : ''}.`,
    };
  }
  return { status: VALIDATION.VALID, solutions, intendedWorks: true, unique: true, detail: null };
}

module.exports = {
  validatePuzzle,
  lineGoalLabel,
  // For the staff search: does a "find this exact move" line win the game?
  lineWinsGame,
  // ... and, when it is not forced, which defense the line misses.
  describeNotForced,
  // For the solve route: the other moves that would have finished a puzzle too.
  immediateWins,
  describeMoveOn,
  boardMoveKey,
  applyToFreshState,
  applyPly,
  // Exported for the seed generator, which tests a position for a goal directly
  // rather than paying for a full validatePuzzle call per candidate move.
  goalMet,
  playLine,
  buildGameState,
  terminalOutcome,
  moveKey,
  isPlacementPly,
  placementRules,
  placementCandidates,
  enPassantCandidates,
  // For the veto checks (puzzle-veto.js): does a veto leave the mover a move?
  trulyLegalMoves,
  goalsForGameType,
  describeGoal,
  GOALS,
  GOAL_DEFS,
  MECHANICAL_GOALS,
  REPLY_COMPLETED_GOALS,
  VALIDATION,
};
