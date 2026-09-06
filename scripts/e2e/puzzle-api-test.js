/*
 * Puzzle API suite: creator CRUD, publish, solving, and solver feedback.
 *
 * Tokens are minted directly from ACCESS_TOKEN_SECRET rather than logging in,
 * so fixture users need no password.
 *
 *   bash: ENABLE_TEST_HOOKS=1 PORT=3002 node server/index.js
 *         TEST_SERVER_URL=http://localhost:3002 E2E_FIXTURE_IDS='{...}' \
 *           node scripts/e2e/puzzle-api-test.js
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

const CREATOR = { id: ids.e2e_free, name: 'e2e_free' };
const SOLVER = { id: ids.e2e_silver, name: 'e2e_silver' };

async function api(method, url, { body, as } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${token(as.id, as.name)}`;
  const r = await fetch(`${BASE}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = text.slice(0, 200); }
  return { status: r.status, body: json };
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

// A legal-but-unremarkable rook move; the point of these tests is the API, not
// the position.
const POSITION = [
  { id: 'bk', piece_type_id: null, x: 0, y: 0, player_id: 2, team: 2, piece_name: 'King' },
  { id: 'wk', piece_type_id: null, x: 0, y: 2, player_id: 1, team: 1, piece_name: 'King' },
  { id: 'wr', piece_type_id: null, x: 9, y: 7, player_id: 1, team: 1, piece_name: 'Rook' },
];
const SOLUTION = [{ from: { x: 9, y: 7 }, to: { x: 9, y: 0 }, pieceId: 'wr' }];

async function main() {
  // --- create ---------------------------------------------------------------
  const created = await api('POST', `/api/game-types/${GAME_TYPE_ID}/puzzles`, {
    as: CREATOR,
    body: {
      title: 'Back rank', position: POSITION, side_to_move: 1,
      goal: 'checkmate_in_1', solution_line: SOLUTION,
    },
  });
  check('a creator can create a puzzle', created.status === 201, `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
  const puzzleId = created.body?.puzzle?.id;
  if (!puzzleId) { report(); return; }
  check('new puzzles start as drafts', created.body.puzzle.is_draft === 1, `is_draft=${created.body.puzzle.is_draft}`);

  // --- goal description is required for non-mate goals -----------------------
  const noDesc = await api('POST', `/api/game-types/${GAME_TYPE_ID}/puzzles`, {
    as: CREATOR,
    body: { position: POSITION, side_to_move: 1, goal: 'win_material', solution_line: SOLUTION },
  });
  check('a material puzzle must say what to aim for', noDesc.status === 400, `${noDesc.status} ${JSON.stringify(noDesc.body).slice(0, 120)}`);

  // --- drafts are private ---------------------------------------------------
  const asStranger = await api('GET', `/api/puzzles/${puzzleId}`);
  check('a draft is invisible to everyone else', asStranger.status === 404, `${asStranger.status}`);

  // --- the answer never leaks ----------------------------------------------
  await api('POST', `/api/puzzles/${puzzleId}/publish`, { as: CREATOR, body: { publish: true } });
  const published = await api('GET', `/api/puzzles/${puzzleId}`);
  check('a published puzzle is readable', published.status === 200, `${published.status}`);
  check(
    'the solution is NOT sent to a solver',
    published.status === 200 && published.body.puzzle.solution_line === undefined,
    `solution_line present: ${JSON.stringify(published.body?.puzzle?.solution_line)}`
  );
  const asCreator = await api('GET', `/api/puzzles/${puzzleId}`, { as: CREATOR });
  check('the creator does see their own solution', Array.isArray(asCreator.body?.puzzle?.solution_line), 'missing for creator');

  // --- solving --------------------------------------------------------------
  const wrong = await api('POST', `/api/puzzles/${puzzleId}/solve`, {
    as: SOLVER, body: { moves: [{ from: { x: 0, y: 2 }, to: { x: 1, y: 2 }, pieceId: 'wk' }] },
  });
  check('a wrong answer is rejected', wrong.status === 200 && wrong.body.solved === false, JSON.stringify(wrong.body));
  check('a wrong answer does not reveal the solution', wrong.body?.solution === undefined, 'solution leaked on failure');

  const right = await api('POST', `/api/puzzles/${puzzleId}/solve`, { as: SOLVER, body: { moves: SOLUTION } });
  check('the right answer is accepted', right.status === 200 && right.body.solved === true, JSON.stringify(right.body));

  // --- feedback -------------------------------------------------------------
  const tooShort = await api('POST', `/api/puzzles/${puzzleId}/feedback`, {
    as: SOLVER, body: { category: 'multiple_solutions', message: 'bad' },
  });
  check('feedback requires an actual message', tooShort.status === 400, `${tooShort.status}`);

  const sent = await api('POST', `/api/puzzles/${puzzleId}/feedback`, {
    as: SOLVER,
    body: { category: 'multiple_solutions', message: 'The rook on the other side also mates, I think.' },
  });
  check('feedback with a message is accepted', sent.status === 201, `${sent.status} ${JSON.stringify(sent.body).slice(0, 120)}`);

  const stillPublished = await api('GET', `/api/puzzles/${puzzleId}`);
  check(
    'feedback does NOT unpublish or invalidate the puzzle',
    stillPublished.status === 200 && stillPublished.body.puzzle.is_draft === 0,
    `is_draft=${stillPublished.body?.puzzle?.is_draft}, moderation=${stillPublished.body?.puzzle?.moderation_status}`
  );

  const mine = await api('GET', `/api/puzzles/${puzzleId}/feedback`, { as: CREATOR });
  check('the creator can read their feedback', mine.status === 200 && mine.body.feedback.length === 1, `${mine.status} ${mine.body?.feedback?.length}`);
  const theirs = await api('GET', `/api/puzzles/${puzzleId}/feedback`, { as: SOLVER });
  check('someone else cannot read it', theirs.status === 403, `${theirs.status}`);

  // --- validation is advice, not a gate ------------------------------------
  const validated = await api('POST', `/api/puzzles/${puzzleId}/validate`, { as: CREATOR });
  check(
    'validation reports without blocking',
    validated.status === 200 && validated.body.blocksPublishing === false,
    `${validated.status} ${JSON.stringify(validated.body).slice(0, 200)}`
  );

  // --- history --------------------------------------------------------------
  const hist = await api('GET', `/api/users/${SOLVER.id}/puzzle-history`);
  check('the solver has a puzzle history', hist.status === 200 && hist.body.attempts.length >= 2, `${hist.status} ${hist.body?.attempts?.length}`);

  await api('DELETE', `/api/puzzles/${puzzleId}`, { as: CREATOR });
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
