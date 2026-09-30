/*
 * Win-in-two search, on the site's own engine.
 *
 * puzzle-validation.js deliberately stops at one move: it can say "exactly one
 * move mates here" with certainty, but a longer line was only ever checked for
 * legality, because the opponent's replies were the creator's script rather than
 * a best defence. Fairy-Stockfish filled that gap for generated puzzles, and it
 * models some of this site's pieces differently - a hopper that could already
 * take the King passed as a forced "Mate in four" (puzzle 52).
 *
 * This is the smallest search that closes the gap for two-move puzzles:
 *
 *   is there a move M1 such that, for EVERY reply R, some M2 wins?
 *
 * "Wins" is a parameter, which is what makes one search serve every puzzle:
 *   - a puzzle goal ('checkmate_in_1', 'capture_target', 'promote_a_piece', ...)
 *     via goalMet, so "mate in two" is the goal checkmate, "capture in two" the
 *     goal capture_target, and so on;
 *   - 'win': the game is won by ANY of its rules (terminalOutcome) - the
 *     general "win in two", for games whose win has no goal of its own.
 *
 * Every move is played through applyPly - the live engine's validateAndApplyMove
 * - on a deep copy of the whole state, so HP, burn, points, en passant and the
 * rest carry through exactly as they would in a game. The rules are the site's
 * because the code is the site's.
 *
 * WHAT COUNTS AS A MOVE. The same candidates the one-move check uses (the move
 * generator, en passant, placements), plus every promotion choice as its own
 * move: an under-promotion can be the only win or the only defence. A defender
 * with no legal move who has not lost simply passes, as the live game does
 * when no stalemate rule applies.
 *
 * WHAT IT DOES NOT MODEL (reported as unsupported, never guessed at): turns of
 * more than one action, simultaneous turns, and the veto. A chain capture that
 * continues the same turn is outside it too.
 *
 * COST. Roughly (first moves) x (replies) x (second moves) engine calls in the
 * worst case - tens of thousands. Two things make it tractable. A first move
 * fails at its first refuting reply, and refutations are tried first once any
 * reply has refuted anything ("killer" ordering: the defence that beat one
 * attack usually beats the next). Winning second moves likewise go first. A
 * time budget bounds the rest; a search that runs out says so (complete:
 * false) rather than returning a half-answer as a whole one.
 */
const {
  buildGameState,
  applyPly,
  goalMet,
  terminalOutcome,
  moveKey,
  placementCandidates,
  enPassantCandidates,
  MECHANICAL_GOALS,
} = require('./puzzle-validation');
const { getAllLegalMovesForPlayer } = require('./game-socket');

const other = (side) => (Number(side) === 1 ? 2 : 1);

/*
 * State that never changes during a search is shared rather than copied: the
 * rules, the opening roster and the placeable definitions. Everything else -
 * the pieces and every counter the engine keeps - is copied whole, so no
 * branch can leak into another.
 */
const SHARED_KEYS = new Set(['gameType', 'initialPieces', 'placeableDefs', 'otherGameData', 'players', 'pieces']);

/*
 * A piece is ~150 fields, nearly all plain values, and copying one per engine
 * call is most of the search's cost. structuredClone of the whole array was two
 * thirds of all the time spent; a shallow copy with only the nested values
 * deep-copied is exactly as isolated and several times cheaper.
 */
/*
 * Which fields of a piece hold objects, worked out once per piece object rather
 * than on every copy (walking 269 fields per copy was itself half the cost). A
 * position is never changed after it has been copied from - each move is played
 * on its own copy - so the answer cannot go stale.
 */
const nestedKeysOf = new WeakMap();
function clonePiece(p) {
  let nested = nestedKeysOf.get(p);
  if (!nested) {
    nested = [];
    for (const k in p) {
      const v = p[k];
      if (v !== null && typeof v === 'object') nested.push(k);
    }
    nestedKeysOf.set(p, nested);
  }
  const c = { ...p };
  for (const k of nested) c[k] = structuredClone(p[k]);
  return c;
}

function cloneState(state) {
  const own = {};
  const shared = {};
  for (const [k, v] of Object.entries(state)) (SHARED_KEYS.has(k) ? shared : own)[k] = v;
  return { ...structuredClone(own), ...shared, pieces: (state.pieces || []).map(clonePiece) };
}

