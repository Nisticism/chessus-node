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
} = require('./game-socket');
const { gravityOf, restingSquare } = require('./board-gravity');

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
    describe: () => 'Find the move that ends the game in your favour.',
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
  state.pieces.push({
    ...template,
    id: `placed_${x}_${y}_${state.pieces.length}`,
    piece_id: Number(template.piece_id),
    piece_name: template.name || template.piece_name || 'Placed Piece',
    image_url: template.image_url,
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

async function applyPly(state, ply, { autoPromote = false } = {}) {
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
      return {
        ok: false,
        reason: 'this move promotes - record which piece it becomes',
        needsPromotionChoice: true,
        promotionEligible: eligible,
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

async function validatePuzzle(puzzle, gameType) {
  const line = Array.isArray(puzzle.solution_line)
    ? puzzle.solution_line
    : [puzzle.solution_line].filter(Boolean);
  const intended = line[0];
  const side = puzzle.side_to_move;

  if (!intended) {
    return { status: VALIDATION.UNSOLVABLE, solutions: [], intendedWorks: false, detail: 'no intended solution recorded' };
  }

  const isMechanical = MECHANICAL_GOALS.has(puzzle.goal);

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
    const others = solutions.filter((m) => boardMoveKey(m) !== intendedKey).map(boardMoveKey);
    return {
      status: VALIDATION.AMBIGUOUS,
      solutions,
      intendedWorks: true,
      detail: `${solutions.length} moves achieve '${goalLabel}': also ${others.join(', ')}`,
    };
  }
  return { status: VALIDATION.VALID, solutions, intendedWorks: true, detail: null };
}

module.exports = {
  validatePuzzle,
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
  goalsForGameType,
  describeGoal,
  GOALS,
  GOAL_DEFS,
  MECHANICAL_GOALS,
  VALIDATION,
};
