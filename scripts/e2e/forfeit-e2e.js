/*
 * Disconnect / forfeit end-to-end suite.
 *
 * Covers the rule that a player is only "gone" once every window they have open
 * is closed - which is hard to test any other way, since bot games are exempt
 * from forfeit so both sides have to be driven at once.
 *
 * Start a backend with the test hooks on - on a spare port, so it can run
 * alongside the normal dev server without fighting it for 3001:
 *
 *   bash:        ENABLE_TEST_HOOKS=1 PORT=3002 node server/index.js
 *   PowerShell:  $env:ENABLE_TEST_HOOKS=1; $env:PORT=3002; node server/index.js
 *
 * then point the suite at it:
 *
 *   bash:        TEST_SERVER_URL=http://localhost:3002 node scripts/e2e/forfeit-e2e.js
 *   PowerShell:  $env:TEST_SERVER_URL='http://localhost:3002'; node scripts/e2e/forfeit-e2e.js
 *
 * Add RUN_SLOW=1 to include the ~21s real-forfeit check.
 *
 * Needs two real user rows; override with TEST_P1_ID / TEST_P2_ID. The host must
 * be under the live-game cap (8), so a previous crashed run can block this one -
 * the suite resigns what it creates, but a hard kill will leave games behind.
 */
const { wait, connect, once, never, createHumanGame, makeGameActive, resign, run } = require('./lib/harness');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10); // Capablanca 10x8
const P1 = { id: parseInt(process.env.TEST_P1_ID || '40', 10), name: process.env.TEST_P1_NAME || 'Nisticism' };
const P2 = { id: parseInt(process.env.TEST_P2_ID || '48', 10), name: process.env.TEST_P2_NAME || 'InferiorGrandmaster' };

// Must match EXPLICIT_CLOSE_GRACE_MS / UNEXPLAINED_DROP_GRACE_MS in game-socket.js.
const EXPLICIT_CLOSE_GRACE_MS = 5000;
const UNEXPLAINED_DROP_GRACE_MS = 45000;

const ask = (sock, event, payload, ms = 5000) =>
  new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`no ack for ${event} - is the backend running with ENABLE_TEST_HOOKS=1?`)), ms);
    sock.emit(event, payload, (res) => { clearTimeout(to); resolve(res); });
  });

/**
 * Stand up a fresh ACTIVE game with both players connected.
 *
 * timeControl is in MINUTES. The game is played into 'active' and that is then
 * asserted, because every disconnect rule is gated on it - without the check, a
 * "nothing was announced" test passes whether the code works or not.
 */
async function setupGame(ctx, { timeControl = 10 } = {}) {
  const a = await connect(P1);
  const b = await connect(P2);
  ctx.onCleanup(() => { try { a.close(); } catch (_) {} });
  ctx.onCleanup(() => { try { b.close(); } catch (_) {} });

  const game = await createHumanGame({
    hostSock: a, joinSock: b, host: P1, joiner: P2, gameTypeId: GAME_TYPE_ID, timeControl,
  });
  ctx.onCleanup(() => resign(a, game.gameId, P1.id));

  await makeGameActive(game);
  const state = await ask(a, '__test:inspect', { gameId: game.gameId });
  if (!state.ok) throw new Error(state.error);
  if (state.status !== 'active') {
    throw new Error(`precondition failed: game is '${state.status}', not 'active' - disconnect rules would not apply`);
  }
  // The activating move handed the turn over, so read whose it is now from the
  // server rather than from the pre-move join payload.
  return { a, b, ...game, currentTurn: state.currentTurn };
}