/** Why a game type cannot be searched this way, or null. */
function unsupportedReason(gameType) {
  const gt = gameType || {};
  if ((Number(gt.actions_per_turn) || 1) > 1) return 'turns of more than one action';
  if (Number(gt.simultaneous_turns) === 1) return 'simultaneous turns';
  if (Number(gt.veto_enabled) === 1) return 'the veto';
  return null;
}

class Budget {
  constructor({ budgetMs = 30000, maxNodes = Infinity } = {}) {
    this.deadline = Date.now() + budgetMs;
    this.maxNodes = maxNodes;
    this.nodes = 0;
    this.exhausted = false;
  }
  spend() {
    this.nodes++;
    if (this.nodes > this.maxNodes || Date.now() > this.deadline) this.exhausted = true;
    return !this.exhausted;
  }
}

/**
 * Every way `player` can move from `state`, each already played: [{ move, state, ctx }].
 * A promoting move comes back once per promotion choice.
 */
async function playAll(state, player, budget) {
  const base = cloneState(state);
  base.currentTurn = player;
  const candidates = [
    ...(getAllLegalMovesForPlayer(base, player) || []),
    ...enPassantCandidates(base, player),
    ...placementCandidates(base, player),
  ];
  const seen = new Set();
  const out = [];
  for (const move of candidates) {
    const key = moveKey(move);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!budget.spend()) return out;
    // eslint-disable-next-line no-await-in-loop
    const played = await playOne(state, player, move, budget);
    out.push(...played);
  }
  return out;
}

/** One move, played on a copy; every promotion choice when it promotes. */
async function playOne(state, player, move, budget) {
  const copy = cloneState(state);
  copy.currentTurn = player;
  let res;
  try {
    res = await applyPly(copy, move, { listPromotions: true });
  } catch (_) {
    return [];
  }
  if (res.ok) return [{ move, state: copy, ctx: res }];
  if (!res.needsPromotionChoice || !res.promotionOptions?.length) return [];
  const out = [];
  for (const choice of res.promotionOptions) {
    if (!budget.spend()) break;
    const promoted = { ...move, ...choice };
    const c2 = cloneState(state);
    c2.currentTurn = player;
    // eslint-disable-next-line no-await-in-loop
    const r2 = await applyPly(c2, promoted).catch(() => ({ ok: false }));
    if (r2.ok) out.push({ move: promoted, state: c2, ctx: r2 });
  }
  return out;
}

/*
 * Has `side` achieved the aim, in the position a move of theirs just produced?
 * The turn passes to the other side first - the question every win check asks
 * is about the position the opponent now faces.
 */
function achieved(aim, state, side, ctx) {
  state.currentTurn = other(side);
  if (aim === 'win') {
    const outcome = terminalOutcome(state, other(side), ctx);
    return !!(outcome && Number(outcome.winner) === Number(side));
  }
  return goalMet(aim, state, side, ctx);
}

/** Moves in `list` ordered with any whose key is in `first` at the front. */
function killerFirst(list, first, keyOf) {
  if (!first.size) return list;
  const hit = [];
  const rest = [];
  for (const x of list) (first.has(keyOf(x)) ? hit : rest).push(x);
  return hit.concat(rest);
}

/**
 * A move for `side` that achieves the aim at once, or null.
 * `killers` holds keys of moves that won in sibling positions; they go first.
 */
async function findWinInOne(state, side, aim, budget, killers) {
  const base = cloneState(state);
  base.currentTurn = side;
  const candidates = killerFirst([
    ...(getAllLegalMovesForPlayer(base, side) || []),
    ...enPassantCandidates(base, side),
    ...placementCandidates(base, side),
  ], killers, moveKey);
  const seen = new Set();
  for (const move of candidates) {
    const key = moveKey(move);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!budget.spend()) return null;
    // eslint-disable-next-line no-await-in-loop
    const played = await playOne(state, side, move, budget);
    for (const p of played) {
      if (achieved(aim, p.state, side, p.ctx)) {
        killers.add(moveKey(p.move));
        return p.move;
      }
    }
  }
  return null;
}

/*
 * After `side` played a first move (reaching `s1`): does every reply leave a
 * win in one? Returns { forces, refutation, answers } - refutation is the reply
 * that escapes, answers maps each reply to the move that wins after it.
 */
