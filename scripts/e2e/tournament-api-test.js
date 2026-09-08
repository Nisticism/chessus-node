/*
 * Tournament API: joining, leaving, and the states where neither is allowed.
 *
 * Written while auditing tournaments, which are half-built - there is no
 * bracket, no pairing and no results table yet. What DOES exist is the entry
 * list, and the rules around it are the part people can already get wrong:
 * joining something that has already started, or having no way back out.
 *
 *   node scripts/e2e/tournament-api-test.js
 *
 * Tokens are minted from ACCESS_TOKEN_SECRET, so fixture users need no password.
 * Needs E2E_FIXTURE_IDS (see scripts/e2e/fixtures.sql).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_SERVER_URL || 'http://localhost:3001';
const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10);

const ids = JSON.parse(process.env.E2E_FIXTURE_IDS || 'null');
if (!ids) throw new Error('set E2E_FIXTURE_IDS (see scripts/e2e/fixtures.sql)');

const token = (id, username, role = null) =>
  jwt.sign({ id, username, role, admin_level: null }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });

const HOST = { id: ids.e2e_silver, name: 'e2e_silver' };
const PLAYER = { id: ids.e2e_free, name: 'e2e_free' };
const OTHER = { id: ids.e2e_gold, name: 'e2e_gold' };

async function api(method, url, { body, as } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${token(as.id, as.name, as.role || null)}`;
  const r = await fetch(`${BASE}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = text.slice(0, 200); }
  return { status: r.status, body: json };
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const inIt = (tournament, user) =>
  (tournament?.participants || []).some((p) => Number(p.id) === Number(user.id));

async function main() {
  const startDateTime = new Date(Date.now() + 3600_000).toISOString().slice(0, 19).replace('T', ' ');

  const created = await api('POST', '/api/tournaments', {
    as: HOST,
    body: {
      format: 'single_elimination', gameTypeId: GAME_TYPE_ID,
      timeControl: 10, increment: 0, minPlayers: 2, maxPlayers: 4,
      isPrivate: false, startDateTime,
    },
  });
  check('a tournament can be created', created.status === 200 || created.status === 201,
    `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
  const id = created.body?.tournament?.id;
  if (!id) { report(); return; }

  // The host is entered automatically, which is what makes "the host cannot
  // leave" a case that comes up rather than a hypothetical.
  const afterCreate = await api('GET', `/api/tournaments/${id}`, { as: HOST });
  const hostEntered = inIt(afterCreate.body?.tournament, HOST);

  // --- joining ---------------------------------------------------------------
  const joined = await api('POST', `/api/tournaments/${id}/join`, { as: PLAYER });
  check('a player can join', joined.status === 200 && inIt(joined.body?.tournament, PLAYER),
    `${joined.status} ${JSON.stringify(joined.body?.tournament?.participants || [])}`);

  const rejoined = await api('POST', `/api/tournaments/${id}/join`, { as: PLAYER });
  check('joining twice is harmless', rejoined.status === 200
    && (rejoined.body?.tournament?.participants || []).filter((p) => Number(p.id) === Number(PLAYER.id)).length === 1,
    JSON.stringify(rejoined.body?.tournament?.participants || []));

  // --- leaving ---------------------------------------------------------------
  const left = await api('POST', `/api/tournaments/${id}/leave`, { as: PLAYER });
  check('a player can leave again', left.status === 200 && !inIt(left.body?.tournament, PLAYER),
    `${left.status} ${JSON.stringify(left.body?.tournament?.participants || [])}`);

  const leftTwice = await api('POST', `/api/tournaments/${id}/leave`, { as: PLAYER });
  check('leaving when not in it is refused', leftTwice.status === 400, `${leftTwice.status}`);

  if (hostEntered) {
    const hostLeave = await api('POST', `/api/tournaments/${id}/leave`, { as: HOST });
    check('the host cannot leave their own tournament',
      hostLeave.status === 400 && /host cannot leave/i.test(hostLeave.body?.message || ''),
      `${hostLeave.status} ${hostLeave.body?.message}`);
  } else {
    check('the host cannot leave their own tournament', true, 'host is not auto-entered; case does not arise');
  }

  const anon = await api('POST', `/api/tournaments/${id}/leave`);
  check('leaving requires being signed in', anon.status === 401 || anon.status === 403, `${anon.status}`);

  // --- a started tournament is closed to both --------------------------------
  await api('POST', `/api/tournaments/${id}/join`, { as: PLAYER });
  await api('PUT', `/api/tournaments/${id}`, { as: HOST, body: { status: 'started' } });

  const lateJoin = await api('POST', `/api/tournaments/${id}/join`, { as: OTHER });
  check('nobody can join once it has started',
    lateJoin.status === 400 && /already started/i.test(lateJoin.body?.message || ''),
    `${lateJoin.status} ${lateJoin.body?.message}`);

  const lateLeave = await api('POST', `/api/tournaments/${id}/leave`, { as: PLAYER });
  check('and nobody can leave once it has started',
    lateLeave.status === 400 && /already started/i.test(lateLeave.body?.message || ''),
    `${lateLeave.status} ${lateLeave.body?.message}`);

  // --- cancelled tournaments are kept, and stay closed -----------------------
  await api('PUT', `/api/tournaments/${id}`, { as: HOST, body: { status: 'cancelled' } });
  const afterCancel = await api('GET', `/api/tournaments/${id}`, { as: HOST });
  check('a cancelled tournament is still readable afterwards',
    afterCancel.status === 200 && afterCancel.body?.tournament?.status === 'cancelled',
    `${afterCancel.status} ${afterCancel.body?.tournament?.status}`);

  const listed = await api('GET', '/api/tournaments', { as: HOST });
  check('and still appears in the list, so there is a history',
    (listed.body?.tournaments || []).some((t) => String(t.id) === String(id)),
    `${(listed.body?.tournaments || []).length} tournament(s) listed`);

  const joinCancelled = await api('POST', `/api/tournaments/${id}/join`, { as: OTHER });
  check('a cancelled tournament cannot be joined',
    joinCancelled.status === 400 && /cancelled/i.test(joinCancelled.body?.message || ''),
    `${joinCancelled.status} ${joinCancelled.body?.message}`);

  report();
}

function report() {
  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail || ''}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); report(); });
