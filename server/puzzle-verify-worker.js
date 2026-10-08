/*
 * Runs a puzzle check off the main thread (see puzzle-jobs.js).
 *
 * A deep search is pure computation: run on the web server's own thread it
 * would freeze every request for as long as it took. Here it has a thread of
 * its own, a memory cap set by the job manager, and a CPU duty cycle (the
 * search pauses between slices of work) so the site keeps its share.
 *
 * workerData: { kind, puzzle, gameType, opts }
 *   kind 'validate'  the builder's check: validatePuzzle with the whole-line
 *                    search turned on
 *   kind 'verify'    a staff uniqueness search: verifyPuzzleLine over the whole
 *                    line, however long, for as long as it takes (opts.budgetMs,
 *                    unlimited by default)
 *   puzzle and gameType arrive already hydrated by the caller, so this needs
 *   nothing but the engine.
 * Posts { type: 'progress', progress } (throttled), then { type: 'result', result }
 * or { type: 'error', message }.
 */
const { parentPort, workerData } = require('worker_threads');

/*
 * A staff search's answer, in words: what it found at each step, with the
 * extra winning moves named on the position where they were found.
 */
async function verify(puzzle, gameType, opts, onProgress) {
  const { verifyPuzzleLine } = require('./puzzle-search');
  const { playLine, describeMoveOn, buildGameState, boardMoveKey, GOAL_DEFS, settleLine } = require('./puzzle-validation');
  // Placements named by where they land, as the search finds them (settleLine).
  const line = await settleLine(puzzle, gameType, Array.isArray(puzzle.solution_line) ? puzzle.solution_line : []);
  puzzle = { ...puzzle, solution_line: line };
  const r = await verifyPuzzleLine(puzzle, gameType, line, {
    // A "find this exact move" puzzle arrives with aim 'win_in_1' (the game's own win).
    aim: opts.aim || puzzle.goal,
    budgetMs: Number.isFinite(opts.budgetMs) && opts.budgetMs > 0 ? opts.budgetMs : Infinity,
    dutyCycle: opts.dutyCycle,
    ttMax: opts.ttMax,
    onProgress,
  });
  const { lineGoalLabel } = require('./puzzle-validation');
  const label = lineGoalLabel(opts.aim || puzzle.goal);
  const steps = [];
  for (const st of r.steps) {
    const prefix = line.slice(0, (st.step - 1) * 2);
    let pieces = buildGameState(puzzle, gameType).pieces;
    if (prefix.length) {
      // eslint-disable-next-line no-await-in-loop
      const played = await playLine(puzzle, gameType, prefix);
      if (played.ok) pieces = played.state.pieces;
    }
    const seen = new Set();
    const named = [];
    for (const m of st.forcing) {
      // Each promotion choice by name: they are different answers unless the
      // line's reply makes them the same (the step's count says how many).
      const k = `${boardMoveKey(m)}|${m.promotionPieceId ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (named.length < 6) named.push(describeMoveOn(pieces, gameType, m));
    }
    steps.push({ step: st.step, depth: st.depth, count: st.count, lineIncluded: st.lineIncluded, moves: named });
  }

  let verdict = null;
  let detail;
  let quality = null;
  /*
   * The line has to meet the puzzle's GOAL before forcedness means anything:
   * a line that wins the game by another rule (puzzle 113 - a stalemate goal,
   * won by losing every piece) is refused for that, with the goal it does
   * meet, rather than as "not forced".
   */
  let missed = null;
  try {
    const { goalMet, lineMissesGoal, MECHANICAL_GOALS } = require('./puzzle-validation');
    const goal = opts.aim || puzzle.goal;
    if (MECHANICAL_GOALS.has(goal)) {
      const played = await playLine(puzzle, gameType, line);
      if (played.ok) {
        played.state.currentTurn = Number(puzzle.side_to_move) === 1 ? 2 : 1;
        if (!goalMet(goal, played.state, Number(puzzle.side_to_move), played.ctx)) {
          missed = lineMissesGoal({ ...puzzle, goal }, gameType, played.state, played.ctx);
        }
      }
    }
  } catch (_) { /* judged by the search as before */ }
  if (missed) {
    verdict = 'goal_not_met';
    detail = `The line does not meet the puzzle's goal: ${missed}`;
  } else if (!r.supported) {
    detail = `This puzzle cannot be searched: ${r.reason}.`;
  } else if (!r.complete) {
    detail = r.reason ? `The search stopped: ${r.reason}.` : 'The search stopped before it finished.';
  } else if (!r.lineForces) {
    // Not always the first failing step (stepToExplain).
    const { stepToExplain } = require('./puzzle-validation');
    const broken = stepToExplain(r.steps);
    const brokenStep = r.steps.find((s) => s.step === broken.step);
    verdict = 'not_forced';
    const { describeNotForced } = require('./puzzle-validation');
    const why = await describeNotForced(puzzle, gameType, line, broken.step, label, brokenStep?.forcing || [],
      { aim: opts.aim || puzzle.goal, budgetMs: 5 * 60000, dutyCycle: opts.dutyCycle });
    detail = `The line is not forced: ${why}`;
  } else {
    /*
     * Forced - so grade the script too (puzzle-line-quality.js): the
     * opponent's replies and the solver's own moves. A weak reply or a slow
     * move is named, and refuses the badge with its own verdict, ahead of
     * "more than one solution" - it is usually WHY there is more than one.
     */
    const { judgeLine } = require('./puzzle-line-quality');
    quality = await judgeLine(puzzle, gameType, line, {
      aim: opts.aim || puzzle.goal,
      budgetMs: Number.isFinite(opts.budgetMs) && opts.budgetMs > 0 ? opts.budgetMs : Infinity,
      dutyCycle: opts.dutyCycle,
      ttMax: opts.ttMax,
    });
    const said = quality.findings.map((f) => f.text).join(' ');
    if (quality.findings.some((f) => f.side === 'reply')) {
      verdict = 'weak_reply';
      detail = `The opponent's play is not optimal. ${said}`;
    } else if (quality.findings.some((f) => f.side === 'move')) {
      verdict = 'slow_move';
      detail = `The solver's line is not optimal. ${said}`;
    } else if (!r.unique) {
      const extra = steps.find((s) => s.count > 1);
      verdict = 'not_unique';
      detail = `More than one solution: at move ${extra.step}, ${extra.count} different moves force ${label}`
        + (extra.moves.length ? ` (${extra.moves.join('; ')}${extra.count > extra.moves.length ? ', ...' : ''})` : '')
        + '.';
    } else {
      verdict = 'unique';
      detail = `One solution: at every one of the ${r.solverMoves} moves, exactly one move forces ${label} against every defense, `
        + 'and every reply in the line is the opponent\'s best.';
    }
    if (!quality.complete) detail += ' (The check of each move\'s quality stopped before it finished.)';
  }
  return {
    verdict, detail, complete: r.complete, supported: r.supported,
    solverMoves: r.solverMoves, steps, nodes: r.nodes, ms: r.ms,
    findings: quality ? quality.findings : [],
  };
}

(async () => {
  try {
    const { puzzle, gameType, opts = {}, kind = 'validate' } = workerData;
    let lastPost = 0;
    const onProgress = (p) => {
      const now = Date.now();
      if (now - lastPost < 250) return;
      lastPost = now;
      parentPort.postMessage({ type: 'progress', progress: p });
    };
    let result;
    if (kind === 'verify') {
      result = await verify(puzzle, gameType, opts, onProgress);
    } else {
      const { validatePuzzle } = require('./puzzle-validation');
      result = await validatePuzzle(puzzle, gameType, { ...opts, deepLines: true, onProgress });
    }
    parentPort.postMessage({ type: 'result', result });
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: err.message });
  }
})();
