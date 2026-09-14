/*
 * Turning stored placements into engine pieces.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * There are already too many places in this codebase that build the engine's
 * piece object, and they have a history of drifting apart from one another. The
 * backfill script needed this logic and I wrote a second, simplified copy of
 * it - which promptly declared 20 perfectly good puzzles broken, because the
 * copy skipped the engine field renames and the null-means-not-overridden rule.
 * That is the whole failure mode in miniature, so the copy is gone and this is
 * the one definition.
 *
 * Everything here takes a RULES object - { game, pieces, placements } - rather
 * than reading the database, so the same code serves a puzzle played under its
 * frozen snapshot and one being built against the live game. See
 * server/puzzle-snapshot.js.
 */

const safeParse = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
};

const ENGINE_FIELD_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};

/** Rename the engine-facing fields on a raw `pieces` row. */
function toEngineFields(row) {
  const out = { ...row };
  for (const [from, to] of Object.entries(ENGINE_FIELD_RENAMES)) {
    if (row[from] !== undefined) out[to] = row[from];
  }
  return out;
}

// Reads the game out of the rules object rather than the live table, for the
// same reason hydratePosition does: a puzzle's starting squares are the ones
// its game had when the puzzle was made.
const startingSquareIndex = (rules) => {
  const parsed = safeParse(rules?.game?.pieces_string, null);
  const out = new Set();
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [key, v] of Object.entries(parsed)) {
    const [ky, kx] = String(key).split(',').map(Number);
    const x = Number(v.x ?? kx);
    const y = Number(v.y ?? ky);
    const player = Number(v.player_id ?? v.player_number ?? 1);
    out.add(`${Number(v.piece_id)}:${player}:${y},${x}`);
  }
  return out;
};

/**
 * Has this piece moved yet?
 *
 * A puzzle has no history, so this is inferred from geography: a piece standing
 * on one of ITS OWN starting squares for this game type is treated as unmoved;
 * a piece anywhere else has obviously moved to get there.
 *
 * That inference is what makes first-move-only movement behave. Without it
 * every piece counted as unmoved, so a pawn halfway up the board still offered
 * its double step and a king that had clearly walked could still castle - and
 * the extra phantom moves quietly broke the uniqueness check, because a
 * defender was credited with escapes it does not have.
 *
 * An explicit flag on the placement still wins, so a position that needs to say
 * "this rook has moved even though it is home" can, once there is a way to set
 * it. The geography is the default, not a rule.
 */
const movedState = (placement, pieceId, player, startingSquares) => {
  if (placement.hasMoved !== undefined && placement.hasMoved !== null) {
    const moved = !!placement.hasMoved;
    return { hasMoved: moved, moveCount: Number(placement.moveCount) || (moved ? 1 : 0) };
  }
  const home = startingSquares.has(`${pieceId}:${player}:${Number(placement.y)},${Number(placement.x)}`);
  return { hasMoved: !home, moveCount: home ? 0 : (Number(placement.moveCount) || 1) };
};

/**
 * Turn a stored position into pieces the move engine understands.
 *
 * A puzzle stores placements in the same compact shape as a game type's
 * pieces_string - piece_id, player_id, x, y, plus the per-game-type flags -
 * rather than sixty movement columns per square. The movement fields are
 * merged in here from the pieces table.
 *
 * ends_game_on_checkmate is the one to be careful with: it is a property of a
 * piece IN A GAME TYPE, so it rides on the placement, not on the piece row.
 * Lose it and the engine sees no royal piece, nothing is ever check, and a
 * mate puzzle silently reports as unsolvable rather than erroring.
 *
 * It is not the only one. Everything in JUNCTION_OVERRIDES is configured per
 * placement in the game wizard, not on the piece: which pieces a pawn may
 * promote to, whether this copy promotes at all, whether it can be captured
 * en passant, who it castles with. Merging only the two royal flags left a
 * puzzle playing a subtly different piece from the one in the live game -
 * most visibly for custom promotion, where the curated promotion list simply
 * did not arrive and every promotable piece offered the default set instead.
 *
 * The row is matched on (piece_id, player_number, square), so a game that
 * configures one copy of a piece differently from the next keeps that
 * difference. See the lookup in hydratePosition for the fallbacks.
 */
