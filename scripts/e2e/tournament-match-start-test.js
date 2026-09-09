/*
 * Starting a tournament match, the way the bracket button does it.
 *
 *   node scripts/e2e/tournament-match-start-test.js
 *
 * The engine test proves the bracket advances once a game is attached. This
 * proves the step before that one: that pressing "Start match" on the bracket
 * actually produces a game the bracket will accept.
 *
 * It matters because a tournament game is deliberately NOT built by the
 * tournament code - it goes through the ordinary createGame socket event, as a
 * challenge from one player to the other, so that a tournament game is
 * assembled exactly the way every other game is. That leaves a seam between
 * two pieces of code that know nothing about each other, and this is the test
 * that sits on it: the game the socket makes has to be one the bracket's
 * validation recognises as this match.
 *
 * Needs the server running (TEST_SERVER_URL, default http://localhost:3001).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const jwt = require('jsonwebtoken');
const io = require(path.join(__dirname, '..', '..', 'chessus-frontend', 'node_modules', 'socket.io-client'));

const db_pool = require('../../configs/db');
const engine = require('../../server/tournament-engine');

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3001';

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

const created = { tournaments: [], games: [] };

const token = (id, username) =>
  jwt.sign({ id, username, role: null, admin_level: null }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });

const api = async (method, url, { body, as } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${token(as.id, as.username)}`;
  const r = await fetch(`${BASE}${url}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = text.slice(0, 300); }
  return { status: r.status, body: json };
};

/** Create a game the way the bracket's Start button does. */
const createGameAsPlayer = (player, gameData) => new Promise((resolve, reject) => {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const done = (fn) => (arg) => { socket.disconnect(); fn(arg); };

  const timer = setTimeout(done(reject), 15000, new Error('createGame timed out'));

  socket.on('connect', () => {
    socket.emit('authenticate', { userId: player.id, username: player.username });
    socket.emit('createGame', {
      ...gameData,
      hostId: player.id,
      hostUsername: player.username
    });
  });

  socket.on('gameCreated', ({ gameId }) => {
    clearTimeout(timer);
    created.games.push(gameId);
    done(resolve)(gameId);
  });

  socket.on('error', (err) => {
    clearTimeout(timer);
    done(reject)(new Error(err?.message || 'socket error'));
  });

  socket.on('connect_error', (err) => {
    clearTimeout(timer);
    done(reject)(new Error(`could not reach ${BASE}: ${err.message}`));
  });
});

