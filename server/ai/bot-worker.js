'use strict';
/**
 * Bot worker thread — runs the minimax computation off the main event loop.
 *
 * Receiving a structured-cloned gameState snapshot via workerData, this
 * worker calls ai-engine.getBestMove and posts the result back.  Because
 * this runs in a separate Worker thread the main thread's event loop stays
 * free during computation, so socket events (e.g. getGameState from a
 * refreshing player) are processed normally instead of stalling.
 *
 * NOTE: ai-engine.js lazily requires game-socket.js to get the pure
 * move-generation functions.  Loading game-socket.js here creates a MySQL
 * connection-pool object via configs/db.js, but mysql2 pools are LAZY —
 * no actual DB connections are established until a query is run.  Since
 * this worker only calls pure (non-DB) functions, no connections are made
 * and the pool is discarded when the worker exits.
 */
const { workerData, parentPort } = require('worker_threads');
const aiEngine = require('./ai-engine');

const { gameState, botPosition, difficulty } = workerData;

try {
  // getBestMove returns the move synchronously for easy/medium/hard and as
  // a Promise for adaptive (which may consult the opening book via async
  // file/http reads).  Promise.resolve() handles both cases uniformly.
  Promise.resolve(aiEngine.getBestMove(gameState, botPosition, difficulty))
    .then(move => parentPort.postMessage({ move }))
    .catch(err => parentPort.postMessage({ error: err.message || String(err) }));
} catch (err) {
  parentPort.postMessage({ error: err.message || String(err) });
}
