/*
 * "Your opponent chooses which piece you move."
 *
 * Before every action, the player who is NOT about to act picks a piece type,
 * and the player who is must move a piece of that type if one of them can
 * move. The chooser's clock runs while they choose; the mover's once they
 * have. In a game with several actions per turn a fresh type is chosen before
 * each action, so the clock goes back and forth inside one turn.
 *
 * Stored in the game type's other_game_data as `designate_piece_type: true`.
 *
 * THE STATE IS LAZY. A choice belongs to one action, identified by how many
 * actions have been played (moveHistory.length) and who is to act. When
 * either has moved on, a new choice is due - so every path that plays an
 * action (moves, placements, passes, bot moves, skipped capture actions) is
 * covered without each of them having to remember to ask. The client applies
 * the same rule to the same two numbers.
 *
 * Rules settled with the game's author (2026-09-25):
 *   - Placing a piece is always allowed; the choice restricts which piece
 *     MOVES.
 *   - If no piece of the chosen type can move, the mover moves freely. So the
 *     choice never removes a player's last legal move, and checkmate,
 *     stalemate and no-legal-moves endings are unaffected.
 *   - Not with Veto (two pre-move phases) or Simultaneous Turns (no "whose
 *     turn"). Fine with fog of war: types are picked from a list, and in a fog
 *     game that list is every type the opponent could have, so it reveals
 *     nothing about what is on the board.
 *   - A continuation of a move already made (a capture action, a chain
 *     capture) is not a new action: it is forced onto one piece already.
 *   - Bots: the built-in AI obeys the choice and picks for its opponent.
 *     Fairy-Stockfish cannot know the rule, so it is never used for these
 *     games.
 */

const parseOther = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return {}; }
};

/** Is the rule on, for a live game state or a game type row / request body? */
function isDesignationGame(stateOrType) {
  if (!stateOrType) return false;
  const gt = stateOrType.gameType || stateOrType;
  if (gt.simultaneous_turns) return false;
  const od = stateOrType.otherGameData || parseOther(gt.other_game_data);
  return od.designate_piece_type === true;
}

const ownerOf = (p) => Number(p.team || p.player_id || 0);
const otherSide = (pos) => (Number(pos) === 1 ? 2 : 1);

/** The action a choice is for: this many actions played, this side to act. */
function actionKey(gameState) {
  return {
    forAction: Array.isArray(gameState.moveHistory) ? gameState.moveHistory.length : 0,
    mover: Number(gameState.currentTurn),
  };
}

/*
 * Is a choice due right now? The same rule runs in the browser
 * (designationNeedsChoice in LiveGame), so the two cannot disagree about
 * whose clock is running or whether a move may be made.
 */
function needsChoice(gameState) {
  if (!isDesignationGame(gameState)) return false;
  if (!(gameState.status === 'active' || gameState.status === 'ready')) return false;
  if (gameState.repositionPhase && gameState.repositionPhase.active) return false;
  // A continuation of the move just made is not a new action.
  if (gameState.captureActionsPieceId != null
    || gameState.chainCapturePieceId != null
    || gameState.rangedCaptureActionsPieceId != null) return false;
  const d = gameState.designation;
  const k = actionKey(gameState);
  return !(d && d.forAction === k.forAction && Number(d.mover) === k.mover);
}

/** The side choosing, when a choice is due. */
const chooserPos = (gameState) => otherSide(gameState.currentTurn);

/** The chosen piece_id for the action about to be played, or null. */
function designatedType(gameState) {
  if (!isDesignationGame(gameState) || needsChoice(gameState)) return null;
  const d = gameState.designation;
  return d && d.pieceId != null ? Number(d.pieceId) : null;
}

const pieceArt = (p) => ({
  pieceId: Number(p.piece_id),
  name: p.piece_name || p.name || `Piece ${p.piece_id}`,
  image: p.image_url || null,
  imageLocation: p.image_location || null,
});

/*
 * The types the chooser may pick from.
 *
 * Normally: every type the mover has on the board right now (their own and
 * neutral pieces - either side may move a neutral one).
 *
 * With fog of war or hidden enemy pieces: every type the mover could have
 * had in this game - their starting pieces, what they may place, and what is
 * on the board - so the list says nothing about what is left.
 */
