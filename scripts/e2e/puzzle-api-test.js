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

// Building is the Silver perk, so the creator has to be a supporter; solving is
// open to everyone, so the solver deliberately is not.
const CREATOR = { id: ids.e2e_silver, name: 'e2e_silver' };
const SOLVER = { id: ids.e2e_free, name: 'e2e_free' };
// Two more solvers, so the partial-credit comparison below is between two
// untouched ratings rather than one rating measured against itself.
const QUITTER = { id: ids.e2e_gold, name: 'e2e_gold' };
const MISSER = { id: ids.e2e_admin, name: 'e2e_admin' };

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

  await multiMove();
  await randomPuzzle();
  report();
}

/*
 * "Play a random puzzle": prefer something the solver has not tried, but keep
 * working once they have played them all.
 *
 * Uses its own game type (TEST_EMPTY_GAME_TYPE_ID, one with no puzzles of its
 * own) so the set is exactly what this test creates - on a shared game type the
 * "they have played everything" case could never be reached.
 */
async function randomPuzzle() {
  const gt = parseInt(process.env.TEST_EMPTY_GAME_TYPE_ID || '485', 10);

  const empty = await api('GET', `/api/game-types/${gt}/puzzles/random`);
  check('a game with no puzzles says so rather than erroring', empty.status === 404, `${empty.status}`);

  const ids = [];
  for (const title of ['Random A', 'Random B', 'Random C']) {
    const made = await api('POST', `/api/game-types/${gt}/puzzles`, {
      as: CREATOR,
      body: {
        title, position: POSITION, side_to_move: 1,
        goal: 'checkmate_in_1', solution_line: SOLUTION,
      },
    });
    if (made.body?.puzzle?.id) {
      ids.push(made.body.puzzle.id);
      await api('POST', `/api/puzzles/${made.body.puzzle.id}/publish`, { as: CREATOR, body: { publish: true } });
    }
  }
  check('three puzzles to draw from', ids.length === 3, `${ids.length}`);
  if (ids.length !== 3) return;

  // A draft must never be handed out at random.
  const draft = await api('POST', `/api/game-types/${gt}/puzzles`, {
    as: CREATOR,
    body: { title: 'Random draft', position: POSITION, side_to_move: 1, goal: 'checkmate_in_1', solution_line: SOLUTION },
  });
  const draftId = draft.body?.puzzle?.id;

  const picks = new Set();
  for (let i = 0; i < 15; i++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await api('GET', `/api/game-types/${gt}/puzzles/random`, { as: MISSER });
    picks.add(r.body?.id);
  }
  check('it only ever offers published puzzles',
    [...picks].every((id) => ids.includes(id)),
    `picked ${[...picks].join(',')} from ${ids.join(',')}${draftId ? ` (draft ${draftId})` : ''}`);
  check('and does not just hand out the same one', picks.size > 1, `${picks.size} distinct in 15 draws`);

  // Play two of the three; the third is the only one it should offer now.
  for (const id of ids.slice(0, 2)) {
    // eslint-disable-next-line no-await-in-loop
    await api('POST', `/api/puzzles/${id}/solve`, { as: MISSER, body: { moves: SOLUTION } });
  }
  const afterTwo = new Set();
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await api('GET', `/api/game-types/${gt}/puzzles/random`, { as: MISSER });
    afterTwo.add(r.body?.id);
  }
  check('it skips puzzles this solver has already played',
    afterTwo.size === 1 && afterTwo.has(ids[2]),
    `offered ${[...afterTwo].join(',')}, expected only ${ids[2]}`);

  const lastOne = await api('GET', `/api/game-types/${gt}/puzzles/random`, { as: MISSER });
  check('and says the pick is one they have not played', lastOne.body?.unplayed === true,
    JSON.stringify(lastOne.body));

  // Play the third: now everything is played and it has to keep working.
  await api('POST', `/api/puzzles/${ids[2]}/solve`, { as: MISSER, body: { moves: SOLUTION } });
  const exhausted = await api('GET', `/api/game-types/${gt}/puzzles/random`, { as: MISSER });
  check('once they have played them all it still returns one',
    exhausted.status === 200 && ids.includes(exhausted.body?.id),
    `${exhausted.status} ${JSON.stringify(exhausted.body)}`);
  check('flagged as a repeat, so the page can say it will not move a rating',
    exhausted.body?.unplayed === false, JSON.stringify(exhausted.body));

  for (const id of [...ids, draftId].filter(Boolean)) {
    // eslint-disable-next-line no-await-in-loop
    await api('DELETE', `/api/puzzles/${id}`, { as: CREATOR });
  }
}

/*
 * Longer puzzles: the solver finds one move at a time and the creator's scripted
 * reply comes back, so the answer is never in the page ahead of being found.
 */
