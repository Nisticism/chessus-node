/*
 * A finished game stays finished.
 *
 * Completed games linger in activeGames, and resign used to re-run the whole
 * ending on one: a second resign (from either side) could flip the recorded
 * winner and applied Elo again, so a loser resigning over and over farmed
 * rating for the winner. These checks finish a RATED game between two real
 * users and then try every way back in - resign from each side, accepting a
 * draw offer that outlived the game, a move, and two resigns at once - and
 * confirm that the winner, games.winner_id and both users' Elo do not move.
 *
 * Local database only (it reads users.elo and games directly). Start a backend
 * with the test hooks on, on a spare port:
 *
 *   ENABLE_TEST_HOOKS=1 PORT=3011 node -r dotenv/config server/index.js dotenv_config_path=<checkout>/.env
 *
 * then, with NODE_PATH reaching socket.io-client, mysql2 and dotenv:
 *
 *   TEST_SERVER_URL=http://localhost:3011 node scripts/e2e/game-over-e2e.js
 *
 * Uses the e2e fixture users (scripts/e2e/fixtures.sql); override with
 * TEST_P1_ID / TEST_P2_ID. Their Elo changes once per game, as any rated game
 * would change it.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { connect, once, never, createHumanGame, makeGameActive, resign, run, wait } = require('./lib/harness');
const db_pool = require('../../configs/db');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '17', 10); // Chess
const P1 = { id: parseInt(process.env.TEST_P1_ID || '534', 10), name: process.env.TEST_P1_NAME || 'e2e_silver' };
const P2 = { id: parseInt(process.env.TEST_P2_ID || '535', 10), name: process.env.TEST_P2_NAME || 'e2e_gold' };

// Long enough for a re-run ending to have reached the database.
const SETTLE_MS = 1500;

const ask = (sock, event, payload, ms = 5000) =>
  new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`no ack for ${event} - is the backend running with ENABLE_TEST_HOOKS=1?`)), ms);
    sock.emit(event, payload, (res) => { clearTimeout(to); resolve(res); });
  });

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function elos() {
  const [rows] = await db_pool.query('SELECT id, elo FROM users WHERE id IN (?, ?)', [P1.id, P2.id]);
  const out = {};
  for (const r of rows) out[r.id] = r.elo;
  return out;
}

async function gameRow(gameId) {
  const [[row]] = await db_pool.query('SELECT status, winner_id, end_time, other_data FROM games WHERE id = ?', [gameId]);
  const od = typeof row.other_data === 'string' ? JSON.parse(row.other_data) : (row.other_data || {});
  return { status: row.status, winnerId: row.winner_id, endTime: row.end_time, winner: od.winner, reason: od.reason, eloChanges: od.eloChanges };
}

/** A rated, active game with both players connected. */
async function setupGame(ctx) {
  const a = await connect(P1);
  const b = await connect(P2);
  ctx.onCleanup(() => { try { a.close(); } catch (_) {} });
  ctx.onCleanup(() => { try { b.close(); } catch (_) {} });
  const game = await createHumanGame({ hostSock: a, joinSock: b, host: P1, joiner: P2, gameTypeId: GAME_TYPE_ID, timeControl: 10 });
  ctx.onCleanup(() => resign(a, game.gameId, P1.id));
  await makeGameActive(game);
  const state = await ask(a, '__test:inspect', { gameId: game.gameId });
  assert(state.ok && state.status === 'active', `setup: game is ${state.status}, not active`);
  return { a, b, game };
}

/** P1 resigns; returns the ending as it was first recorded. */
async function resignOnce(a, b, gameId) {
  const overA = once(a, 'gameOver', (p) => String(p.gameId) === String(gameId), 8000, 'gameOver (first resign)');
  const overB = once(b, 'gameOver', (p) => String(p.gameId) === String(gameId), 8000, 'gameOver (first resign)');
  a.emit('resign', { gameId, userId: P1.id });
  const payload = await overA;
  await overB;
  assert(payload.winner === P2.id, `first resign: winner ${payload.winner}, expected ${P2.id}`);
  assert(payload.eloChanges, 'first resign: no eloChanges - is the game rated?');
  await wait(SETTLE_MS);
  return { row: await gameRow(gameId), elo: await elos() };
}

/** Emit `event` on `sock` and expect a refusal and no ending on either socket. */
async function expectRefused(socks, sock, event, payload) {
  const gameId = payload.gameId;
  const quiet = socks.map((s) => never(s, 'gameOver', (p) => String(p.gameId) === String(gameId), SETTLE_MS, `gameOver after ${event}`));
  const refused = once(sock, 'error', (e) => /already over/i.test(e?.message || ''), 3000, `"already over" error for ${event}`);
  sock.emit(event, payload);
  await Promise.all([refused, ...quiet]);
}

async function expectUnchanged(gameId, before, label) {
  const row = await gameRow(gameId);
  const elo = await elos();
  for (const k of ['status', 'winnerId', 'endTime', 'winner', 'reason']) {
    assert(row[k] === before.row[k], `${label}: games.${k} changed ${JSON.stringify(before.row[k])} -> ${JSON.stringify(row[k])}`);
  }
  assert(JSON.stringify(row.eloChanges) === JSON.stringify(before.row.eloChanges), `${label}: recorded eloChanges changed`);
  for (const id of [P1.id, P2.id]) {
    assert(elo[id] === before.elo[id], `${label}: user ${id} Elo changed ${before.elo[id]} -> ${elo[id]}`);
  }
}

