/*
 * Shared plumbing for server-protocol end-to-end tests.
 *
 * These drive real socket.io clients against a running dev backend, so they
 * exercise the actual handlers rather than a reimplementation of them. Extracted
 * from veto-e2e.js, which had all of this inline.
 *
 * Nothing here needs a browser or a test framework - a suite is just a node
 * script that calls run() with a list of named async checks.
 */
// socket.io-client lives in the frontend's node_modules, not the repo root, so
// resolve it from either. (veto-e2e.js assumed the root and could not run.)
const path = require('path');
function requireSocketClient() {
  try { return require('socket.io-client'); } catch (_) { /* try the frontend */ }
  const fromFrontend = path.join(__dirname, '..', '..', '..', 'chessus-frontend', 'node_modules', 'socket.io-client');
  try { return require(fromFrontend); } catch (_) {
    throw new Error("socket.io-client not found in the repo root or chessus-frontend/node_modules");
  }
}
const { io } = requireSocketClient();

const URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connect a socket and authenticate it as `user`. Resolves once the server has
 * had a moment to process the auth - there is no ack for it, so a short settle
 * is the honest option.
 */
function connect(user, { authenticate = true, settleMs = 400 } = {}) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    const to = setTimeout(() => reject(new Error(`connect timeout for ${user?.name || 'anon'}`)), 8000);
    s.on('connect', async () => {
      clearTimeout(to);
      if (authenticate && user) s.emit('authenticate', { userId: user.id, username: user.name });
      await wait(settleMs);
      resolve(s);
    });
    s.on('connect_error', (e) => { clearTimeout(to); reject(e); });
  });
}

/** Await one event matching `pred`, or reject on timeout. */
function once(sock, event, pred, ms = 8000, label = event) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { sock.off(event, handler); reject(new Error(`timeout waiting for ${label}`)); }, ms);
    function handler(payload) {
      if (!pred || pred(payload)) { clearTimeout(to); sock.off(event, handler); resolve(payload); }
    }
    sock.on(event, handler);
  });
}

/**
 * Assert an event does NOT arrive within `ms`. The other half of once(), and the
 * one that matters for disconnect work: most of these tests are about the
 * opponent NOT being told anything.
 */
function never(sock, event, pred, ms, label = event) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { sock.off(event, handler); resolve(); }, ms);
    function handler(payload) {
      if (!pred || pred(payload)) {
        clearTimeout(to);
        sock.off(event, handler);
        reject(new Error(`expected no ${label} within ${ms}ms, but got ${JSON.stringify(payload).slice(0, 200)}`));
      }
    }
    sock.on(event, handler);
  });
}

/**
 * Host a human-vs-human game and have the second player join it.
 * Returns the game id, a position -> playerId map, and a socket lookup.
 */
async function createHumanGame({ hostSock, joinSock, host, joiner, gameTypeId, timeControl = 600, increment = 0 }) {
  const createdP = once(hostSock, 'gameCreated', null, 10000, 'gameCreated');
  hostSock.emit('createGame', {
    gameTypeId, timeControl, increment,
    hostId: host.id, hostUsername: host.name, vsComputer: false,
    allowSpectators: true, allowPremoves: true, playerSide: 'p1',
  });
  const { gameId } = await createdP;

  const joinedP = once(joinSock, 'playerJoined', (p) => p.gameId === gameId, 10000, 'playerJoined');
  joinSock.emit('joinGame', { gameId, userId: joiner.id, username: joiner.name });
  const joined = await joinedP;

  const positions = {};
  (joined.gameState?.players || []).forEach((p) => { positions[p.position] = p.id; });

  return {
    gameId,
    state: joined.gameState,
    positions,
    sockFor: (pos) => (positions[pos] === host.id ? hostSock : joinSock),
    sockForUser: (userId) => (userId === host.id ? hostSock : joinSock),
  };
}

/**
 * Play one legal pawn push so the game leaves 'ready' and becomes 'active'.
 *
 * This matters more than it looks: nearly everything about disconnects is gated
 * on the game being active, so a suite that skips this can watch for events that
 * were never going to fire and call the silence a pass.
 */
async function makeGameActive(game, { boardHeight = 8 } = {}) {
  const mover = game.state.currentTurn || 1;
  const moverId = game.positions[mover];
  const sock = game.sockForUser(moverId);
  const pieces = game.state.pieces || [];

  // Pawns sit on the rank in front of the back rank, and push toward the middle.
  const homeRank = mover === 1 ? boardHeight - 2 : 1;
  const dir = mover === 1 ? -1 : 1;
  const candidates = pieces.filter(
    (p) => (p.player_id ?? p.team) === mover && p.y === homeRank
  );
  if (!candidates.length) throw new Error(`no pawns found for position ${mover} on rank ${homeRank}`);

  let lastErr = null;
  for (const piece of candidates) {
    const moved = once(sock, 'moveMade', (p) => String(p.gameId) === String(game.gameId), 5000)
      .catch((e) => ({ __err: e.message }));
    sock.emit('makeMove', {
      gameId: game.gameId,
      userId: moverId,
      move: { from: { x: piece.x, y: piece.y }, to: { x: piece.x, y: piece.y + dir }, pieceId: piece.id },
    });
    const res = await moved;
    if (!res.__err) return res.gameState || game.state;
    lastErr = res.__err;
  }
  throw new Error(`could not make the game active: ${lastErr}`);
}

/**
 * Close a game so it stops counting against the host's live-game cap.
 *
 * Awaited on purpose: a bare emit followed by socket.close() often never
 * flushes, and abandoned games accumulate until createGame starts failing with
 * LIMIT_EXCEEDED - which surfaces as a confusing 'timeout waiting for
 * gameCreated' several tests later.
 */
async function resign(sock, gameId, userId, { waitMs = 2500 } = {}) {
  try {
    const done = once(sock, 'gameOver', (p) => String(p.gameId) === String(gameId), waitMs, 'gameOver(resign)')
      .catch(() => null);
    sock.emit('resign', { gameId, userId });
    await done;
  } catch (_) { /* best effort - cleanup must never fail a suite */ }
}

/**
 * Run named checks in sequence, printing a PASS/FAIL line each. Each check gets
 * a fresh context object it can stash sockets on for cleanup.
 */
async function run(suiteName, checks) {
  console.log(`\n=== ${suiteName} ===`);
  console.log(`server: ${URL}\n`);
  let passed = 0;
  const failures = [];

  for (const { name, fn, skip } of checks) {
    if (skip) { console.log(`SKIP  ${name}\n      ${skip}`); continue; }
    const cleanups = [];
    const ctx = { onCleanup: (f) => cleanups.push(f) };
    const started = Date.now();
    try {
      await fn(ctx);
      console.log(`PASS  ${name}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      passed++;
    } catch (err) {
      console.log(`FAIL  ${name}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      console.log(`      ${err.message}`);
      failures.push({ name, message: err.message });
    } finally {
      for (const f of cleanups.reverse()) { try { await f(); } catch (_) { /* ignore */ } }
    }
  }

  const total = passed + failures.length;
  console.log(`\n${passed}/${total} passed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
  }
  return failures.length === 0;
}

module.exports = { URL, wait, connect, once, never, createHumanGame, makeGameActive, resign, run };