async function multiMove() {
  // [your move 1, their reply, your move 2]. Legality is not the point here -
  // the solve endpoint matches moves, and puzzle-validation-test.js is where
  // the engine gets involved.
  const M1 = { from: { x: 9, y: 7 }, to: { x: 9, y: 4 }, pieceId: 'wr' };
  const R1 = { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, pieceId: 'bk' };
  const M2 = { from: { x: 9, y: 4 }, to: { x: 9, y: 0 }, pieceId: 'wr' };
  const WRONG = { from: { x: 9, y: 4 }, to: { x: 5, y: 4 }, pieceId: 'wr' };

  const made = await api('POST', `/api/game-types/${GAME_TYPE_ID}/puzzles`, {
    as: CREATOR,
    body: {
      title: 'Two-mover', position: POSITION, side_to_move: 1,
      goal: 'win_material', goal_description: 'Win the rook',
      solution_line: [M1, R1, M2],
    },
  });
  check('a multi-move line can be saved', made.status === 201, `${made.status} ${JSON.stringify(made.body).slice(0, 160)}`);
  const id = made.body?.puzzle?.id;
  if (!id) return;
  check(
    'depth counts the solver\'s moves, not plies',
    made.body.puzzle.solution_depth === 2,
    `solution_depth=${made.body.puzzle.solution_depth} (3 plies = 2 moves to find)`
  );
  await api('POST', `/api/puzzles/${id}/publish`, { as: CREATOR, body: { publish: true } });

  // --- first move: right, but not finished ---------------------------------
  const step1 = await api('POST', `/api/puzzles/${id}/solve`, { as: SOLVER, body: { moves: [M1] } });
  check('a correct first move is not a solve', step1.status === 200 && step1.body.solved === false,
    JSON.stringify(step1.body).slice(0, 160));
  check('it comes back as "continue"', step1.body?.status === 'continue', `status=${step1.body?.status}`);
  check(
    'the opponent\'s scripted reply is returned',
    JSON.stringify(step1.body?.reply?.to) === JSON.stringify(R1.to),
    JSON.stringify(step1.body?.reply)
  );
  check('the rest of the line is still hidden', step1.body?.solution === undefined, 'solution leaked mid-line');
  check('progress is reported', step1.body?.movesPlayed === 1 && step1.body?.movesTotal === 2,
    `${step1.body?.movesPlayed}/${step1.body?.movesTotal}`);

  // --- a wrong second move leaves the puzzle unsolved -----------------------
  const off = await api('POST', `/api/puzzles/${id}/solve`, { as: SOLVER, body: { moves: [M1, WRONG] } });
  check('a wrong second move does not solve it', off.body?.solved === false && off.body?.status === 'wrong',
    JSON.stringify(off.body).slice(0, 160));
  check('and still does not reveal the line', off.body?.solution === undefined, 'solution leaked on a wrong move');

  // --- the whole line ------------------------------------------------------
  const done = await api('POST', `/api/puzzles/${id}/solve`, { as: SOLVER, body: { moves: [M1, M2] } });
  check('playing the whole line solves it', done.body?.solved === true, JSON.stringify(done.body).slice(0, 160));
  check('the full line comes back once solved', Array.isArray(done.body?.solution) && done.body.solution.length === 3,
    `${done.body?.solution?.length} plies`);

  // --- partial credit ------------------------------------------------------
  // One solver finds the first of two moves and stops; another misses at once.
  // Both lose rating - half a puzzle is not a solve - but stopping half way has
  // to cost less than not starting, or partial credit means nothing.
  const half = await api('POST', `/api/puzzles/${id}/solve`, { as: QUITTER, body: { moves: [M1] } });
  const none = await api('POST', `/api/puzzles/${id}/solve`, { as: MISSER, body: { moves: [WRONG] } });
  const halfDelta = half.body?.rating?.delta;
  const noneDelta = none.body?.rating?.delta;
  check('half a line is scored as half', half.body?.rating?.score === 0.5, `score=${half.body?.rating?.score}`);
  check('a first-move miss scores zero', none.body?.rating?.score === 0, `score=${none.body?.rating?.score}`);
  check(
    'getting half way costs less than missing entirely',
    Number.isFinite(halfDelta) && Number.isFinite(noneDelta) && halfDelta > noneDelta,
    `half=${halfDelta} none=${noneDelta}`
  );

  // Finishing the line afterwards corrects the rating rather than stacking on
  // top of the partial one: it is still the same first attempt.
  const finish = await api('POST', `/api/puzzles/${id}/solve`, { as: QUITTER, body: { moves: [M1, M2] } });
  check('finishing later turns the partial credit into a gain',
    finish.body?.solved === true && finish.body?.rating?.delta > 0,
    JSON.stringify(finish.body?.rating));
  check('and it is still scored from where the attempt started',
    finish.body?.rating?.before === half.body?.rating?.before,
    `${half.body?.rating?.before} -> ${finish.body?.rating?.before}`);

  // --- the cap -------------------------------------------------------------
  const tooLong = await api('POST', `/api/game-types/${GAME_TYPE_ID}/puzzles`, {
    as: CREATOR,
    body: {
      title: 'Far too long', position: POSITION, side_to_move: 1,
      goal: 'win_material', goal_description: 'Win the rook',
      solution_line: Array.from({ length: 17 }, () => M1),
    },
  });
  check('a line longer than 8 moves a side is refused', tooLong.status === 400,
    `${tooLong.status} ${JSON.stringify(tooLong.body).slice(0, 120)}`);

  await api('DELETE', `/api/puzzles/${id}`, { as: CREATOR });
}

function report() {
  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail || ''}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); report(); });
