/*
 * Runs a puzzle check off the main thread (see puzzle-jobs.js).
 *
 * A deep search is pure computation: run on the web server's own thread it
 * would freeze every request for as long as it took. Here it has a thread of
 * its own, a memory cap set by the job manager, and a CPU duty cycle (the
 * search pauses between slices of work) so the site keeps its share.
 *
 * workerData: { kind: 'validate', puzzle, gameType, opts }
 *   puzzle and gameType arrive already hydrated by the caller, so this needs
 *   nothing but the engine.
 * Posts { type: 'progress', progress } (throttled), then { type: 'result', result }
 * or { type: 'error', message }.
 */
const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const { validatePuzzle } = require('./puzzle-validation');
    const { puzzle, gameType, opts = {} } = workerData;
    let lastPost = 0;
    const onProgress = (p) => {
      const now = Date.now();
      if (now - lastPost < 250) return;
      lastPost = now;
      parentPort.postMessage({ type: 'progress', progress: p });
    };
    const result = await validatePuzzle(puzzle, gameType, { ...opts, deepLines: true, onProgress });
    parentPort.postMessage({ type: 'result', result });
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: err.message });
  }
})();