const JUNCTION_OVERRIDES = [
  'ends_game_on_checkmate', 'ends_game_on_capture',
  'manual_castling_partners', 'castling_partner_left_key', 'castling_partner_right_key',
  'castling_distance', 'can_control_squares', 'can_en_passant',
  'can_fire_over_allies', 'can_fire_over_enemies',
  'promotion_pieces_override', 'disable_promotion',
  'can_promote_to_checkmate', 'limit_promote_checkmate_to_original',
  'can_promote_to_capture', 'limit_promote_capture_to_original',
  'capture_points_gain', 'capture_points_loss',
  'cannot_move_outside_zone', 'cannot_be_captured', 'is_neutral',
  'hit_points', 'attack_damage', 'hp_regen', 'burn_damage', 'burn_duration',
  'trample', 'trample_radius', 'ghostwalk', 'die_on_capture',
  'die_on_capture_grants_win', 'attack_radius',
];

/*
 * Overrides that a piece may NOT inherit from the other side's row.
 *
 * The piece-only fallback below is deliberate and load-bearing: 617 (game,
 * piece) pairs on production are configured for one player_number only -
 * overwhelmingly older games whose junction rows predate per-side
 * configuration - and 34 of them carry ends_game_on_checkmate. Drop the
 * fallback and the other side's king stops being royal, so nothing is ever
 * check and every mate puzzle on those games goes quiet.
 *
 * Guessing is fine for a flag that DESCRIBES a piece both sides share. It is
 * not fine for one that GRANTS an ability the game never granted, because the
 * failure is silent and in the solver's favour: a piece that cannot be captured
 * has no answer to take it, so a mate puzzle becomes unsolvable rather than
 * wrong. 27 (game, piece) pairs assert cannot_be_captured for one side only,
 * 24 of them on player_number 0 - the neutral walls, whose invulnerability
 * would otherwise be handed to real pieces.
 *
 * is_neutral is here for a stronger reason than symmetry: it is not a property
 * of a piece at all, it is an override of WHO OWNS IT. The engine's ownership
 * check reads "not your piece unless it is neutral" (game-socket.js, both
 * validateMove and validateAndApplyMove), a neutral occupant is exempt from the
 * ally-capture rule, and trample damages one regardless of side. Leak it onto a
 * player's piece and BOTH players may move it and its own side may capture it -
 * a far larger change to the legal move set than cannot_be_captured makes. All
 * 33 single-side assertions of it are player_number 0.
 *
 * So these two fall through to the piece's own value instead. A row that is
 * genuinely for this side still sets them; only the cross-side guess is
 * refused.
 */
const NOT_INHERITED_ACROSS_SIDES = new Set(['cannot_be_captured', 'is_neutral']);

/*
 * Build engine pieces from stored placements.
 *
 * Takes a RULES object - { game, pieces, placements } - rather than a game id,
 * because a puzzle is played under the rules it was built under, which may no
 * longer be the ones in the live tables. See server/puzzle-snapshot.js; the
 * only caller that passes live rules is one that genuinely wants the current
 * game (the builder, working on a puzzle that does not exist yet).
 */