function choicesFor(gameState) {
  const mover = Number(gameState.currentTurn);
  const mine = (p) => p && (p.is_neutral || ownerOf(p) === 0 || ownerOf(p) === mover);
  const byId = new Map();
  const add = (p) => {
    if (!p || p.piece_id == null) return;
    const id = Number(p.piece_id);
    if (!byId.has(id)) byId.set(id, pieceArt(p));
  };
  (gameState.pieces || []).filter(mine).forEach(add);

  const fogged = !!(gameState.gameType && (gameState.gameType.fog_of_war || gameState.gameType.hide_enemy_pieces));
  if (fogged) {
    (gameState.initialPieces || []).filter(mine).forEach(add);
    const od = gameState.otherGameData || parseOther(gameState.gameType && gameState.gameType.other_game_data);
    for (const t of (od.placeable_pieces || [])) {
      const who = t.player == null ? 'all' : String(t.player);
      if (t.is_neutral || who === 'all' || who === String(mover) || who === `p${mover}`) {
        add({ ...t, piece_name: t.name || t.piece_name });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/*
 * Moves that obey the choice, from a list of legal moves. When the chosen
 * type has no legal move, every move is allowed. Placements always are.
 */
function filterMoves(gameState, legalMoves) {
  const type = designatedType(gameState);
  if (type == null || !Array.isArray(legalMoves)) return legalMoves;
  const byPieceId = new Map((gameState.pieces || []).map((p) => [p.id, p]));
  const isType = (m) => {
    const p = byPieceId.get(m.pieceId);
    return !!p && Number(p.piece_id) === type;
  };
  const isPlacement = (m) => m && (m.type === 'place' || m.isPlacement);
  const ofType = legalMoves.filter(isType);
  if (!ofType.length) return legalMoves;
  return legalMoves.filter((m) => isPlacement(m) || isType(m));
}

/*
 * May this move be played? `legalMovesFor(gameState, pos)` is the engine's
 * getAllLegalMovesForPlayer, passed in to avoid a circular require.
 */
function checkMove(gameState, move, legalMovesFor) {
  if (!isDesignationGame(gameState)) return { ok: true };
  if (needsChoice(gameState)) {
    return { ok: false, reason: 'Waiting for your opponent to choose which piece type you must move.' };
  }
  const type = designatedType(gameState);
  if (type == null || !move) return { ok: true };
  if (move.type === 'place' || move.isPlacement || move.type === 'pass') return { ok: true };
  const piece = (gameState.pieces || []).find((p) => p.id === move.pieceId);
  if (piece && Number(piece.piece_id) === type) return { ok: true };
  const legal = legalMovesFor(gameState, Number(gameState.currentTurn)) || [];
  const byPieceId = new Map((gameState.pieces || []).map((p) => [p.id, p]));
  const typeCanMove = legal.some((m) => {
    const p = byPieceId.get(m.pieceId);
    return p && Number(p.piece_id) === type;
  });
  if (!typeCanMove) return { ok: true };
  const name = (gameState.designation && gameState.designation.pieceName) || 'piece of the chosen type';
  return { ok: false, reason: `You must move a ${name} this action.` };
}

/*
 * Record a choice. `pieceId` null means "no type" - allowed only when there
 * was nothing to choose from - and leaves the mover free.
 */
function applyChoice(gameState, pieceId, chooserId) {
  const choices = choicesFor(gameState);
  let chosen = null;
  if (pieceId != null) {
    chosen = choices.find((c) => c.pieceId === Number(pieceId));
    if (!chosen) return { ok: false, reason: 'That piece type is not one your opponent can be made to move.' };
  } else if (choices.length) {
    return { ok: false, reason: 'Choose a piece type.' };
  }
  const k = actionKey(gameState);
  gameState.designation = {
    forAction: k.forAction,
    mover: k.mover,
    chooser: chooserPos(gameState),
    pieceId: chosen ? chosen.pieceId : null,
    pieceName: chosen ? chosen.name : null,
  };
  if (!Array.isArray(gameState.designationLog)) gameState.designationLog = [];
  gameState.designationLog.push({ ...gameState.designation, by: chooserId ?? null, at: Date.now() });
  return { ok: true, designation: gameState.designation };
}

/*
 * The bot's choice for its opponent: the type that leaves them the fewest
 * legal moves while still having at least one - the tightest squeeze that
 * does not simply hand them a free move. Ties are broken at random.
 */
function botChoice(gameState, legalMovesFor) {
  const choices = choicesFor(gameState);
  if (!choices.length) return null;
  const legal = legalMovesFor(gameState, Number(gameState.currentTurn)) || [];
  const byPieceId = new Map((gameState.pieces || []).map((p) => [p.id, p]));
  const counts = new Map();
  for (const m of legal) {
    const p = byPieceId.get(m.pieceId);
    if (p) counts.set(Number(p.piece_id), (counts.get(Number(p.piece_id)) || 0) + 1);
  }
  const movable = choices.filter((c) => (counts.get(c.pieceId) || 0) > 0);
  const pool = movable.length ? movable : choices;
  const best = Math.min(...pool.map((c) => counts.get(c.pieceId) || 0));
  const tight = pool.filter((c) => (counts.get(c.pieceId) || 0) === best);
  return tight[Math.floor(Math.random() * tight.length)].pieceId;
}

/*
 * Why a game type cannot be saved with this rule, or null. Used by the game
 * create and update routes for published games; the wizard asks the same
 * questions before it lets you press Publish.
 */
function setupError(gameData) {
  if (!gameData) return null;
  const od = parseOther(gameData.other_game_data);
  if (od.designate_piece_type !== true) return null;
  if (gameData.simultaneous_turns) {
    return '"Opponent chooses the piece type" cannot be combined with Simultaneous Turns.';
  }
  if (gameData.veto_enabled) {
    return '"Opponent chooses the piece type" cannot be combined with the Veto ability.';
  }
  let count = 0;
  try {
    const pieces = parseOther(gameData.pieces_string);
    count = Object.values(pieces).filter((p) => p && !p._occupied).length;
  } catch (_) { count = 0; }
  if (count === 0) {
    return '"Opponent chooses the piece type" needs pieces on the starting board: the game opens with a piece type being chosen from them.';
  }
  return null;
}

module.exports = {
  isDesignationGame,
  needsChoice,
  chooserPos,
  designatedType,
  choicesFor,
  filterMoves,
  checkMove,
  applyChoice,
  botChoice,
  setupError,
};
