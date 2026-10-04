/*
 * Guest seats in anonymous games belong to whoever holds the seat's token.
 *
 * getGameState used to hand a disconnected guest's seat to the first signed-out
 * socket that asked for the game, and every game state sent to the room carried
 * each guest's rejoin token - so a spectator could take a seat either way.
 *
 * Run against a local dev backend (never production):
 *   TEST_SERVER_URL=http://localhost:3001 node scripts/e2e/anon-seat-e2e.js
 * GAME_TYPE_ID picks a chess-like game type with pawns on ranks 2 and 7 (default 17).
 */
const { wait, connect, once, never, makeGameActive, resign, run } = require('./lib/harness');

const GAME_TYPE_ID = Number(process.env.GAME_TYPE_ID || 17);

const forGame = (gameId) => (p) => String(p?.gameId ?? p?.id) === String(gameId);

/** Every event payload a socket receives, as JSON, for leak checks. */
function recordAll(sock) {
  const seen = [];
  sock.onAny((event, ...args) => { seen.push(`${event} ${JSON.stringify(args)}`); });
  return seen;
}

/** Two guests in a live anonymous game, with a spectator watching from the start. */
async function guestGame(ctx) {
  const hostSock = await connect(null);
  const joinSock = await connect(null);
  const spectator = await connect(null);
  ctx.onCleanup(() => { hostSock.close(); joinSock.close(); spectator.close(); });

  const createdP = once(hostSock, 'gameCreated', null, 10000);
  hostSock.emit('createAnonymousGame', {
    gameTypeId: GAME_TYPE_ID, timeControl: 10, increment: 0, guestName: 'Host Guest', allowSpectators: true,
  });
  const created = await createdP;
  if (!created.token) throw new Error('createAnonymousGame returned no token for the host');

  const spectatorSeen = recordAll(spectator);
  spectator.emit('spectateGame', { gameId: created.gameId, anonymous: true });
  await once(spectator, 'gameState', forGame(created.gameId), 5000, 'spectator gameState');

  const credsP = once(joinSock, 'anonCorresCredentials', forGame(created.gameId), 10000);
  const joinedP = once(joinSock, 'playerJoined', forGame(created.gameId), 10000);
  joinSock.emit('joinByInviteCode', { inviteCode: created.inviteCode, guestName: 'Join Guest' });
  const [creds, joined] = await Promise.all([credsP, joinedP]);

  const positions = {};
  (joined.gameState?.players || []).forEach((p) => { positions[p.position] = p.id; });
  const game = {
    gameId: created.gameId,
    state: joined.gameState,
    positions,
    hostId: created.playerId,
    hostToken: created.token,
    joinerId: creds.playerId,
    joinerToken: creds.token,
    hostSock, joinSock, spectator, spectatorSeen,
    sockForUser: (id) => (id === created.playerId ? hostSock : joinSock),
  };
  ctx.onCleanup(async () => {
    await resign(hostSock, game.gameId, game.hostId);
    await resign(joinSock, game.gameId, game.joinerId);
  });
  return game;
}

/**
 * A guest closes its tab; resolves once the server has seen the socket go.
 * The host holds the first guest seat - the one the old remap handed out.
 */
async function guestLeaves(game, who) {
  const sock = who === 'host' ? game.hostSock : game.joinSock;
  sock.emit('clientClosing');
  await wait(100);
  sock.close();
  await wait(600);
}

async function stateFor(sock, gameId) {
  const p = once(sock, 'gameState', forGame(gameId), 5000, 'gameState');
  sock.emit('getGameState', { gameId });
  return p;
}

