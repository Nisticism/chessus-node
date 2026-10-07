/*
 * Is every move of a puzzle's line a GOOD move - not just a legal one?
 *
 * The forcing check (puzzle-search.js verifyPuzzleLine) asks whether the line
 * wins against every defense, and whether the solver's move is the only one
 * that does. It never grades the creator's SCRIPT. Both sides of a line are
 * the creator's choice, even though a solver plays only one of them, and a
 * line can pass every forcing check while one side plays badly:
 *
 *   THE OPPONENT'S REPLY (the computer's move). It is not their best when
 *     another reply would have stopped the goal altogether, or held out for
 *     more of the solver's moves. "Mate in two" where the opponent pushes a
 *     pawn instead of the defense that lasts is the case that asked for this.
 *     Material does NOT come into it: when every reply loses in the same number
 *     of moves, every one of them is acceptable, the one that hands over a
 *     queen included - the user's ruling (2026-10-07). Where material DOES
 *     decide the game (a points win), a reply that gives it away loses sooner,
 *     and is caught as "held out less" like any other.
 *   THE SOLVER'S MOVE. It is not the best when another move finishes the goal
 *     in fewer moves - the line takes the long way round.
 *
 * The move that led into the position (setup_move) is the opponent's too, but
 * it is history, not a choice the puzzle asks anyone to defend: never judged.
 *
 * Every move is searched with the same primitives as the forcing check, so a
 * finding here is about the same rules and the same goal. It only makes sense
 * of a FORCED line (each reply then loses within the moves left), and callers
 * run it only then; a reply that "escapes" is still reported if met.
 *
 * @returns {Promise<object>} { complete, findings: [{ side: 'reply'|'move', step,
 *   kind: 'escapes'|'shorter'|'slower', text }], nodes, ms }
 */
const {
  buildGameState, playLine, describeMoveOn, terminalOutcome, moveKey, lineGoalLabel,
} = require('./puzzle-validation');
const {
  Budget, TT_MAX_DEFAULT, playAll, playOne, achieved, achievedAfterReply, winsWithin, everyReplyLoses,
  REPLY_COMPLETED_AIMS,
} = require('./puzzle-search');

const other = (side) => (Number(side) === 1 ? 2 : 1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// How many better moves to name; the rest are counted.
const NAME = 3;

/* -------------------------------------------------------------- distances -- */

/*
 * The fewest of `side`'s moves, from `from` up to `max`, that force the aim
 * from `state` with `side` to move. Infinity if none within `max`; null if the
 * budget ran out first.
 */
async function fewestToForce(state, side, aim, max, budget, memory, from = 1) {
  for (let k = from; k <= max; k++) {
    // eslint-disable-next-line no-await-in-loop
    const win = await winsWithin(state, side, aim, k, budget, memory);
    if (budget.exhausted) return null;
    if (win) return k;
  }
  return Infinity;
}

/* How long the defender lasts after reply `r`: the solver's moves still needed. */
async function lifeAfter(r, side, aim, max, budget, memory, from = 1) {
  const ended = terminalOutcome(r.state, side, r.ctx);
  if (ended) return Number(ended.winner) === Number(side) ? 0 : Infinity;
  if (achievedAfterReply(aim, r.state, side)) return 0;
  return fewestToForce(r.state, side, aim, max, budget, memory, from);
}

/*
 * How many of the solver's moves the line's own move needs to force the aim
 * (1 = it achieves it at once), up to `max`. Infinity if it does not force it.
 */
async function moveNeeds(played, side, aim, max, budget, memory) {
  if (achieved(aim, played.state, side, played.ctx)) return 1;
  const startAt = REPLY_COMPLETED_AIMS.has(aim) ? 1 : 2;
  for (let k = startAt; k <= max; k++) {
    // eslint-disable-next-line no-await-in-loop
    const v = await everyReplyLoses(played.state, side, aim, k - 1, budget, memory);
    if (budget.exhausted) return null;
    if (v.forces) return k;
  }
  return Infinity;
}

/* ------------------------------------------------------------------- judge -- */

const nameList = (names, total) => (total > names.length
  ? `${names.join(', ')} and ${total - names.length} more`
  : names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0]);