const checks = [
  {
    name: 'resigning again from either side changes nothing',
    fn: async (ctx) => {
      const { a, b, game } = await setupGame(ctx);
      const start = await elos();
      const before = await resignOnce(a, b, game.gameId);
      assert(before.row.status === 'completed' && before.row.winnerId === P2.id, `first resign recorded ${JSON.stringify(before.row)}`);
      assert(before.elo[P2.id] > start[P2.id] && before.elo[P1.id] < start[P1.id], 'first resign did not move Elo');

      await expectRefused([a, b], a, 'resign', { gameId: game.gameId, userId: P1.id });
      await expectUnchanged(game.gameId, before, 'loser resigns again');
      await expectRefused([a, b], b, 'resign', { gameId: game.gameId, userId: P2.id });
      await expectUnchanged(game.gameId, before, 'winner resigns');
      await expectRefused([a, b], a, 'resign', { gameId: game.gameId, userId: P1.id });
      await expectUnchanged(game.gameId, before, 'loser resigns a third time');

      const live = await ask(a, '__test:inspect', { gameId: game.gameId });
      assert(live.winner === P2.id && live.winReason === 'resignation', `in-memory ending changed: ${live.winner} / ${live.winReason}`);
    },
  },
  {
    name: 'a draw offer that outlived the game cannot be accepted',
    fn: async (ctx) => {
      const { a, b, game } = await setupGame(ctx);
      const offered = once(b, 'drawOffered', (p) => String(p.gameId) === String(game.gameId), 5000);
      a.emit('offerDraw', { gameId: game.gameId });
      await offered;
      const before = await resignOnce(a, b, game.gameId);
      await expectRefused([a, b], b, 'acceptDraw', { gameId: game.gameId });
      await expectUnchanged(game.gameId, before, 'draw accepted after resign');
    },
  },
  {
    name: 'a move after the game ended is refused',
    fn: async (ctx) => {
      const { a, b, game } = await setupGame(ctx);
      const before = await resignOnce(a, b, game.gameId);
      // After makeGameActive's one move it is position 2's turn: push a pawn.
      const live = await ask(a, '__test:inspect', { gameId: game.gameId });
      const mover = live.currentTurn;
      const moverSock = game.sockForUser(game.positions[mover]);
      const pawn = (game.state.pieces || []).find((p) => (p.player_id ?? p.team) === mover && p.y === (mover === 1 ? 6 : 1));
      assert(pawn, `no pawn for position ${mover}`);
      const noMove = never(moverSock, 'moveMade', (p) => String(p.gameId) === String(game.gameId), SETTLE_MS, 'moveMade');
      noMove.catch(() => {}); // still awaited below; this only stops an early failure crashing the run
      await expectRefused([a, b], moverSock, 'makeMove', {
        gameId: game.gameId, userId: game.positions[mover],
        move: { from: { x: pawn.x, y: pawn.y }, to: { x: pawn.x, y: pawn.y + (mover === 1 ? -1 : 1) }, pieceId: pawn.id },
      });
      await noMove;
      await expectUnchanged(game.gameId, before, 'move after resign');
    },
  },
  {
    name: 'resigning after losing on time changes nothing',
    fn: async (ctx) => {
      const { a, b, game } = await setupGame(ctx);
      const live = await ask(a, '__test:inspect', { gameId: game.gameId });
      const flaggerId = game.positions[live.currentTurn];
      const flagSock = game.sockForUser(flaggerId);
      const otherSock = flagSock === a ? b : a;
      const over = once(otherSock, 'gameOver', (p) => String(p.gameId) === String(game.gameId), 15000, 'gameOver (flag)');
      const set = await ask(flagSock, '__test:setClock', { gameId: game.gameId, userId: flaggerId, seconds: 1.5 });
      assert(set.ok, `setClock: ${set.error}`);
      const payload = await over;
      assert(payload.reason === 'timeout' && payload.winner !== flaggerId, `flag ended as ${payload.reason}, winner ${payload.winner}`);
      await wait(SETTLE_MS);
      const before = { row: await gameRow(game.gameId), elo: await elos() };
      await expectRefused([a, b], flagSock, 'resign', { gameId: game.gameId, userId: flaggerId });
      await expectRefused([a, b], otherSock, 'resign', { gameId: game.gameId, userId: payload.winner });
      await expectUnchanged(game.gameId, before, 'resign after flag');
    },
  },
  {
    name: 'two resigns at once end the game once',
    fn: async (ctx) => {
      const { a, b, game } = await setupGame(ctx);
      const start = await elos();
      const overs = [];
      a.on('gameOver', (p) => { if (String(p.gameId) === String(game.gameId)) overs.push(p); });
      a.emit('resign', { gameId: game.gameId, userId: P1.id });
      b.emit('resign', { gameId: game.gameId, userId: P2.id });
      await wait(SETTLE_MS + 1000);
      assert(overs.length === 1, `expected one gameOver, got ${overs.length}`);
      const row = await gameRow(game.gameId);
      const elo = await elos();
      const winnerId = overs[0].winner;
      const loserId = winnerId === P1.id ? P2.id : P1.id;
      assert(row.winnerId === winnerId && row.winner === winnerId, `recorded winner ${row.winnerId}/${row.winner}, announced ${winnerId}`);
      // One rated result: each side moves by exactly the change recorded.
      const ch = row.eloChanges;
      assert(ch && ch.winner.id === winnerId, 'recorded eloChanges do not match the winner');
      assert(elo[winnerId] - start[winnerId] === ch.winner.change, `winner Elo moved ${elo[winnerId] - start[winnerId]}, recorded ${ch.winner.change}`);
      assert(elo[loserId] - start[loserId] === ch.loser.change, `loser Elo moved ${elo[loserId] - start[loserId]}, recorded ${ch.loser.change}`);
    },
  },
];

run('game over stays over', checks)
  .then((ok) => db_pool.end().then(() => process.exit(ok ? 0 : 1)))
  .catch((err) => { console.error(err); process.exit(1); });
