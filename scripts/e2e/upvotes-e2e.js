/*
 * Upvotes on games, pieces, puzzles and forum posts.
 *
 *   node scripts/e2e/upvotes-e2e.js      (local backend on 3001)
 *
 * For one published game, piece, puzzle and forum post:
 *   - its creator cannot upvote (or like) it - refused by the server;
 *   - somebody else can, the count goes up, the status says so, and a second
 *     press takes it back;
 *   - the puzzle and piece lists carry the count and the viewer's vote, and
 *     sort by it ("most_upvoted");
 *   - the old like routes need a sign-in and refuse your own post.
 * Leaves no votes behind.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const jwt = require('jsonwebtoken');
const db_pool = require('../../configs/db');

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3001';
const token = (u) => jwt.sign({ id: u.id, username: u.username, role: null, admin_level: null }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};
const call = async (method, url, user, body) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty */ }
  return { status: res.status, data };
};

(async () => {
  const [[voter]] = await db_pool.query("SELECT id, username FROM users WHERE username = 'e2e_free'");
  const pickOne = async (sql) => (await db_pool.query(sql))[0][0];
  const things = {
    game: await pickOne("SELECT t.id, t.creator_id FROM game_types t WHERE (t.is_draft = 0 OR t.is_draft IS NULL) AND t.creator_id IS NOT NULL AND t.creator_id <> " + voter.id + " ORDER BY t.id LIMIT 1"),
    piece: await pickOne("SELECT p.id, p.creator_id FROM pieces p WHERE (p.is_draft = 0 OR p.is_draft IS NULL) AND p.creator_id IS NOT NULL AND p.creator_id <> " + voter.id + " ORDER BY p.id LIMIT 1"),
    puzzle: await pickOne("SELECT p.id, p.creator_id FROM puzzles p WHERE p.is_draft = 0 AND p.moderation_status = 'approved' AND p.creator_id <> " + voter.id + " ORDER BY p.id LIMIT 1"),
  };
  const routes = { game: 'games', piece: 'pieces', puzzle: 'puzzles' };
  const tables = { game: ['game_type_upvotes', 'game_type_id'], piece: ['piece_upvotes', 'piece_id'], puzzle: ['puzzle_upvotes', 'puzzle_id'] };

  try {
    for (const kind of Object.keys(things)) {
      const t = things[kind];
      if (!t) { check(`a published ${kind} to test on`, false); continue; }
      const [[owner]] = await db_pool.query('SELECT id, username FROM users WHERE id = ?', [t.creator_id]);
      const url = `/api/${routes[kind]}/${t.id}/upvote`;
      const [tbl, col] = tables[kind];
      await db_pool.query(`DELETE FROM ${tbl} WHERE ${col} = ? AND user_id IN (?, ?)`, [t.id, voter.id, owner.id]);

      const own = await call('POST', url, owner);
      check(`${kind}: its creator cannot upvote it`, own.status === 403 && own.data?.own, `HTTP ${own.status} ${own.data?.message || ''}`);
      const ownStatus = await call('GET', url, owner);
      check(`${kind}: the status tells its creator it is theirs`, ownStatus.data?.own === true);

      const before = (await call('GET', url, voter)).data;
      const on = await call('POST', url, voter);
      check(`${kind}: someone else can upvote it`, on.status === 200 && on.data.upvoted === true && on.data.upvote_count === before.upvote_count + 1,
        `${before.upvote_count} -> ${on.data?.upvote_count}`);
      const status = (await call('GET', url, voter)).data;
      check(`${kind}: the status shows their vote`, status.upvoted === true && status.own === false);
      const anon = await call('POST', url, null);
      check(`${kind}: signing in is required to vote`, anon.status === 401);

      if (kind === 'puzzle') {
        const list = (await call('GET', '/api/puzzles?sort=most_upvoted&limit=60', voter)).data.puzzles;
        const row = list.find((p) => p.id === t.id);
        check('puzzle list: carries the count and the viewer\'s vote', row && row.upvote_count >= 1 && !!row.upvoted_by_user, row && `count ${row.upvote_count}`);
        const counts = list.map((p) => Number(p.upvote_count));
        check('puzzle list: sorted by upvotes', counts.every((c, i) => i === 0 || c <= counts[i - 1]), counts.slice(0, 6).join(','));
      }
      if (kind === 'piece') {
        const list = (await call('GET', '/api/pieces?sort=most_upvoted&limit=50', voter)).data.pieces;
        const row = list.find((p) => p.id === t.id);
        check('piece list: carries the count and the viewer\'s vote', row && row.upvote_count >= 1 && !!row.upvoted_by_user, row && `count ${row.upvote_count}`);
        const counts = list.map((p) => Number(p.upvote_count));
        check('piece list: sorted by upvotes', counts.every((c, i) => i === 0 || c <= counts[i - 1]), counts.slice(0, 6).join(','));
      }

      const off = await call('POST', url, voter);
      check(`${kind}: a second press takes it back`, off.data?.upvoted === false && off.data.upvote_count === before.upvote_count);
    }

    // Forum posts.
    const [[post]] = await db_pool.query('SELECT id, author_id FROM articles WHERE author_id IS NOT NULL AND author_id <> ? ORDER BY id LIMIT 1', [voter.id]);
    const [[author]] = await db_pool.query('SELECT id, username FROM users WHERE id = ?', [post.author_id]);
    await db_pool.query('DELETE FROM likes WHERE article_id = ? AND user_id IN (?, ?)', [post.id, voter.id, author.id]);
    const ownLike = await call('POST', `/api/forums/${post.id}/toggle-like`, author);
    check('forum: its author cannot like their own post', ownLike.status === 403, `HTTP ${ownLike.status}`);
    const like = await call('POST', `/api/forums/${post.id}/toggle-like`, voter);
    check('forum: someone else can', like.status === 200 && like.data.liked === true);
    await call('POST', `/api/forums/${post.id}/toggle-like`, voter);
    const legacyAnon = await call('POST', '/api/likes/new', null, { user_id: voter.id, article_id: post.id });
    check('forum: the old like route needs a sign-in', legacyAnon.status === 401, `HTTP ${legacyAnon.status}`);
    const legacyOwn = await call('POST', '/api/likes/new', author, { article_id: post.id });
    check('forum: the old like route refuses your own post', legacyOwn.status === 403, `HTTP ${legacyOwn.status}`);
    const legacy = await call('POST', '/api/likes/new', voter, { user_id: author.id, article_id: post.id });
    const [[stored]] = await db_pool.query('SELECT user_id FROM likes WHERE id = ?', [legacy.data?.result?.id || 0]);
    check('forum: the old route likes as the signed-in user, whatever the body says', stored && stored.user_id === voter.id);
    const steal = await call('POST', '/api/likes/delete', author, { id: legacy.data?.result?.id });
    const [[still]] = await db_pool.query('SELECT COUNT(*) AS n FROM likes WHERE id = ?', [legacy.data?.result?.id || 0]);
    check("forum: nobody can delete someone else's like", steal.status === 200 && Number(still.n) === 1);
    await call('POST', '/api/likes/delete', voter, { id: legacy.data?.result?.id });
    const [[gone]] = await db_pool.query('SELECT COUNT(*) AS n FROM likes WHERE id = ?', [legacy.data?.result?.id || 0]);
    check('forum: you can remove your own like', Number(gone.n) === 0);
  } catch (err) {
    check('the run finished', false, err.stack);
  } finally {
    for (const kind of Object.keys(things)) {
      if (!things[kind]) continue;
      const [tbl, col] = tables[kind];
      await db_pool.query(`DELETE FROM ${tbl} WHERE ${col} = ? AND user_id = ?`, [things[kind].id, voter.id]);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})();