const checks = [
  {
    name: 'no guest token reaches a spectator, in any event',
    fn: async (ctx) => {
      const game = await guestGame(ctx);
      await makeGameActive(game);
      await stateFor(game.spectator, game.gameId);
      if (!game.spectatorSeen.length) throw new Error('spectator received nothing - the check proved nothing');
      const leaked = game.spectatorSeen.filter((line) =>
        line.includes(game.hostToken) || line.includes(game.joinerToken));
      if (leaked.length) throw new Error(`token in: ${leaked.map((l) => l.slice(0, 40)).join(' | ')}`);
    },
  },
  ...['host', 'joiner'].map((who) => ({
    name: `a signed-out visitor does not get a disconnected guest's seat (${who} left)`,
    fn: async (ctx) => {
      const game = await guestGame(ctx);
      await makeGameActive(game);
      await guestLeaves(game, who);
      const seatId = who === 'host' ? game.hostId : game.joinerId;

      const thief = await connect(null);
      ctx.onCleanup(() => thief.close());
      const state = await stateFor(thief, game.gameId);
      const ids = (state.players || []).map((p) => p.id);
      if (!ids.includes(seatId)) throw new Error(`the ${who}'s seat was renamed: players ${JSON.stringify(ids)}`);
      if (ids.includes(`anon_${thief.id}`)) throw new Error('the visitor was given a seat');

      // Nor can it act for the seat by naming it.
      const over = never(thief, 'gameOver', forGame(game.gameId), 1500, 'gameOver');
      thief.emit('resign', { gameId: game.gameId, userId: seatId });
      await over;
    },
  })),
  {
    name: 'only a player in the game can pause or restart the forfeit countdown',
    fn: async (ctx) => {
      const game = await guestGame(ctx);
      await makeGameActive(game);
      // A guest seated in some other game, so the server holds an id for it.
      const outsider = (await guestGame(ctx)).hostSock;
      await guestLeaves(game, 'joiner');
      await wait(5500); // the explicit-close grace period, before the countdown shows

      const sameGame = forGame(game.gameId);
      for (const sock of [game.spectator, outsider]) {
        const noPause = never(game.hostSock, 'disconnectTimerPaused', sameGame, 1200, 'disconnectTimerPaused');
        sock.emit('pauseDisconnectTimer', { gameId: game.gameId });
        await noPause;
      }
      const paused = once(game.hostSock, 'disconnectTimerPaused', sameGame, 3000);
      game.hostSock.emit('pauseDisconnectTimer', { gameId: game.gameId });
      await paused;

      for (const sock of [game.spectator, outsider]) {
        const noResume = never(game.hostSock, 'disconnectTimerResumed', sameGame, 1200, 'disconnectTimerResumed');
        sock.emit('resumeDisconnectTimer', { gameId: game.gameId });
        await noResume;
      }
      const resumed = once(game.hostSock, 'disconnectTimerResumed', sameGame, 3000);
      game.hostSock.emit('resumeDisconnectTimer', { gameId: game.gameId });
      await resumed;
    },
  },
  {
    name: 'the guest who left gets its seat back with its token, and can play it',
    fn: async (ctx) => {
      const game = await guestGame(ctx);
      await makeGameActive(game);
      await guestLeaves(game, 'host');

      // A visitor asks first; the seat must still be there for its owner.
      const thief = await connect(null);
      ctx.onCleanup(() => thief.close());
      await stateFor(thief, game.gameId);

      const back = await connect(null);
      ctx.onCleanup(() => back.close());
      const authP = once(back, 'anonCorresAuthSuccess', forGame(game.gameId), 5000);
      back.emit('authenticateAnonCorresPlayer', { gameId: game.gameId, token: game.hostToken });
      const auth = await authP;
      if (auth.playerId !== game.hostId) throw new Error(`token proved ${auth.playerId}, expected ${game.hostId}`);

      const state = await stateFor(back, game.gameId);
      if (!(state.players || []).some((p) => p.id === game.hostId)) throw new Error('seat missing after rejoin');

      const over = once(game.joinSock, 'gameOver', forGame(game.gameId), 4000, 'gameOver');
      back.emit('resign', { gameId: game.gameId, userId: game.hostId });
      const result = await over;
      if (String(result.winner) !== String(game.joinerId)) throw new Error(`winner ${result.winner}, expected the joiner`);
    },
  },
];

run('Guest seats belong to their token', checks).then((ok) => process.exit(ok ? 0 : 1));