const checks = [
  {
    // The bug that started this: closing one tab looked like closing them all.
    name: 'a second tab keeps you present when the first one closes',
    fn: async (ctx) => {
      const { a, b, gameId } = await setupGame(ctx);

      // P1 opens the site in a second tab, then closes the first.
      const a2 = await connect(P1);
      ctx.onCleanup(() => { try { a2.close(); } catch (_) {} });
      a.close();

      // The opponent must never be told anything - not even after the short grace.
      await never(b, 'opponentDisconnected', (p) => String(p.gameId) === String(gameId),
        EXPLICIT_CLOSE_GRACE_MS + 3000, 'opponentDisconnected');

      const state = await ask(a2, '__test:inspect', { gameId });
      if (!state.ok) throw new Error(state.error);
      if (state.disconnectTimers.length) {
        throw new Error(`expected no disconnect timers, got ${JSON.stringify(state.disconnectTimers)}`);
      }
    },
  },
  {
    // Navigating to another page unmounts LiveGame and fires leaveGame.
    name: 'leaving the game page does not arm a forfeit timer',
    fn: async (ctx) => {
      const { a, b, gameId } = await setupGame(ctx);

      a.emit('leaveGame', { gameId });
      await never(b, 'opponentDisconnected', (p) => String(p.gameId) === String(gameId),
        EXPLICIT_CLOSE_GRACE_MS + 3000, 'opponentDisconnected');

      const state = await ask(b, '__test:inspect', { gameId });
      if (state.disconnectTimers.length) {
        throw new Error(`leaveGame armed a timer: ${JSON.stringify(state.disconnectTimers)}`);
      }
    },
  },
  {
    name: 'a deliberate close tells the opponent after the short grace',
    fn: async (ctx) => {
      const { a, b, gameId } = await setupGame(ctx);

      const announced = once(b, 'opponentDisconnected', (p) => String(p.gameId) === String(gameId),
        EXPLICIT_CLOSE_GRACE_MS + 6000, 'opponentDisconnected');
      a.emit('clientClosing');
      await wait(150); // let it land before the socket goes
      a.close();

      const started = Date.now();
      const payload = await announced;
      const elapsed = Date.now() - started;
      if (payload.userId !== P1.id) throw new Error(`announced the wrong player: ${payload.userId}`);
      if (elapsed < EXPLICIT_CLOSE_GRACE_MS - 1500) {
        throw new Error(`announced after only ${elapsed}ms, expected ~${EXPLICIT_CLOSE_GRACE_MS}ms`);
      }
    },
  },
  {
    // Backgrounding on a phone drops the socket without a pagehide.
    name: 'an unexplained drop stays silent through the short grace',
    fn: async (ctx) => {
      const { a, b, gameId } = await setupGame(ctx);

      a.close(); // no clientClosing - this is a suspend, not a close

      // Silent well past the deliberate-close grace...
      await never(b, 'opponentDisconnected', (p) => String(p.gameId) === String(gameId),
        EXPLICIT_CLOSE_GRACE_MS + 5000, 'opponentDisconnected');

      // ...but a timer is armed and still counting down toward announcing.
      const state = await ask(b, '__test:inspect', { gameId });
      const mine = state.disconnectTimers.find((t) => t.userId === P1.id);
      if (!mine) throw new Error('expected an armed (but silent) timer for the dropped player');
      if (!mine.gracePending) throw new Error('timer should still be inside its grace period');
    },
  },
  {
    name: 'coming back during the silent grace cancels it with nothing announced',
    fn: async (ctx) => {
      const { a, b, gameId } = await setupGame(ctx);

      a.close();
      await wait(2000);
      const a2 = await connect(P1); // reconnect, as the client does automatically
      ctx.onCleanup(() => { try { a2.close(); } catch (_) {} });

      await never(b, 'opponentDisconnected', (p) => String(p.gameId) === String(gameId),
        EXPLICIT_CLOSE_GRACE_MS + 3000, 'opponentDisconnected');

      const state = await ask(a2, '__test:inspect', { gameId });
      if (state.disconnectTimers.length) {
        throw new Error(`reconnect left a timer behind: ${JSON.stringify(state.disconnectTimers)}`);
      }
    },
  },
  {
    // The clock hook exists so this does not take 10 minutes of wall clock.
    name: 'a clock nudged to the edge flags for real',
    fn: async (ctx) => {
      const { a, b, gameId, positions, currentTurn } = await setupGame(ctx, { timeControl: 10 });

      // Only the player on move has a running clock, so nudge theirs.
      const moverId = positions[currentTurn];
      const moverSock = moverId === P1.id ? a : b;
      const otherSock = moverId === P1.id ? b : a;

      const set = await ask(moverSock, '__test:setClock', { gameId, userId: moverId, seconds: 1.5 });
      if (!set.ok) throw new Error(set.error);

      const over = await once(otherSock, 'gameOver', (p) => String(p.gameId) === String(gameId), 15000, 'gameOver');
      if (over.reason !== 'timeout') throw new Error(`ended for the wrong reason: ${over.reason}`);
      if (over.winner === moverId) throw new Error('the player who flagged was declared the winner');
    },
  },
  {
    name: 'the forfeit actually lands once the countdown expires',
    // The forfeit duration for a 10-minute game is 15s, plus the announce grace on
    // top of it. A deliberate close announces after 5s, then forfeits 15s later.
    skip: process.env.RUN_SLOW === '1' ? null : 'slow (~25s) - set RUN_SLOW=1 to include',
    fn: async (ctx) => {
      const { a, b, gameId } = await setupGame(ctx);

      const ended = once(b, 'gameOver', (p) => String(p.gameId) === String(gameId), 120000, 'gameOver');
      a.emit('clientClosing');
      await wait(150);
      a.close();

      const over = await ended;
      if (over.reason !== 'disconnect') throw new Error(`ended for the wrong reason: ${over.reason}`);
      if (over.winner !== P2.id) throw new Error(`wrong winner: ${over.winner}`);
    },
  },
];

run('Disconnect / forfeit e2e', checks).then((ok) => process.exit(ok ? 0 : 1));
