/*
 * The line win condition, played through a real game.
 *
 *   node scripts/e2e/line-win-e2e.js
 *
 * The unit tests in win-line.js prove the geometry. This proves the part they
 * cannot: that the condition is actually REACHED when a game is played, which
 * for a placement game means the check in the placement handler rather than
 * the one in checkWinCondition. A game of noughts and crosses is placement from
 * the first move to the last, so if that call were wrong the geometry would be
 * perfect and nobody would ever win.
 *
 * Plays three games:
 *
 *   1. Tic Tac Toe - one player takes the top row, and the game ends with
 *      reason 'line'.
 *   2. Tic Tac Toe - nobody makes a row, the board fills, and the game ends as
 *      a draw rather than sitting there with neither player able to act.
 *   3. Connect Four - every drop is aimed at the TOP row, which only works if
 *      board gravity is resolving the landing square; four stack up and win.
 *
 * Needs the server running (TEST_SERVER_URL, default http://localhost:3001)
 * and the e2e fixture users.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const io = require(path.join(__dirname, '..', '..', 'chessus-frontend', 'node_modules', 'socket.io-client'));
const db_pool = require('../../configs/db');

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3001';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};

const createdGames = [];

const connect = (player) => new Promise((resolve, reject) => {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const timer = setTimeout(() => reject(new Error(`${player.username} could not connect`)), 15000);
  socket.on('connect', () => {
    clearTimeout(timer);
    socket.emit('authenticate', { userId: player.id, username: player.username });
    resolve(socket);
  });
  socket.on('connect_error', (err) => {
    clearTimeout(timer);
    reject(new Error(`could not reach ${BASE}: ${err.message}`));
  });
});

const waitFor = (socket, event, ms = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

/**
 * One game of Tic Tac Toe, played as a list of [player, x, y] placements.
 *
 * Returns whatever gameOver payload arrives, or null if the moves ran out
 * without the game ending.
 */
async function playGame(gameTypeId, host, guest, placements, placePieceId) {
  const hostSocket = await connect(host);
  const guestSocket = await connect(guest);

  try {
    const created = waitFor(hostSocket, 'gameCreated');
    hostSocket.emit('createGame', {
      gameTypeId,
      hostId: host.id,
      hostUsername: host.username,
      challengedUserId: guest.id,
      timeControl: 10,
      increment: 0,
      rated: false,
    });
    const { gameId } = await created;
    createdGames.push(gameId);

    /*
     * Who sits in seat 1 is the SERVER'S decision, not the host's - creating a
     * game does not reserve a side. An earlier version of this test assumed the
     * host moved first and failed roughly half the time, which looked exactly
     * like a broken win check. Read the seating instead.
     */
    hostSocket.emit('joinGame', { gameId, userId: host.id, username: host.username });
    guestSocket.emit('joinGame', { gameId, userId: guest.id, username: guest.username });
    await new Promise((r) => setTimeout(r, 1500));

    // Read the seating from the players table, which is where the server wrote
    // it. Whichever seat is 1 moves first, and that is not always the host.
    const [seatRows] = await db_pool.query(
      'SELECT user_id, player_position FROM players WHERE game_id = ?', [gameId]);
    const seats = {};
    for (const r of seatRows) seats[Number(r.player_position)] = Number(r.user_id);
    if (!seats[1] || !seats[2]) {
      throw new Error(`could not read the seating: ${JSON.stringify(seatRows)}`);
    }
    const socketFor = (position) => (seats[position] === host.id ? hostSocket : guestSocket);

    let over = null;
    const onOver = (payload) => { if (!over) over = payload; };
    hostSocket.on('gameOver', onOver);
    guestSocket.on('gameOver', onOver);
    // A rejected placement is the most likely reason a sequence does not play
    // out, and silence about it would make a stalled game look like a bug in
    // the win check rather than a move the server refused.
    hostSocket.on('error', (e) => console.log('   [host rejected]', e?.message));
    guestSocket.on('error', (e) => console.log('   [guest rejected]', e?.message));

    for (const [who, x, y] of placements) {
      if (over) break;
      socketFor(who).emit('makeMove', {
        gameId,
        userId: seats[who],
        move: { type: 'place', to: { x, y }, placePieceId },
      });
      await new Promise((r) => setTimeout(r, 450));
    }
    await new Promise((r) => setTimeout(r, 900));
    return { over, seats };
  } finally {
    hostSocket.disconnect();
    guestSocket.disconnect();
  }
}

