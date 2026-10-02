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
  const { playLine, describeMoveOn, buildGameState, boardMoveKey, GOAL_DEFS } = require('./puzzle-validation');
  const line = Array.isArray(puzzle.solution_line) ? puzzle.solution_line : [];
  const r = await verifyPuzzleLine(puzzle, gameType, line, {
    aim: puzzle.goal,
    budgetMs: Number.isFinite(opts.budgetMs) && opts.budgetMs > 0 ? opts.budgetMs : Infinity,
    dutyCycle: opts.dutyCycle,
    ttMax: opts.ttMax,
    onProgress,
  });
  const label = (GOAL_DEFS[puzzle.goal]?.label || puzzle.goal || 'the goal').toLowerCase();
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
      const k = boardMoveKey(m);
      if (seen.has(k)) continue;
      seen.add(k);
      if (named.length < 6) named.push(describeMoveOn(pieces, gameType, m));
    }
    steps.push({ step: st.step, depth: st.depth, count: st.count, lineIncluded: st.lineIncluded, moves: named });
  }

  let verdict = null;
  let detail;
  if (!r.supported) {
    detail = `This puzzle cannot be searched: ${r.reason}.`;
  } else if (!r.complete) {
    detail = r.reason ? `The search stopped: ${r.reason}.` : 'The search stopped before it finished.';
  } else if (!r.lineForces) {
    const broken = steps.find((s) => !s.lineIncluded);
    verdict = 'not_forced';
    detail = `The line is not forced: at move ${broken.step} the opponent has a defence the line does not play, `
      + `so the line's move does not force '${label}' in the moves left.`;
  } else if (!r.unique) {
    const extra = steps.find((s) => s.count > 1);
    verdict = 'not_unique';
    detail = `More than one solution: at move ${extra.step}, ${extra.count} different moves force '${label}'`
      + (extra.moves.length ? ` (${extra.moves.join('; ')}${extra.count > extra.moves.length ? ', ...' : ''})` : '')
      + '.';
  } else {
    verdict = 'unique';
    detail = `One solution: at every one of the ${r.solverMoves} moves, exactly one move forces '${label}' against every defence.`;
  }
  return {
    verdict, detail, complete: r.complete, supported: r.supported,
    solverMoves: r.solverMoves, steps, nodes: r.nodes, ms: r.ms,
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
