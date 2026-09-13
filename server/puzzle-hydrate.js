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
 * The row is matched on (piece_id, player_number) so a game that configures
 * one side's copy differently keeps that difference, falling back to any row
 * for the piece when a side-specific one does not exist.
 */
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
 * The row is matched on (piece_id, player_number) so a game that configures
 * one side's copy differently keeps that difference, falling back to any row
 * for the piece when a side-specific one does not exist.
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
  // Keyed by piece and side, with a piece-only fallback for the common case
  // where both sides share one configuration.
  const junctionBySide = new Map();
  const junctionByPiece = new Map();
  for (const r of junctionRows) {
    junctionBySide.set(`${Number(r.piece_id)}:${Number(r.player_number)}`, r);
    if (!junctionByPiece.has(Number(r.piece_id))) junctionByPiece.set(Number(r.piece_id), r);
  }

  const startingSquares = startingSquareIndex(rules);

  return list.map((p) => {
    const pieceId = Number(p.piece_id);
    const def = toEngineFields(byId.get(pieceId) || {});
    const player = Number(p.player_id ?? p.team ?? 1);
    const junction = junctionBySide.get(`${pieceId}:${player}`) || junctionByPiece.get(pieceId) || {};

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
      else if (junction[col] != null) merged[col] = junction[col];
    }
    return merged;
  });
};

module.exports = {
  hydratePosition, startingSquareIndex, movedState,
  toEngineFields, ENGINE_FIELD_RENAMES, JUNCTION_OVERRIDES,
};