async function judgeReply(puzzle, gameType, line, step, ctx) {
  const { side, aim, n, budget, memory, label } = ctx;
  const replyIndex = 2 * step - 1;
  const remaining = n - step;
  const played = await playLine(puzzle, gameType, line.slice(0, replyIndex));
  if (!played.ok) return null;
  const pieces = played.state.pieces;
  const replies = await playAll(played.state, other(side), budget);
  if (budget.exhausted || replies.length < 2) return null; // no choice, nothing to judge
  const scriptedKey = moveKey(line[replyIndex]);
  const scripted = replies.find((r) => moveKey(r.move) === scriptedKey);
  if (!scripted) return null;
  const say = (m) => describeMoveOn(pieces, gameType, m);

  const life = await lifeAfter(scripted, side, aim, remaining, budget, memory);
  if (life === null) return null;
  if (life === Infinity) return null; // the line is not forced: the forcing check reports that

  // Replies that last longer: no forced finish within `life`.
  const better = [];
  for (const r of replies) {
    if (r === scripted) continue;
    // Finished within as many moves as the line's reply allows: not better.
    // eslint-disable-next-line no-await-in-loop
    const within = await lifeAfter(r, side, aim, life, budget, memory);
    if (within === null) return null;
    if (within !== Infinity) continue;
    // eslint-disable-next-line no-await-in-loop
    const l = await lifeAfter(r, side, aim, remaining, budget, memory, life + 1);
    if (l === null) return null;
    better.push({ move: r.move, life: l });
  }
  if (better.length) {
    const escapes = better.filter((b) => b.life === Infinity);
    const best = escapes.length ? escapes : better.filter((b) => b.life === Math.max(...better.map((x) => x.life)));
    const names = best.slice(0, NAME).map((b) => say(b.move));
    const after = life === 0 ? 'it hands you the goal at once' : `after it you finish in ${plural(life, 'more move')}`;
    return {
      side: 'reply', step, kind: escapes.length ? 'escapes' : 'shorter',
      text: escapes.length
        ? `The opponent's reply on move ${step} (${say(scripted.move)}) is not their best: ${nameList(names, best.length)} would have stopped ${label} within the puzzle.`
        : `The opponent's reply on move ${step} (${say(scripted.move)}) gives up early: ${after}, but ${nameList(names, best.length)} would have held out for ${plural(best[0].life, 'move')}.`,
    };
  }

  return null;
}

async function judgeMove(puzzle, gameType, line, step, ctx) {
  const { side, aim, n, budget, memory, label } = ctx;
  const remaining = n - step + 1;
  if (remaining < 2) return null; // the last move cannot be beaten for speed
  const prefix = line.slice(0, 2 * (step - 1));
  let state = buildGameState(puzzle, gameType);
  if (prefix.length) {
    const played = await playLine(puzzle, gameType, prefix);
    if (!played.ok) return null;
    state = played.state;
  }
  const lineMove = line[2 * (step - 1)];
  const [mine] = await playOne(state, side, lineMove, budget);
  if (!mine) return null;
  const needs = await moveNeeds(mine, side, aim, remaining, budget, memory);
  if (needs === null || needs === Infinity || needs < 2) return null;
  const fastest = await fewestToForce(state, side, aim, needs - 1, budget, memory);
  if (fastest === null || fastest === Infinity) return null;
  const quicker = await winsWithin(state, side, aim, fastest, budget, memory);
  if (!quicker) return null;
  const say = (m) => describeMoveOn(state.pieces, gameType, m);
  return {
    side: 'move', step, kind: 'slower',
    text: `Your move ${step} (${say(lineMove)}) is not the quickest: ${say(quicker)} forces ${label} in ${plural(fastest, 'move')}, where yours needs ${needs}.`,
  };
}

async function judgeLine(puzzle, gameType, line, opts = {}) {
  const started = Date.now();
  const aim = opts.aim || puzzle.goal;
  const side = Number(puzzle.side_to_move);
  const n = Math.ceil(line.length / 2);
  const budget = new Budget({ budgetMs: opts.budgetMs || 60000, dutyCycle: opts.dutyCycle });
  const memory = { tt: new Map(), ttMax: Number(opts.ttMax) || TT_MAX_DEFAULT, wins: {}, refutations: {} };
  const ctx = { side, aim, n, budget, memory, label: lineGoalLabel(aim) };
  const findings = [];
  // Step by step, in the order they are played: reply i follows your move i.
  for (let step = 1; step <= n && !budget.exhausted; step++) {
    // eslint-disable-next-line no-await-in-loop
    const m = await judgeMove(puzzle, gameType, line, step, ctx);
    if (m) findings.push(m);
    // The last reply of a line the opponent's move completes is the goal
    // itself, not a defense; a line ending on your move has no reply after it.
    if (step < n && 2 * step - 1 < line.length && !budget.exhausted) {
      // eslint-disable-next-line no-await-in-loop
      const r = await judgeReply(puzzle, gameType, line, step, ctx);
      if (r) findings.push(r);
    }
  }
  return { complete: !budget.exhausted, findings, nodes: budget.nodes, ms: Date.now() - started };
}

/* The findings, as the sentences a check result carries. */
const describeFindings = (findings) => findings.map((f) => f.text).join(' ');

module.exports = { judgeLine, describeFindings };
