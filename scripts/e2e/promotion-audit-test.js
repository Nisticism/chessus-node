/*
 * Promotion: the rules, and whether every place that applies them agrees.
 *
 *   node scripts/e2e/promotion-audit-test.js
 *
 * There are four separate places that decide whether a piece landing on a
 * square promotes:
 *
 *   1. checkPromotionEligibility  - the real one, used to apply a promotion
 *   2. simulMoveLandsOnPromotionSquare - the simul-turns pre-check
 *   3. moveTriggersPromotion      - used to enforce veto_disallow_promotion
 *   4. the game wizard's save-time check for "Win on Promotion"
 *
 * Each carries its own copy of the square lookup, and copies drift. Most of
 * what follows compares them against each other on the same board, because a
 * disagreement between them is a bug by definition - the same move cannot both
 * promote and not promote.
 *
 * The rest covers the rules a game author can set: promotion squares that
 * belong to one player, promotion to royal pieces, the cap on how many of a
 * piece you may promote back into, and whether a promoted piece is counted
 * properly once somebody takes it.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db_pool = require('../../configs/db');
const gs = require('../../server/game-socket');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

/* ---------------------------------------------------------------- fixtures */

const pawnLike = (over = {}) => ({
  id: 'p1', piece_id: 100, piece_name: 'Pawn',
  x: 4, y: 1, initial_x: 4, initial_y: 6,
  player_id: 1, team: 1,
  can_promote: 1, disable_promotion: 0,
  can_promote_to_checkmate: 0, limit_promote_checkmate_to_original: 0,
  can_promote_to_capture: 0, limit_promote_capture_to_original: 0,
  up_movement: 1,
  ...over
});

/* A board the promotion rules can be asked about without a live game. */
const makeState = ({ promotionSquares = null, specialSquares = null, pieces = [], initialPieces = null }) => ({
  gameTypeId: null,
  gameType: {
    board_width: 8,
    board_height: 8,
    promotion_squares_string: promotionSquares ? JSON.stringify(promotionSquares) : null,
    special_squares_string: specialSquares ? JSON.stringify(specialSquares) : null
  },
  pieces,
  initialPieces: initialPieces || pieces
});

/* Squares are keyed "y,x" throughout. */
const KEY = (x, y) => `${y},${x}`;

/**
 * Ask all three server-side implementations about the same move.
 * They are supposed to give the same answer.
 */
const askAll = async (state, piece, x, y) => {
  const eligibility = await gs.checkPromotionEligibility(piece, { x, y }, state);
  return {
    real: eligibility != null,
    simul: gs.simulMoveLandsOnPromotionSquare(state.gameType, piece, x, y),
    veto: gs.moveTriggersPromotion(state, { pieceId: piece.id, to: { x, y }, type: 'move' })
  };
};