async function forcesAfter(s1, side, aim, budget, memory) {
  const defender = other(side);
  const replies = killerFirst(await playAll(s1, defender, budget), memory.refutations, (r) => moveKey(r.move));
  if (budget.exhausted) return { forces: false, incomplete: true };

  if (!replies.length) {
    // No legal reply. Either that ends the game (and says who won), or the
    // defender passes and it is `side` to move again.
    const outcome = terminalOutcome(s1, defender, null);
    if (outcome) return { forces: Number(outcome.winner) === Number(side), refutation: null, answers: [], passed: false };
    const win = await findWinInOne(s1, side, aim, budget, memory.wins);
    if (budget.exhausted && !win) return { forces: false, incomplete: true };
    return { forces: !!win, refutation: win ? null : { pass: true }, answers: win ? [{ reply: { pass: true }, win }] : [], passed: true };
  }

  const answers = [];
  for (const r of replies) {
    // A reply that ends the game: fine if it hands `side` the win, an escape if not.
    const ended = terminalOutcome(r.state, side, r.ctx);
    if (ended) {
      if (Number(ended.winner) === Number(side)) { answers.push({ reply: r.move, win: null }); continue; }
      memory.refutations.add(moveKey(r.move));
      return { forces: false, refutation: r.move, answers };
    }
    // eslint-disable-next-line no-await-in-loop
    const win = await findWinInOne(r.state, side, aim, budget, memory.wins);
    if (!win) {
      if (budget.exhausted) return { forces: false, incomplete: true };
      memory.refutations.add(moveKey(r.move));
      return { forces: false, refutation: r.move, answers };
    }
    answers.push({ reply: r.move, win });
  }
  return { forces: true, refutation: null, answers };
}

/**
 * Search a puzzle position for wins in one and forced wins in two.
 *
 * @param {object} puzzle   the puzzle shape validatePuzzle takes (position, side_to_move, setup_move, ...)
 * @param {object} gameType the game_types row
 * @param {object} [opts]
 * @param {string} [opts.aim]          a mechanical puzzle goal, or 'win' (default: the puzzle's goal)
 * @param {object} [opts.firstMove]    search only this first move (checking a creator's line)
 * @param {boolean} [opts.stopAtFirst] stop at the first forced win (a "is there one?" question)
 * @param {number} [opts.budgetMs]     time budget (default 30s)
 * @returns {Promise<object>} {
 *   supported, reason, complete, aim,
 *   winsInOne: [move],                         first moves that win outright
 *   winsInTwo: [{ move, answers }],            first moves that force a win next move
 *   refuted: [{ move, refutation }],           first moves some reply escapes
 *   nodes, ms }
 */
async function searchWinInTwo(puzzle, gameType, opts = {}) {
  const started = Date.now();
  const aim = opts.aim || puzzle.goal || 'win';
  const unsupported = unsupportedReason(gameType);
  const result = {
    supported: !unsupported, reason: unsupported, complete: false, aim,
    winsInOne: [], winsInTwo: [], refuted: [], nodes: 0, ms: 0,
  };
  if (unsupported) return result;
  if (aim !== 'win' && !MECHANICAL_GOALS.has(aim)) {
    return { ...result, supported: false, reason: `'${aim}' is not a goal the engine can judge` };
  }

  const side = Number(puzzle.side_to_move);
  const budget = new Budget(opts);
  const memory = { refutations: new Set(), wins: new Set() };
  const root = buildGameState(puzzle, gameType);

  let firsts;
  if (opts.firstMove) {
    firsts = await playOne(root, side, opts.firstMove, budget);
  } else {
    firsts = await playAll(root, side, budget);
  }

  for (const f of firsts) {
    if (budget.exhausted) break;
    if (achieved(aim, f.state, side, f.ctx)) {
      result.winsInOne.push(f.move);
      if (opts.stopAtFirst) break;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const verdict = await forcesAfter(f.state, side, aim, budget, memory);
    if (verdict.incomplete) break;
    if (verdict.forces) {
      result.winsInTwo.push({ move: f.move, answers: verdict.answers });
      if (opts.stopAtFirst) break;
    } else {
      result.refuted.push({ move: f.move, refutation: verdict.refutation });
    }
  }

  result.complete = !budget.exhausted;
  result.nodes = budget.nodes;
  result.ms = Date.now() - started;
  return result;
}

module.exports = { searchWinInTwo, cloneState, unsupportedReason };