async function main() {
  const [users] = await db_pool.query(
    "SELECT id, username FROM users WHERE username LIKE 'e2e%' ORDER BY id LIMIT 4"
  );
  if (users.length < 4) throw new Error('needs the e2e fixture users');
  const players = users.map((u) => ({ id: Number(u.id), username: u.username }));

  const gameTypeId = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10);
  const [[gameType]] = await db_pool.query('SELECT id FROM game_types WHERE id = ?', [gameTypeId]);
  if (!gameType) throw new Error(`no game type ${gameTypeId}; set TEST_GAME_TYPE_ID`);

  const startAt = new Date(Date.now() + 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const [row] = await db_pool.query(
    `INSERT INTO tournaments
      (format, game_type_id, time_control, increment_seconds, min_players, max_players,
       is_private, start_datetime, number_of_rounds, expected_length_minutes, status, created_by_id)
     VALUES ('single_elimination', ?, 10, 0, 2, 8, 1, ?, 2, 60, 'open', ?)`,
    [gameTypeId, startAt, players[0].id]
  );
  const tournamentId = row.insertId;
  created.tournaments.push(tournamentId);

  for (const p of players) {
    await db_pool.query(
      'INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)',
      [tournamentId, p.id]
    );
  }

  // --- the host starts it, over HTTP, the way the page does -----------------
  const startRes = await api('POST', `/api/tournaments/${tournamentId}/start`, { as: players[0] });
  check('the host can start the tournament over the API',
    startRes.status === 200 && startRes.body?.bracket?.started === true,
    `${startRes.status} ${JSON.stringify(startRes.body).slice(0, 120)}`);

  const notHost = await api('POST', `/api/tournaments/${tournamentId}/start`, { as: players[1] });
  check('and somebody who is not the host cannot',
    notHost.status === 403 || notHost.status === 409,
    `${notHost.status} ${JSON.stringify(notHost.body).slice(0, 100)}`);

  // --- a player starts their match ------------------------------------------
  const match = (await engine.loadBracket(tournamentId)).find((n) => n.status === 'ready');
  if (!match) throw new Error('no playable match in the drawn bracket');

  const home = players.find((p) => p.id === match.playerOneId);
  const away = players.find((p) => p.id === match.playerTwoId);

  const gameId = await createGameAsPlayer(home, {
    gameTypeId,
    timeControl: 10,
    increment: 0,
    challengedUserId: away.id,
    rated: true,
    allowSpectators: true
  });
  check('the ordinary game flow makes a game for the pairing', Number.isFinite(Number(gameId)), String(gameId));

  const attach = await api(
    'POST', `/api/tournaments/${tournamentId}/matches/${encodeURIComponent(match.key)}/game`,
    { as: home, body: { gameId } }
  );
  check('and the bracket accepts that game as the match',
    attach.status === 200, `${attach.status} ${JSON.stringify(attach.body).slice(0, 160)}`);

  const attached = (await engine.loadBracket(tournamentId)).find((n) => n.key === match.key);
  check('the match now points at the game',
    Number(attached.gameId) === Number(gameId) && attached.status === 'active',
    `game=${attached.gameId} status=${attached.status}`);

  const returned = attach.body?.bracket;
  check('and the response carries the updated bracket back to the page', (() => {
    if (!returned?.rounds?.length) return false;
    const found = returned.rounds
      .flatMap((r) => r.matches)
      .find((m) => m.key === match.key);
    return found && Number(found.gameId) === Number(gameId);
  })());

  // --- an outsider's game is not this match --------------------------------
  const outsider = players.find((p) => p.id !== home.id && p.id !== away.id);
  const strayGame = await createGameAsPlayer(home, {
    gameTypeId, timeControl: 10, increment: 0, challengedUserId: outsider.id, rated: true
  });
  const secondMatch = (await engine.loadBracket(tournamentId)).find((n) => n.status === 'ready');
  if (secondMatch) {
    const stray = await api(
      'POST', `/api/tournaments/${tournamentId}/matches/${encodeURIComponent(secondMatch.key)}/game`,
      { as: home, body: { gameId: strayGame } }
    );
    check('a game against somebody outside the pairing is refused',
      stray.status === 400 || stray.status === 403,
      `${stray.status} ${JSON.stringify(stray.body).slice(0, 120)}`);
  } else {
    check('a game against somebody outside the pairing is refused', false, 'no second match to test against');
  }

  // --- the result flows back through the bracket ----------------------------
  await db_pool.query(
    "UPDATE games SET status = 'completed', end_time = NOW(), winner_id = ? WHERE id = ?",
    [away.id, gameId]
  );

  const bracketAfter = await api('GET', `/api/tournaments/${tournamentId}/bracket`, { as: home });
  const decided = bracketAfter.body?.bracket?.rounds
    ?.flatMap((r) => r.matches)
    ?.find((m) => m.key === match.key);
  check('reading the bracket picks the finished game up on its own',
    decided?.status === 'completed' && Number(decided.winnerId) === away.id,
    `${decided?.status} winner=${decided?.winnerId}`);

  const advancedTo = bracketAfter.body?.bracket?.rounds
    ?.flatMap((r) => r.matches)
    ?.find((m) => [m.playerOne, m.playerTwo]
      .some((s) => s?.type === 'player' && Number(s.id) === away.id && m.key !== match.key));
  check('and the winner is seated in the next round',
    !!advancedTo, 'the winner should appear in a later match');
}

async function cleanup() {
  for (const id of created.games) {
    await db_pool.query('DELETE FROM players WHERE game_id = ?', [id]).catch(() => {});
    await db_pool.query('DELETE FROM games WHERE id = ?', [id]).catch(() => {});
  }
  for (const id of created.tournaments) {
    await db_pool.query('DELETE FROM tournaments WHERE id = ?', [id]).catch(() => {});
  }
}

main()
  .catch((err) => check('the suite ran to the end', false, err.stack || err.message))
  .then(cleanup)
  .then(() => {
    console.log('');
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `\n      ${r.detail}`}`);
    }
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  });