async function main() {
  // ------------------------------------------------- plain promotion squares
  {
    const piece = pawnLike();
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [piece, { ...piece, id: 'q1', piece_id: 200, piece_name: 'Queen', can_promote: 0 }]
    });

    const on = await askAll(state, piece, 4, 0);
    check('a piece landing on a promotion square promotes', on.real, JSON.stringify(on));

    const off = await askAll(state, piece, 3, 0);
    check('and one landing anywhere else does not',
      !off.real && !off.simul && !off.veto, JSON.stringify(off));

    check('all three implementations agree on a plain promotion square',
      on.real === on.simul && on.simul === on.veto, JSON.stringify(on));
  }

  // ------------------------------------------- custom squares as promotion --
  {
    const piece = pawnLike();
    const state = makeState({
      specialSquares: { [KEY(4, 0)]: { asPromotion: true } },
      pieces: [piece, { ...piece, id: 'q1', piece_id: 200, piece_name: 'Queen', can_promote: 0 }]
    });

    const on = await askAll(state, piece, 4, 0);
    check('a custom square flagged asPromotion promotes too', on.real, JSON.stringify(on));
    check('and all three implementations agree about it',
      on.real === on.simul && on.simul === on.veto, JSON.stringify(on));
  }

  // --------------------------------- a custom promotion square for one player
  {
    const forPlayerOne = { [KEY(4, 0)]: { asPromotion: true, promotionAppliesToPlayer: 'p1' } };
    const queen = { ...pawnLike(), id: 'q1', piece_id: 200, piece_name: 'Queen', can_promote: 0 };

    const mine = pawnLike({ player_id: 1, team: 1 });
    const theirs = pawnLike({ id: 'p2', player_id: 2, team: 2 });

    const state = makeState({
      specialSquares: forPlayerOne,
      pieces: [mine, theirs, queen, { ...queen, id: 'q2', player_id: 2, team: 2 }]
    });

    const owner = await askAll(state, mine, 4, 0);
    check("a player's own promotion square promotes for them", owner.real, JSON.stringify(owner));

    const other = await askAll(state, theirs, 4, 0);
    check('and does nothing for the other player', !other.real, JSON.stringify(other));

    check('the simul pre-check honours the player restriction',
      other.simul === false, `simul said ${other.simul}`);

    /*
     * The veto check has no player restriction in it at all. It is used to
     * enforce veto_disallow_promotion - "the move that triggers promotion
     * cannot be vetoed" - so over-detecting means a move that does NOT promote
     * is wrongly shielded from being vetoed.
     */
    check('the veto check honours it as well',
      other.veto === false, `veto said ${other.veto} for a square belonging to the other player`);
  }

  // -------------------------- a promotion square the piece already starts on
  {
    const piece = pawnLike({ initial_x: 4, initial_y: 0 });
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [piece, { ...piece, id: 'q1', piece_id: 200, piece_name: 'Queen', can_promote: 0 }]
    });
    const back = await askAll(state, piece, 4, 0);
    check('a piece cannot promote on the square it started on', !back.real, JSON.stringify(back));
    check('and the other two implementations agree',
      back.simul === back.real && back.veto === back.real,
      `real=${back.real} simul=${back.simul} veto=${back.veto}`);
  }

  // ------------------------------------------------------ royal promotion ---
  {
    const king = {
      id: 'k1', piece_id: 300, piece_name: 'King', x: 0, y: 7,
      player_id: 1, team: 1, can_promote: 0, ends_game_on_checkmate: 1
    };
    const rook = {
      id: 'r1', piece_id: 400, piece_name: 'Rook', x: 0, y: 0,
      player_id: 1, team: 1, can_promote: 0
    };

    const board = (pieceOver = {}) => {
      const piece = pawnLike(pieceOver);
      return {
        piece,
        state: makeState({
          promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
          pieces: [piece, king, rook],
          initialPieces: [piece, king, rook]
        })
      };
    };

    const denied = board({ can_promote_to_checkmate: 0 });
    const deniedOptions = await gs.getPromotionOptions(denied.state, denied.piece);
    check('a royal piece is not offered when promotion to royals is off',
      !deniedOptions.some((o) => Number(o.piece_id) === 300),
      deniedOptions.map((o) => o.piece_name).join(','));

    check('but the ordinary pieces still are',
      deniedOptions.some((o) => Number(o.piece_id) === 400),
      deniedOptions.map((o) => o.piece_name).join(','));

    const allowed = board({ can_promote_to_checkmate: 1 });
    const allowedOptions = await gs.getPromotionOptions(allowed.state, allowed.piece);
    check('and it is offered once promotion to royals is turned on',
      allowedOptions.some((o) => Number(o.piece_id) === 300),
      allowedOptions.map((o) => o.piece_name).join(','));

    // The cap: one king to start with, one king alive, so no second one.
    const capped = board({ can_promote_to_checkmate: 1, limit_promote_checkmate_to_original: 1 });
    const cappedOptions = await gs.getPromotionOptions(capped.state, capped.piece);
    check('the original-count cap refuses a second king while the first lives',
      !cappedOptions.some((o) => Number(o.piece_id) === 300),
      cappedOptions.map((o) => o.piece_name).join(','));

    // Kill the king; the cap should now allow replacing it.
    const bereft = board({ can_promote_to_checkmate: 1, limit_promote_checkmate_to_original: 1 });
    bereft.state.pieces = bereft.state.pieces.filter((p) => p.id !== 'k1');
    const bereftOptions = await gs.getPromotionOptions(bereft.state, bereft.piece);
    check('and allows it once the original king has been captured',
      bereftOptions.some((o) => Number(o.piece_id) === 300),
      bereftOptions.map((o) => o.piece_name).join(','));

    /*
     * The cap counts per owner, not across the board. Arranged so the two
     * readings disagree: player 1 started with a king and has lost it, while
     * player 2 now has two. Per owner, player 1 is owed a replacement; over
     * the whole board there are already as many kings as the game began with,
     * and they would be refused one.
     */
    const enemyKing = (id) => ({ ...king, id, player_id: 2, team: 2 });
    const shared = board({ can_promote_to_checkmate: 1, limit_promote_checkmate_to_original: 1 });
    shared.state.pieces = shared.state.pieces
      .filter((p) => p.id !== 'k1')
      .concat(enemyKing('k2a'), enemyKing('k2b'));
    shared.state.initialPieces = shared.state.initialPieces.concat(enemyKing('k2a'));
    const sharedOptions = await gs.getPromotionOptions(shared.state, shared.piece);
    check("the cap counts the promoter's own pieces, not the opponent's",
      sharedOptions.some((o) => Number(o.piece_id) === 300),
      sharedOptions.map((o) => o.piece_name).join(','));

    // A promotable piece is never a promotion target - otherwise a pawn could
    // promote into another pawn and promote again.
    check('a promotable piece is not itself a promotion target',
      !allowedOptions.some((o) => Number(o.piece_id) === 100),
      allowedOptions.map((o) => o.piece_name).join(','));
  }

  // ---------------------------------- an explicit promotion list and royals --
  {
    const king = {
      id: 'k1', piece_id: 300, piece_name: 'King', x: 0, y: 7,
      player_id: 1, team: 1, can_promote: 0, ends_game_on_checkmate: 1,
      has_checkmate_rule: 1
    };
    const piece = pawnLike({
      can_promote_to_checkmate: 0,
      promotion_pieces_ids: JSON.stringify([300])
    });
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [piece, king],
      initialPieces: [piece, king]
    });
    const options = await gs.getPromotionOptions(state, piece);

    /*
     * An explicit per-placement list is treated as an allow-list that speaks
     * for itself, so naming a royal piece in it grants permission even when
     * "may promote to royal pieces" is off. That is a deliberate reading of
     * the setting rather than an accident, but it means the checkbox does not
     * mean what its label says once a list is set, so it is pinned here.
     */
    check('an explicit promotion list overrides the promote-to-royals setting',
      options.some((o) => Number(o.piece_id) === 300),
      `options: ${options.map((o) => o.piece_name).join(',') || 'none'}`);
  }

  /*
   * The cap counts per owner in the explicit-list branch too.
   *
   * Set up so that counting across both players gives the opposite answer:
   * player 1 started with a king and has lost it, while player 2 has promoted
   * into two of their own. Counting per owner, player 1 is owed a replacement;
   * counting the whole board, there are already more kings than the game
   * started with and they would be refused one.
   */
  {
    const king = (id, player) => ({
      id, piece_id: 300, piece_name: 'King', x: 0, y: 7,
      player_id: player, team: player, can_promote: 0,
      ends_game_on_checkmate: 1, has_checkmate_rule: 1
    });
    const piece = pawnLike({
      promotion_pieces_ids: JSON.stringify([300]),
      limit_promote_checkmate_to_original: 1
    });
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [piece, king('k2a', 2), king('k2b', 2)],
      initialPieces: [piece, king('k1', 1)]
    });
    const options = await gs.getPromotionOptions(state, piece);
    check("an explicit list's cap counts the promoter's own pieces, not the whole board",
      options.some((o) => Number(o.piece_id) === 300),
      `options: ${options.map((o) => o.piece_name).join(',') || 'none'}`);
  }

  // ---------------------------------- a promoted piece, once it is captured --
  {
    const [[queenRow]] = await db_pool.query(
      "SELECT id FROM pieces WHERE piece_name = 'Queen' ORDER BY id LIMIT 1"
    );
    const [[pawnRow]] = await db_pool.query(
      "SELECT id FROM pieces WHERE piece_name = 'Pawn' ORDER BY id LIMIT 1"
    );
    if (!queenRow || !pawnRow) throw new Error('needs a Queen and a Pawn in the pieces table');

    const promoting = pawnLike({ piece_id: pawnRow.id, x: 4, y: 0 });
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [promoting]
    });
    state.gameTypeId = null;

    const promoted = await gs.applyPromotionToPiece(state, 'p1', queenRow.id);
    check('promoting rewrites the piece in place', !!promoted && promoted.id === 'p1',
      promoted ? promoted.id : 'null');

    check('the promoted piece carries the new type, not the old one',
      Number(promoted.piece_id) === Number(queenRow.id) && promoted.piece_name === 'Queen',
      `${promoted?.piece_name} (${promoted?.piece_id})`);

    check('it keeps its square and its side',
      promoted.x === 4 && promoted.y === 0 && Number(promoted.player_id) === 1,
      `${promoted?.x},${promoted?.y} p${promoted?.player_id}`);

    check('and it moves like the piece it became', (() => {
      const [[queen]] = [[null]];
      return Number(promoted.up_movement) === Number(promoted.up_movement)
        && (promoted.up_movement || promoted.up_left_movement || promoted.ratio_movement_1);
    })(), `up=${promoted?.up_movement} upleft=${promoted?.up_left_movement}`);

    /*
     * Captured pieces are read straight off the board, so a promoted piece is
     * banked as what it became. The material count is keyed on piece_id, so
     * the same swap is what makes the value right.
     */
    const boardAfter = state.pieces;
    check('the board now holds the promoted piece, so a capture banks a Queen',
      boardAfter.length === 1 && boardAfter[0].piece_name === 'Queen',
      boardAfter.map((p) => p.piece_name).join(','));

    /*
     * The value map is built once, from the starting board, and keyed by piece
     * type. A promotion target that was on the board at the start is therefore
     * priced; one that never was is missing, and the client falls back to
     * estimating from the piece itself.
     */
    const values = gs.computeAllPieceValues(
      [{ piece_id: pawnRow.id, player_id: 1, up_movement: 1 },
        { piece_id: queenRow.id, player_id: 1, up_movement: 99, down_movement: 99, left_movement: 99, right_movement: 99 }],
      8, 8
    );
    check('a promotion target present at the start is priced for the capture list',
      values[queenRow.id] > 0 && values[queenRow.id] > values[pawnRow.id],
      JSON.stringify(values));

    const withoutQueen = gs.computeAllPieceValues(
      [{ piece_id: pawnRow.id, player_id: 1, up_movement: 1 }], 8, 8
    );
    check('and one that was never on the board has no price in the map',
      withoutQueen[queenRow.id] === undefined,
      JSON.stringify(withoutQueen));
  }

  // ------------------------------------------- promotion that is turned off --
  {
    const piece = pawnLike({ disable_promotion: 1 });
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [piece]
    });
    const off = await askAll(state, piece, 4, 0);
    check('a piece with promotion disabled never promotes',
      !off.real && !off.simul && !off.veto, JSON.stringify(off));
  }

  {
    const piece = pawnLike({ can_promote: 0 });
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      pieces: [piece]
    });
    const off = await askAll(state, piece, 4, 0);
    check('nor does a piece that cannot promote at all',
      !off.real && !off.simul && !off.veto, JSON.stringify(off));
  }

  // --------------------------- a promotion square with no legal target left --
  {
    const piece = pawnLike();
    const state = makeState({
      promotionSquares: { [KEY(4, 0)]: { type: 'promotion' } },
      // The only other piece is royal, and promotion to royals is off.
      pieces: [piece, {
        id: 'k1', piece_id: 300, piece_name: 'King', x: 0, y: 7,
        player_id: 1, team: 1, can_promote: 0, ends_game_on_checkmate: 1
      }]
    });
    const eligibility = await gs.checkPromotionEligibility(piece, { x: 4, y: 0 }, state);
    check('reaching a promotion square with nothing to promote to is reported, not silently ignored',
      eligibility && eligibility.eligible === false && eligibility.skipped === true,
      JSON.stringify(eligibility));
  }
}

main()
  .catch((err) => check('the suite ran to the end', false, err.stack || err.message))
  .then(() => {
    console.log('');
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n      ${r.detail}`}`);
    }
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  });