const hydratePosition = async (rules, placements) => {
  const list = Array.isArray(placements) ? placements : [];
  if (!list.length) return [];
  if (!rules?.game) return [];

  const byId = new Map((rules.pieces || []).map((r) => [Number(r.id), r]));
  const junctionRows = rules.placements || [];
  /*
   * Junction rows are PER SQUARE, not per piece type - game_type_pieces is
   * unique on (game_type_id, x, y, player_number) - so a game can configure two
   * copies of the same piece differently, and 266 (game, piece, side) groups on
   * production do. Keying only by piece and side therefore collapses them and
   * lets one arbitrary row configure every copy: that is how game 427, which
   * makes 11 of its 13 copies of piece 192 uncapturable, ends up making all 13
   * of them uncapturable, or none. Row order decides which, and row order is
   * unspecified - hence the ORDER BY in readLive. A snapshot froze whatever
   * order it was written in, so those were always stable; it is the live path
   * that could answer differently on two consecutive loads.
   *
   * So the lookup is keyed three ways and read most specific first:
   *
   *   piece + side + square   this copy's own row, exact
   *   piece + side            the piece has moved off its starting square, or
   *                           the position holds a copy the game never placed
   *   piece                   the game configured one side only; see
   *                           NOT_INHERITED_ACROSS_SIDES for what that may say
   *
   * The square key resolves 96% of starting placements on production. The rest
   * are games missing junction rows for a side outright, which land on the
   * piece-only fallback exactly as they did before.
   */
  const junctionBySquare = new Map();
  const junctionBySide = new Map();
  const junctionByPiece = new Map();
  for (const r of junctionRows) {
    const rowPiece = Number(r.piece_id);
    const rowPlayer = Number(r.player_number);
    junctionBySquare.set(`${rowPiece}:${rowPlayer}:${Number(r.y)},${Number(r.x)}`, r);
    /*
     * Both fallbacks keep the tie-break they already had - last row wins by
     * side, first row wins by piece. Neither is more right than the other: a
     * piece that is not on any of its starting squares has no row of its own,
     * so the answer is a convention either way. But changing the convention
     * would re-pick a flag for every such placement in every stored puzzle -
     * 45 of them on production, all castling - to no one's benefit. The
     * ORDER BY in readLive is what makes these stop being a coin flip; which
     * end of the order they take is not worth churning live puzzles over.
     */
    junctionBySide.set(`${rowPiece}:${rowPlayer}`, r);
    if (!junctionByPiece.has(rowPiece)) junctionByPiece.set(rowPiece, r);
  }

  const startingSquares = startingSquareIndex(rules);

  return list.map((p) => {
    const pieceId = Number(p.piece_id);
    const def = toEngineFields(byId.get(pieceId) || {});
    const player = Number(p.player_id ?? p.team ?? 1);
    const ownSide = junctionBySquare.get(`${pieceId}:${player}:${Number(p.y)},${Number(p.x)}`)
      || junctionBySide.get(`${pieceId}:${player}`);
    const junction = ownSide || junctionByPiece.get(pieceId) || {};
    // True when the row we found belongs to a different side than this piece.
    const borrowed = !ownSide;

    const merged = {
      ...def,
      // Board identity, not the piece-definition id.
      id: p.id || `${p.piece_id}_${p.y}_${p.x}`,
      piece_id: p.piece_id,
      x: Number(p.x),
      y: Number(p.y),
      player_id: player,
      team: player,
      player_number: player,
      ...movedState(p, pieceId, player, startingSquares),
    };

    /*
     * The placement's own value wins where the author set one; otherwise the
     * game type's configuration applies; otherwise the piece keeps its own.
     *
     * NULL means "not overridden", not "off". Most junction columns are null
     * for most rows - Chess's pawn carries can_en_passant on the PIECE and
     * null in every junction row - so treating null as a value silently turns
     * the flag off and en passant quietly stops existing.
     */
    for (const col of JUNCTION_OVERRIDES) {
      if (p[col] != null) merged[col] = p[col];
      else if (borrowed && NOT_INHERITED_ACROSS_SIDES.has(col)) continue;
      else if (junction[col] != null) merged[col] = junction[col];
    }
    return merged;
  });
};

module.exports = {
  hydratePosition, startingSquareIndex, movedState,
  toEngineFields, ENGINE_FIELD_RENAMES, JUNCTION_OVERRIDES,
};
