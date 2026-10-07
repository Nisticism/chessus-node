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

/*
 * Aims the OPPONENT's move completes. Losing your last piece is the case: you
 * offer it, and they take it (in antichess, because they must). For these the
 * solver's "move" runs through the reply - the search tests the aim after the
 * opponent's answer as well as after the solver's own move, and the last step
 * of a line looks one reply further rather than stopping at the solver's move.
 */
const { REPLY_COMPLETED_GOALS: REPLY_COMPLETED_AIMS } = require('./puzzle-validation');

/** Why a game type cannot be searched this way, or null. */
function unsupportedReason(gameType, aim) { // eslint-disable-line no-unused-vars
  const gt = gameType || {};
  if ((Number(gt.actions_per_turn) || 1) > 1) return 'turns of more than one action';
  if (Number(gt.simultaneous_turns) === 1) return 'simultaneous turns';
  if (Number(gt.veto_enabled) === 1) return 'the veto';
  return null;
}

/* The solver's own pieces are all gone: the lose-all aim, tested without touching the state. */
function noPiecesLeft(state, side) {
  return !(state.pieces || []).some((p) => Number(p.team ?? p.player_id ?? p.player_number) === Number(side));
}

/* After the OPPONENT's reply: has a reply-completed aim been met? */
function achievedAfterReply(aim, state, side) {
  return aim === 'lose_all_pieces' && noPiecesLeft(state, side);
}

/*
 * How many positions the win-in-N search remembers before starting afresh.
 * Each entry is a position key (a few hundred bytes), so the default stays well
 * inside a worker's heap; a long staff search may raise it with opts.ttMax.
 * Clearing costs only repeated work, never a wrong answer.
 */
const TT_MAX_DEFAULT = 150000;
function remember(memory, key, value) {
  if (memory.tt.size >= memory.ttMax) memory.tt.clear();
  memory.tt.set(key, value);
}

