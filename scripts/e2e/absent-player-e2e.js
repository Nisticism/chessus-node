/*
 * A player who left BEFORE the game started must still be put on a disconnect
 * clock once it starts.
 *
 * The forfeit timer used to be armed only from the socket 'disconnect' handler,
 * and only while the game was already in progress. Someone who opened a game
 * and walked away was therefore treated as present for ever - nothing had ever
 * observed them leaving *during* a game - so the opponent who actually turned
 * up was the only player who could be forfeited, and lost to an empty seat on
 * their first network blip.
 *
 * Game 2610 in production: a guest opened an invite game at 21:45 and left.
 * Someone joined at 00:19, made a move, dropped about thirty seconds later, and
 * lost by disconnect to an opponent who had not been connected for two and a
 * half hours.
 *
 * Start a backend with the test hooks on, on a spare port:
 *
 *   bash:        ENABLE_TEST_HOOKS=1 PORT=3002 node server/index.js
 *   PowerShell:  $env:ENABLE_TEST_HOOKS=1; $env:PORT=3002; node server/index.js
 *
 * then:
 *
 *   TEST_SERVER_URL=http://localhost:3002 node scripts/e2e/absent-player-e2e.js
 */
const { wait, connect, once, createHumanGame, makeGameActive, resign, run } = require('./lib/harness');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10);
const P1 = { id: parseInt(process.env.TEST_P1_ID || '40', 10), name: process.env.TEST_P1_NAME || 'Nisticism' };
const P2 = { id: parseInt(process.env.TEST_P2_ID || '48', 10), name: process.env.TEST_P2_NAME || 'InferiorGrandmaster' };

/* The harness signals failure by throwing, so this is the whole assert layer. */
const check = (ok, what, detail) => {
  if (!ok) throw new Error(`${what}${detail ? ` - ${detail}` : ''}`);
};

const ask = (sock, event, payload, ms = 5000) =>
  new Promise((resolve, reject) => {
    const to = setTimeout(
      () => reject(new Error(`no ack for ${event} - is the backend running with ENABLE_TEST_HOOKS=1?`)), ms);
    sock.emit(event, payload, (res) => { clearTimeout(to); resolve(res); });
  });

run('absent player', [
  {
    name: 'a player who left before the game started is put on a clock when it starts',
    async fn() {
      const hostSock = await connect(P1);
      const joinSock = await connect(P2);
      let game;
      try {
        game = await createHumanGame({
          hostSock, joinSock, host: P1, joiner: P2,
          gameTypeId: GAME_TYPE_ID, timeControl: 10, increment: 0,
        });

        // The joiner walks away while the game is still waiting to start. This
        // is the case that used to go unnoticed: nothing arms a timer here,
        // because the game is not in progress yet - and that is correct.
        joinSock.close();
        await wait(600);

        const beforeStart = await ask(hostSock, '__test:inspect', { gameId: game.gameId });
        check(beforeStart.ok === false || (beforeStart.disconnectTimers || []).length === 0,
          'no timer should be armed while the game has not started',
          JSON.stringify(beforeStart.disconnectTimers || []));

        // The player who DID turn up moves, which starts the game.
        await makeGameActive(game, { boardHeight: 8 });
        await wait(600);

        const afterStart = await ask(hostSock, '__test:inspect', { gameId: game.gameId });
        check(afterStart.ok === true, 'the game is active and inspectable', JSON.stringify(afterStart));

        const timers = afterStart.disconnectTimers || [];
        const forAbsent = timers.filter((x) => String(x.userId) === String(P2.id));
        check(forAbsent.length === 1,
          'the absent player is now on a disconnect clock',
          `timers: ${JSON.stringify(timers)}`);

        // The player who is actually here must not be on one.
        const forPresent = timers.filter((x) => String(x.userId) === String(P1.id));
        check(forPresent.length === 0,
          'the player who is present is not put on a clock',
          `timers: ${JSON.stringify(timers)}`);

        // Armed with the long grace, not the short one: this is an inference
        // about presence, not an observed close, so a player still loading the
        // page gets the benefit of it.
        check(forAbsent[0] && forAbsent[0].gracePending === true,
          'it starts in the grace period rather than announcing a disconnect immediately',
          JSON.stringify(forAbsent[0]));
      } finally {
        if (game) await resign(hostSock, game.gameId, P1.id).catch(() => {});
        hostSock.close();
        joinSock.close();
      }
    },
  },

  {
    name: 'a player who comes back clears the clock',
    async fn() {
      const hostSock = await connect(P1);
      let joinSock = await connect(P2);
      let game;
      try {
        game = await createHumanGame({
          hostSock, joinSock, host: P1, joiner: P2,
          gameTypeId: GAME_TYPE_ID, timeControl: 10, increment: 0,
        });

        joinSock.close();
        await wait(400);
        await makeGameActive(game, { boardHeight: 8 });
        await wait(600);

        const armed = await ask(hostSock, '__test:inspect', { gameId: game.gameId });
        check((armed.disconnectTimers || []).some((x) => String(x.userId) === String(P2.id)),
          'the absent player is on a clock to begin with',
          JSON.stringify(armed.disconnectTimers || []));

        // They turn up after all.
        joinSock = await connect(P2);
        const rejoined = once(joinSock, 'playerJoined', (p) => String(p.gameId) === String(game.gameId), 8000)
          .catch(() => null);
        joinSock.emit('joinGame', { gameId: game.gameId, userId: P2.id, username: P2.name });
        await rejoined;
        await wait(800);

        const after = await ask(hostSock, '__test:inspect', { gameId: game.gameId });
        check(!(after.disconnectTimers || []).some((x) => String(x.userId) === String(P2.id)),
          'coming back clears it',
          JSON.stringify(after.disconnectTimers || []));
      } finally {
        if (game) await resign(hostSock, game.gameId, P1.id).catch(() => {});
        hostSock.close();
        if (joinSock) joinSock.close();
      }
    },
  },
]);
