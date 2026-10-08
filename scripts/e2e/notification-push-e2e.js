/*
 * Live notifications reach every tab, whole, and only when they should.
 *
 *   node scripts/e2e/notification-push-e2e.js      (local backend on 3001)
 *
 * Uses the e2e_free (sender) and e2e_silver (recipient) fixture users
 * (fixtures.sql) and the local "Chess" game type. The recipient has TWO
 * sockets open - two tabs.
 *
 *   1. Friend request: both tabs get the notification with its id, text,
 *      link, time and sender, then the unread count. (Pushes used to look the
 *      socket up by a number in a map keyed by strings, and found nothing.)
 *   2. Challenge: both tabs get the popup and the notification, and the text
 *      gives the time control in minutes ("10 min + 5s", not "10s +5s").
 *   3. Game chat while the recipient is IN the game (in one tab): no
 *      notification. (It used to be sent anyway.)
 *   4. Game chat after the recipient leaves the game: one notification; a
 *      second line updates it - same id - rather than adding another.
 *
 * Cleans up what it creates: the friend row, the games, their notifications.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const io = require(path.join(__dirname, '..', '..', 'chessus-frontend', 'node_modules', 'socket.io-client'));
const jwt = require('jsonwebtoken');
const db_pool = require('../../configs/db');

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3001';
const token = (u) => jwt.sign({ id: u.id, username: u.username, role: null, admin_level: null }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const connect = (user) => new Promise((resolve, reject) => {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const timer = setTimeout(() => reject(new Error(`${user.username} could not connect`)), 15000);
  socket.received = [];
  socket.on('newNotification', (n) => socket.received.push(['n', n]));
  socket.on('unreadNotificationCount', (c) => socket.received.push(['count', c]));
  socket.on('friendChallenge', (c) => socket.received.push(['challenge', c]));
  socket.on('connect', () => {
    clearTimeout(timer);
    socket.emit('authenticate', { token: token(user) });
    // The server registers the socket once the token is checked.
    setTimeout(() => resolve(socket), 400);
  });
  socket.on('connect_error', (err) => { clearTimeout(timer); reject(new Error(`could not reach ${BASE}: ${err.message}`)); });
});

const waitFor = (socket, event, ms = 10000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

const notesOf = (socket, type) => socket.received.filter(([k, n]) => k === 'n' && n.type === type).map(([, n]) => n);
const whole = (n) => n && n.id != null && n.title && n.content && n.action_url && n.created_at && n.sender_username;

(async () => {
  const [[sender]] = await db_pool.query("SELECT id, username FROM users WHERE username = 'e2e_free'");
  const [[recipient]] = await db_pool.query("SELECT id, username FROM users WHERE username = 'e2e_silver'");
  const [[chess]] = await db_pool.query("SELECT id FROM game_types WHERE game_name = 'Chess' ORDER BY id LIMIT 1");
  if (!sender || !recipient || !chess) {
    console.log('needs the e2e fixture users (scripts/e2e/fixtures.sql) and a Chess game type');
    process.exit(1);
  }
  const clearFriends = () => db_pool.query(
    'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
    [sender.id, recipient.id, recipient.id, sender.id]
  );
  await clearFriends();
  const games = [];

  const tabA = await connect(recipient);
  const tabB = await connect(recipient);
  const host = await connect(sender);

  try {
    // 1. Friend request, over REST.
    const res = await fetch(`${BASE}/api/users/${sender.id}/friends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(sender)}` },
      body: JSON.stringify({ friendId: recipient.id }),
    });
    check('friend request accepted by the API', res.ok, `HTTP ${res.status}`);
    await sleep(800);
    for (const [name, tab] of [['tab A', tabA], ['tab B', tabB]]) {
      const [n] = notesOf(tab, 'friend_request');
      check(`${name} got the friend request`, !!n);
      check(`${name}: it is whole (id, title, text, link, time, sender)`, whole(n),
        n ? `id ${n.id}, from ${n.sender_username}, at ${n.created_at}` : 'nothing');
      check(`${name}: the unread count followed it`, tab.received.some(([k]) => k === 'count'));
    }

    // 2. Challenge.
    const created = waitFor(host, 'gameCreated');
    host.emit('createGame', {
      gameTypeId: chess.id, hostId: sender.id, hostUsername: sender.username,
      challengedUserId: recipient.id, timeControl: 10, increment: 5, rated: false,
    });
    const { gameId } = await created;
    games.push(gameId);
    await sleep(800);
    for (const [name, tab] of [['tab A', tabA], ['tab B', tabB]]) {
      check(`${name} got the challenge popup`, tab.received.some(([k, c]) => k === 'challenge' && String(c.gameId) === String(gameId)));
      const [n] = notesOf(tab, 'challenge');
      check(`${name}: the challenge notification is whole`, whole(n), n && n.content);
      check(`${name}: it states the time control in minutes`, n && /10 min \+ 5s/.test(n.content), n && n.content);
    }

    // 3. Chat while the recipient is in the game: no notification.
    host.emit('joinGame', { gameId, userId: sender.id, username: sender.username });
    tabA.emit('joinGame', { gameId, userId: recipient.id, username: recipient.username });
    await sleep(1500);
    host.emit('sendGameChat', { gameId, content: 'hello while you are here' });
    await sleep(1000);
    // Stored as well as pushed: the old lookup never found the socket, so it
    // pushed nothing but still STORED one for a player reading the chat.
    const [[{ n: whileIn }]] = await db_pool.query(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'game_chat' AND related_id = ?", [recipient.id, gameId]);
    check('no chat notification while they are in the game',
      notesOf(tabA, 'game_chat').length === 0 && notesOf(tabB, 'game_chat').length === 0 && Number(whileIn) === 0,
      `${notesOf(tabA, 'game_chat').length} pushed, ${whileIn} stored`);

    // 4. The in-game tab closes; the other tab is elsewhere on the site.
    tabA.disconnect();
    await sleep(800);
    host.emit('sendGameChat', { gameId, content: 'first line' });
    await sleep(1000);
    host.emit('sendGameChat', { gameId, content: 'second line' });
    await sleep(1000);
    const chats = notesOf(tabB, 'game_chat');
    check('a chat notification once they left the game', chats.length >= 1, `${chats.length} pushed`);
    check('the second line updated it (same id) instead of adding one',
      chats.length === 2 && chats[0].id === chats[1].id && chats[1].content === 'second line',
      chats.map((c) => `#${c.id} "${c.content}"`).join(', '));
    const [[{ n: stored }]] = await db_pool.query(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'game_chat' AND related_id = ?", [recipient.id, gameId]);
    check('one chat notification stored for the game', Number(stored) === 1, `${stored} stored`);
  } catch (err) {
    check('the run finished', false, err.message);
  } finally {
    for (const s of [tabA, tabB, host]) { try { s.disconnect(); } catch (_) { /* gone */ } }
    await clearFriends();
    await db_pool.query("DELETE FROM notifications WHERE type = 'friend_request' AND user_id = ? AND sender_id = ?", [recipient.id, sender.id]);
    if (games.length) {
      await db_pool.query('DELETE FROM notifications WHERE related_id IN (?) AND type IN (\'challenge\', \'game_chat\', \'game_move\', \'system\', \'game_outcome\')', [games]);
      await db_pool.query('DELETE FROM games WHERE id IN (?)', [games]);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})();