class Budget {
  /*
   * dutyCycle (0-1): the share of wall-clock time the search may spend
   * computing. Below 1, every ~50ms of work is followed by a pause (breathe),
   * so a long verification running in a worker leaves the CPU to the site.
   */
  constructor({ budgetMs = 30000, maxNodes = Infinity, dutyCycle = 1, onTick = null } = {}) {
    // onTick(nodes), every 2,000 positions: a heartbeat for long searches,
    // whose per-first-move progress can be minutes or hours apart.
    this.onTick = onTick;
    this.deadline = Date.now() + budgetMs;
    this.maxNodes = maxNodes;
    this.nodes = 0;
    this.exhausted = false;
    this.dutyCycle = Math.min(1, Math.max(0.05, Number(dutyCycle) || 1));
    this.sliceStart = Date.now();
  }
  async breathe() {
    if (this.dutyCycle >= 1) return;
    const worked = Date.now() - this.sliceStart;
    if (worked < 50) return;
    const rest = Math.round(worked * (1 - this.dutyCycle) / this.dutyCycle);
    await new Promise((r) => setTimeout(r, rest));
    this.deadline += rest; // pauses do not count against the time budget
    this.sliceStart = Date.now();
  }
  spend() {
    this.nodes++;
    if (this.onTick && this.nodes % 2000 === 0) this.onTick(this.nodes);
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
    await budget.breathe();
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
    await budget.breathe();
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
  const unsupported = unsupportedReason(gameType, aim);
  const result = {
    supported: !unsupported, reason: unsupported, complete: false, aim,
    winsInOne: [], winsInTwo: [], refuted: [], nodes: 0, ms: 0,
  };
  if (unsupported) return result;
  // Its second move is judged straight after the solver's move, so an aim the
  // reply completes is beyond it. searchWinInN (below) handles those.
  if (REPLY_COMPLETED_AIMS.has(aim)) {
    return { ...result, supported: false, reason: "a goal the opponent's move completes - use the whole-line search" };
  }
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

/* ------------------------------------------------------- win in N -- */

/*
 * The same question at any depth: does the solver have a move that forces the
 * aim within N of their own moves, whatever the opponent replies?
 *
 *   wins(state, n)   = some move M achieves the aim, or (n > 1 and) after M
 *                      every reply leaves wins(_, n - 1)
 *
 * Exponential, so it is for offline analysis and checking, not a request a
 * creator waits on: the cost grows by roughly (moves x replies) per extra
 * move. What keeps it usable: a first move dies at its first refuting reply;
 * refutations and winning moves found anywhere are tried first everywhere
 * ("killers", per depth); and a position already proven or refuted at a
 * depth is remembered (transpositions are common - the same position reached
 * in a different order).
 */
const positionKey = (state) => (state.pieces || [])
  .map((p) => `${p.id}@${p.x},${p.y}:${p.piece_id}:${p.player_id ?? p.team}:${p.current_hp ?? ''}`)
  .sort()
  .join('|');

async function winsWithin(state, side, aim, n, budget, memory) {
  const key = `${n}#${side}#${positionKey(state)}`;
  if (memory.tt.has(key)) return memory.tt.get(key);
  const killers = memory.wins[n] || (memory.wins[n] = new Set());
  // The last move: one ply deep - unless the reply completes the aim, when the
  // replies are the last thing to look at (everyReplyLoses with n = 0).
  if (n === 1 && !REPLY_COMPLETED_AIMS.has(aim)) {
    const win = await findWinInOne(state, side, aim, budget, killers);
    if (!budget.exhausted) remember(memory, key, win);
    return win;
  }
  const base = cloneState(state);
  base.currentTurn = side;
  const candidates = killerFirst([
    ...(getAllLegalMovesForPlayer(base, side) || []),
    ...enPassantCandidates(base, side),
    ...placementCandidates(base, side),
  ], killers, moveKey);
  const seen = new Set();
  for (const move of candidates) {
    const mk = moveKey(move);
    if (seen.has(mk)) continue;
    seen.add(mk);
    if (!budget.spend()) return null;
    // eslint-disable-next-line no-await-in-loop
    const played = await playOne(state, side, move, budget);
    for (const p of played) {
      if (achieved(aim, p.state, side, p.ctx)) {
        killers.add(moveKey(p.move));
        remember(memory, key, p.move);
        return p.move;
      }
      // eslint-disable-next-line no-await-in-loop
      const verdict = await everyReplyLoses(p.state, side, aim, n - 1, budget, memory);
      if (budget.exhausted) return null;
      if (verdict.forces) {
        killers.add(moveKey(p.move));
        remember(memory, key, p.move);
        return p.move;
      }
    }
  }
  if (!budget.exhausted) remember(memory, key, null);
  return null;
}

/*
 * After the solver's move (reaching s1): does every reply leave wins(_, n)?
 * n = 0 (only for an aim the reply completes): every reply has to complete it.
 */
async function everyReplyLoses(s1, side, aim, n, budget, memory) {
  const defender = other(side);
  const refs = memory.refutations[n] || (memory.refutations[n] = new Set());
  const replies = killerFirst(await playAll(s1, defender, budget), refs, (r) => moveKey(r.move));
  if (budget.exhausted) return { forces: false };
  if (!replies.length) {
    const outcome = terminalOutcome(s1, defender, null);
    if (outcome) return { forces: Number(outcome.winner) === Number(side) };
    // No legal reply and no ending: they pass, and it is the solver's move again.
    if (n === 0) return { forces: false, refutation: { pass: true } };
    const win = await winsWithin(s1, side, aim, n, budget, memory);
    return { forces: !!win, refutation: win ? null : { pass: true } };
  }
  for (const r of replies) {
    const ended = terminalOutcome(r.state, side, r.ctx);
    if (ended) {
      if (Number(ended.winner) === Number(side)) continue;
      refs.add(moveKey(r.move));
      return { forces: false, refutation: r.move };
    }
    // The reply completed the aim (it took the solver's last piece): done.
    if (achievedAfterReply(aim, r.state, side)) continue;
    if (n === 0) {
      refs.add(moveKey(r.move));
      return { forces: false, refutation: r.move };
    }
    // eslint-disable-next-line no-await-in-loop
    const win = await winsWithin(r.state, side, aim, n, budget, memory);
    if (budget.exhausted) return { forces: false };
    if (!win) {
      refs.add(moveKey(r.move));
      return { forces: false, refutation: r.move };
    }
  }
  return { forces: true };
}

/**
 * Every first move that forces the aim within `depth` of the solver's moves.
 *
 * @param {object} puzzle    the shape validatePuzzle takes
 * @param {object} gameType  the game_types row
 * @param {object} opts      { aim, depth, budgetMs, firstMoves? (only these), onMove? (progress callback) }
 * @returns {Promise<object>} { supported, reason, complete, forcing: [move], refuted: [{ move, refutation }],
 *                              winsAtOnce: [move], nodes, ms }
 */
async function searchWinInN(puzzle, gameType, opts = {}) {
  const started = Date.now();
  const aim = opts.aim || puzzle.goal || 'win';
  const depth = Math.max(1, Number(opts.depth) || 2);
  const unsupported = unsupportedReason(gameType, aim);
  const result = { supported: !unsupported, reason: unsupported, complete: false, aim, depth,
    forcing: [], refuted: [], winsAtOnce: [], nodes: 0, ms: 0 };
  if (unsupported) return result;
  const side = Number(puzzle.side_to_move);
  const tick = opts.onMove ? (nodes) => opts.onMove(null, result, nodes) : null;
  const budget = new Budget({ ...opts, onTick: tick });
  const memory = { tt: new Map(), ttMax: Number(opts.ttMax) || TT_MAX_DEFAULT, wins: {}, refutations: {} };
  const root = buildGameState(puzzle, gameType);
  const firsts = opts.firstMoves
    ? (await Promise.all(opts.firstMoves.map((m) => playOne(root, side, m, budget)))).flat()
    : await playAll(root, side, budget);
  result.total = firsts.length; // first moves to examine, for progress reporting
  if (opts.onMove) opts.onMove(null, result, budget.nodes);
  for (const f of firsts) {
    if (budget.exhausted) break;
    if (achieved(aim, f.state, side, f.ctx)) {
      result.winsAtOnce.push(f.move);
    } else if (depth > 1 || REPLY_COMPLETED_AIMS.has(aim)) {
      // eslint-disable-next-line no-await-in-loop
      const verdict = await everyReplyLoses(f.state, side, aim, depth - 1, budget, memory);
      if (budget.exhausted) break;
      if (verdict.forces) result.forcing.push(f.move);
      else result.refuted.push({ move: f.move, refutation: verdict.refutation });
    } else {
      result.refuted.push({ move: f.move, refutation: null });
    }
    if (opts.onMove) opts.onMove(f.move, result, budget.nodes);
  }
  result.complete = !budget.exhausted;
  result.nodes = budget.nodes;
  result.ms = Date.now() - started;
  return result;
}

/* ------------------------------------------------- whole-line verification -- */

/*
 * Check a puzzle's line step by step: at each of the solver's moves, which
 * moves force the goal within the moves that remain?
 *
 *   lineForces  the line's own move is among them at every step - the line
 *               really is a forced win, whatever the opponent replies.
 *   sound       exactly ONE such move at every step but the last. The solve
 *               route accepts only the line's move before the end, so a second
 *               winner there is a correct answer it would call wrong.
 *               (Any winning final move is accepted, so the last step may
 *               have several.)
 *   unique      exactly one at EVERY step, the last included: one solution,
 *               full stop. This is what the "verified unique solution" badge
 *               certifies.
 *
 * Each step searches only the position the line actually reaches there (the
 * replies the puzzle plays), so the cost is dominated by its first step: a
 * full search `solverMoves` deep. `onProgress({ step, steps, done, total })`
 * reports first moves examined, for a progress bar.
 *
 * @returns {Promise<object>} { complete, supported, reason, lineForces, sound, unique,
 *                              steps: [{ step, depth, forcing, count, lineIncluded, refuted }], nodes, ms }
 */
async function verifyPuzzleLine(puzzle, gameType, line, opts = {}) {
  const started = Date.now();
  const aim = opts.aim || puzzle.goal || 'win';
  const solverMoves = Math.ceil(line.length / 2);
  const unsupported = unsupportedReason(gameType, aim);
  const out = { complete: false, supported: !unsupported, reason: unsupported, lineForces: false,
    sound: false, unique: false, steps: [], nodes: 0, ms: 0, solverMoves };
  if (unsupported || !line.length) return out;
  const { playLine } = require('./puzzle-validation');
  const deadline = Date.now() + (opts.budgetMs || 60000);

  for (let step = 1; step <= solverMoves; step++) {
    const prefix = line.slice(0, (step - 1) * 2);
    let at = puzzle;
    if (prefix.length) {
      // eslint-disable-next-line no-await-in-loop
      const played = await playLine(puzzle, gameType, prefix);
      if (!played.ok) { out.reason = `the line cannot be replayed at move ${step}`; out.ms = Date.now() - started; return out; }
      at = { ...puzzle, position: played.state.pieces, setup_move: prefix[prefix.length - 1] };
    }
    const depth = solverMoves - step + 1;
    const lineMove = line[(step - 1) * 2];
    // eslint-disable-next-line no-await-in-loop
    const r = await searchWinInN(at, gameType, {
      aim, depth, budgetMs: Math.max(0, deadline - Date.now()), dutyCycle: opts.dutyCycle, ttMax: opts.ttMax,
      onMove: opts.onProgress
        ? (m, res, nodes) => opts.onProgress({ step, steps: solverMoves,
          done: res.forcing.length + res.refuted.length + res.winsAtOnce.length, total: res.total || null,
          nodes: out.nodes + (nodes || 0) })
        : null,
    });
    out.nodes += r.nodes;
    if (!r.complete) { out.ms = Date.now() - started; return out; }
    const forcing = [...r.winsAtOnce, ...r.forcing];
    /*
     * Counted by MOVE, not by promotion choice: promoting the same pawn to two
     * pieces that both win is one move with a choice attached - the
     * validator's convention (boardMoveKey). Whether the line's own move is
     * among them is asked exactly, promotion choice included.
     */
    const { boardMoveKey } = require('./puzzle-validation');
    const moves = new Set(forcing.map(boardMoveKey));
    out.steps.push({
      step, depth,
      forcing,
      count: moves.size,
      lineIncluded: forcing.some((m) => moveKey(m) === moveKey(lineMove)),
    });
  }
  out.complete = true;
  out.lineForces = out.steps.every((s) => s.lineIncluded);
  out.sound = out.lineForces && out.steps.slice(0, -1).every((s) => s.count === 1);
  out.unique = out.lineForces && out.steps.every((s) => s.count === 1);
  out.ms = Date.now() - started;
  return out;
}

/*
 * The defenses against one move of a line: at solver move `step`, after the
 * line's own move, which replies leave the aim no longer forceable in the moves
 * left? For telling a creator exactly what their line misses.
 *
 * Every reply is tried (so `total` is the real count), but only the first `max`
 * are kept. `incomplete` when the budget ran out part-way - what was found is
 * still a real defense, just maybe not the only one. `notAMove` when the line's
 * move cannot be played; `lastMoveMisses` when it is the last move and simply
 * does not reach the aim (there is no defense to name - nothing was threatened).
 *
 * @returns {Promise<object|null>} { defenses: [move], total, complete, before, after, lineMove }
 */
async function defensesAgainst(puzzle, gameType, line, step, opts = {}) {
  const aim = opts.aim || puzzle.goal || 'win';
  const max = Number(opts.max) || 3;
  const solverMoves = Math.ceil(line.length / 2);
  const depth = solverMoves - step + 1;
  const lineMove = line[(step - 1) * 2];
  if (!lineMove) return null;
  const { playLine } = require('./puzzle-validation');
  const prefix = line.slice(0, (step - 1) * 2);
  let at = puzzle;
  if (prefix.length) {
    const played = await playLine(puzzle, gameType, prefix);
    if (!played.ok) return null;
    at = { ...puzzle, position: played.state.pieces, setup_move: prefix[prefix.length - 1] };
  }
  const side = Number(puzzle.side_to_move);
  const budget = new Budget({ budgetMs: opts.budgetMs || 60000, dutyCycle: opts.dutyCycle });
  const memory = { tt: new Map(), ttMax: Number(opts.ttMax) || TT_MAX_DEFAULT, wins: {}, refutations: {} };
  const root = buildGameState(at, gameType);
  const out = { defenses: [], total: 0, complete: false, before: root.pieces, after: null, lineMove };
  const [first] = await playOne(root, side, lineMove, budget);
  if (!first) return { ...out, notAMove: true };
  out.after = first.state.pieces;
  if (depth === 1 && !REPLY_COMPLETED_AIMS.has(aim)) return { ...out, complete: true, lastMoveMisses: true };
  const replies = await playAll(first.state, other(side), budget);
  if (!replies.length) {
    const ended = terminalOutcome(first.state, other(side), null);
    if (!ended || Number(ended.winner) !== side) { out.total = 1; out.defenses.push({ pass: true }); }
    out.complete = true;
    return out;
  }
  for (const r of replies) {
    if (budget.exhausted) return out;
    const ended = terminalOutcome(r.state, side, r.ctx);
    let escapes;
    if (ended) escapes = Number(ended.winner) !== side;
    else if (achievedAfterReply(aim, r.state, side)) escapes = false;
    else if (depth - 1 === 0) escapes = true;
    else {
      // eslint-disable-next-line no-await-in-loop
      const win = await winsWithin(r.state, side, aim, depth - 1, budget, memory);
      if (budget.exhausted) return out;
      escapes = !win;
    }
    if (escapes) {
      out.total += 1;
      if (out.defenses.length < max) out.defenses.push(r.move);
    }
  }
  out.complete = true;
  return out;
}

module.exports = {
  searchWinInTwo, searchWinInN, verifyPuzzleLine, defensesAgainst, cloneState, unsupportedReason, REPLY_COMPLETED_AIMS,
  // The search's own pieces, for judging a line move by move (puzzle-line-quality.js).
  Budget, TT_MAX_DEFAULT, playAll, playOne, achieved, achievedAfterReply, winsWithin, everyReplyLoses,
};