async function main() {
  const [[game]] = await db_pool.query(
    "SELECT id, other_game_data FROM game_types WHERE game_name = 'Tic Tac Toe' LIMIT 1");
  if (!game) throw new Error("no 'Tic Tac Toe' game type on this database");
  const placePieceId = JSON.parse(game.other_game_data).placeable_pieces[0].piece_id;

  const [users] = await db_pool.query(
    "SELECT id, username FROM users WHERE username IN ('e2e_free','e2e_silver') ORDER BY id");
  if (users.length < 2) throw new Error('needs the e2e fixture users');
  const [host, guest] = users.map((u) => ({ id: Number(u.id), username: u.username }));

  // --- 1. a win by three in a row ------------------------------------------
  // P1 takes the top row; P2 answers along the middle without completing one.
  const win = await playGame(game.id, host, guest, [
    [1, 0, 0], [2, 0, 1],
    [1, 1, 0], [2, 1, 1],
    [1, 2, 0],
  ], placePieceId);

  check('three in a row ends the game', !!win.over, win.over ? '' : 'no gameOver arrived');
  check('and the reason is a line', win.over?.reason === 'line', `reason=${win.over?.reason}`);
  check('and the player who made it wins',
    Number(win.over?.winner) === win.seats[1], `winner=${win.over?.winner} seat1=${win.seats[1]}`);

  // --- 2. a full board with no row -----------------------------------------
  //   X O X
  //   X O O
  //   O X X
  const draw = await playGame(game.id, host, guest, [
    [1, 0, 0], [2, 1, 0],
    [1, 2, 0], [2, 1, 1],
    [1, 0, 1], [2, 2, 1],
    [1, 1, 2], [2, 0, 2],
    [1, 2, 2],
  ], placePieceId);

  check('a full board with no row still ends', !!draw.over, draw.over ? '' : 'the game stalled');
  check('and it is a draw rather than a win',
    draw.over && !draw.over.winner, `winner=${draw.over?.winner ?? 'none'} reason=${draw.over?.reason}`);
  check('and it says so', draw.over?.reason === 'board_full_draw', `reason=${draw.over?.reason}`);

  // --- 3. gravity: dropped pieces stack from the bottom --------------------
  const [[c4]] = await db_pool.query(
    "SELECT id, other_game_data FROM game_types WHERE game_name = 'Connect Four' LIMIT 1");
  if (c4) {
    const discId = JSON.parse(c4.other_game_data).placeable_pieces[0].piece_id;
    /*
     * Every drop aims at row 0 - the TOP of the grid - which is the point: on a
     * gravity board the click picks a column and the server decides the row. If
     * gravity were not applied these would all be refused as "square occupied"
     * after the first, and nobody would win anything.
     *
     * Seat 1 fills column 3, seat 2 answers in column 4. Seat 1's fourth disc
     * completes a vertical four.
     */
    const c4Game = await playGame(c4.id, host, guest, [
      [1, 3, 0], [2, 4, 0],
      [1, 3, 0], [2, 4, 0],
      [1, 3, 0], [2, 4, 0],
      [1, 3, 0],
    ], discId);

    check('discs aimed at the top of a column still land', !!c4Game.over,
      c4Game.over ? '' : 'nothing ended - the drops were probably refused');
    check('four in a column wins', c4Game.over?.reason === 'line', `reason=${c4Game.over?.reason}`);
    check('and it is the player who dropped them',
      Number(c4Game.over?.winner) === c4Game.seats[1],
      `winner=${c4Game.over?.winner} seat1=${c4Game.seats[1]}`);

    // And the discs really are stacked from the bottom up.
    const [[played]] = await db_pool.query(
      'SELECT pieces FROM games WHERE id = ?', [createdGames[createdGames.length - 1]]);
    let stacked = [];
    try {
      stacked = (JSON.parse(played.pieces) || [])
        .filter((pc) => Number(pc.x) === 3)
        .map((pc) => Number(pc.y))
        .sort((a, b) => a - b);
    } catch (_) { /* reported by the check below */ }
    check('they stacked on the bottom row upwards',
      JSON.stringify(stacked) === JSON.stringify([2, 3, 4, 5]),
      `column 3 rows: ${JSON.stringify(stacked)} (a 6-high board, so 5 is the floor)`);
  } else {
    check("the 'Connect Four' game type exists", false, 'not on this database');
  }

  if (createdGames.length) {
    await db_pool.query('DELETE FROM games WHERE id IN (?)', [createdGames]);
    console.log(`\ncleaned up ${createdGames.length} test game(s)`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
