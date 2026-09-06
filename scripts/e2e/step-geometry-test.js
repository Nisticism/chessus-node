/*
 * Step-by-step geometry: excluding diagonal vs excluding orthogonal steps.
 *
 * Runs in-process against the real move engine, and against the client engine's
 * copy of the same rule, so the two cannot drift apart unnoticed. No server, no
 * database writes - it only reads a game type to get a board size.
 *
 *   node scripts/e2e/step-geometry-test.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { getPossibleMovesForPiece } = require('../../server/game-socket');
const dbHelpers = require('../../server/db-helpers');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10);

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

/** A bare step piece: no directional, ratio or custom movement of any kind. */
const stepPiece = (overrides) => ({
  id: 'sp', piece_id: 1, piece_name: 'Stepper',
  x: 4, y: 4, player_id: 1, team: 1,
  piece_width: 1, piece_height: 1,
  step_by_step_movement_value: 1,
  ...overrides,
});

const squares = (moves) => new Set(moves.map((m) => `${m.x},${m.y}`));

async function main() {
  const [gameType] = await dbHelpers.query('SELECT * FROM game_types WHERE id = ?', [GAME_TYPE_ID]);
  if (!gameType) throw new Error(`game type ${GAME_TYPE_ID} not found`);
  const gt = { ...gameType, board_width: 10, board_height: 8 };

  const from = { x: 4, y: 4 };
  const ORTHOGONAL = ['4,3', '4,5', '3,4', '5,4'];
  const DIAGONAL = ['3,3', '5,3', '3,5', '5,5'];

  // --- 1. the default: a king's eight neighbours ---------------------------
  const all = squares(getPossibleMovesForPiece(stepPiece({}), [], gt, 1) || []);
  check('a 1-step piece reaches all eight neighbours',
    ORTHOGONAL.every((s) => all.has(s)) && DIAGONAL.every((s) => all.has(s)),
    [...all].join(' '));

  // --- 2. excluding diagonal (the negative value, unchanged behaviour) -----
  const noDiag = squares(getPossibleMovesForPiece(
    stepPiece({ step_by_step_movement_value: -1 }), [], gt, 1) || []);
  check('excluding diagonal leaves only the four orthogonal squares',
    ORTHOGONAL.every((s) => noDiag.has(s)) && !DIAGONAL.some((s) => noDiag.has(s)),
    [...noDiag].join(' '));

  // --- 3. excluding orthogonal (the new flag) ------------------------------
  const noOrth = squares(getPossibleMovesForPiece(
    stepPiece({ step_by_step_movement_no_orthogonal: 1 }), [], gt, 1) || []);
  check('excluding orthogonal leaves only the four diagonal squares',
    DIAGONAL.every((s) => noOrth.has(s)) && !ORTHOGONAL.some((s) => noOrth.has(s)),
    [...noOrth].join(' '));

  // --- 4. the renamed field name reaches the engine too --------------------
  const renamed = squares(getPossibleMovesForPiece(
    { ...stepPiece({}), step_movement_no_orthogonal: 1 }, [], gt, 1) || []);
  check('the engine-side field name works as well as the column name',
    DIAGONAL.every((s) => renamed.has(s)) && !ORTHOGONAL.some((s) => renamed.has(s)),
    [...renamed].join(' '));

  // --- 5. two diagonal steps: parity, not just distance --------------------
  // A diagonal step moves x and y together, so the piece never leaves squares
  // of its own colour: dx+dy stays even however many steps it takes. Squares an
  // odd distance away are unreachable at ANY range, which is the property worth
  // pinning down - it is what makes this different from simply "fewer moves".
  const noOrth2 = squares(getPossibleMovesForPiece(
    stepPiece({ step_by_step_movement_value: 2, step_by_step_movement_no_orthogonal: 1 }), [], gt, 1) || []);
  check('two diagonal steps reach the far diagonal', noOrth2.has('2,2') && noOrth2.has('6,6'),
    [...noOrth2].join(' '));
  check('no odd-parity square is reachable, however many steps',
    !['4,5', '5,4', '4,3', '3,4', '6,5', '5,6'].some((s) => noOrth2.has(s)),
    [...noOrth2].join(' '));
  // Two diagonal steps that zig-zag land back on a rank or file - the piece is
  // still colour-bound, it just gets there the long way.
  check('but zig-zagging two steps does reach same-colour squares in a straight line',
    noOrth2.has('4,6') && noOrth2.has('2,4') && noOrth2.has('6,4'),
    [...noOrth2].join(' '));

  // --- 6. blocked squares still block --------------------------------------
  const blocker = { id: 'b', x: 5, y: 5, player_id: 1, team: 1, piece_width: 1, piece_height: 1 };
  const blocked = squares(getPossibleMovesForPiece(
    stepPiece({ step_by_step_movement_value: 2, step_by_step_movement_no_orthogonal: 1 }),
    [blocker], gt, 1) || []);
  check('a friendly piece on the diagonal blocks the square it stands on',
    !blocked.has('5,5'), [...blocked].join(' '));
  check('and blocks what lay behind it',
    !blocked.has('6,6'), [...blocked].join(' '));

  // --- 7. the bot's valuation sees the restriction too ---------------------
  // getPieceValue scores a piece by how much board it covers. The AI keeps its
  // own faster generator for that, so if it ignored the flag a diagonal-only
  // stepper would be valued as though it still had all eight neighbours.
  const { getPieceValue } = require('../../server/ai/ai-engine');
  const valueAll = getPieceValue(stepPiece({}), 8);
  const valueDiagOnly = getPieceValue(stepPiece({ step_by_step_movement_no_orthogonal: 1 }), 8);
  const valueOrthOnly = getPieceValue(stepPiece({ step_by_step_movement_value: -1 }), 8);
  check('the bot values a diagonal-only stepper below an unrestricted one',
    valueDiagOnly < valueAll, `all=${valueAll} diagonalOnly=${valueDiagOnly}`);
  // The two restrictions are mirror images and cost about the same, but not
  // exactly: the bot weights squares by how much board they open up, and the
  // four orthogonal neighbours score a shade higher than the four diagonal ones.
  // What matters is that both are close to each other and far below unrestricted.
  check('and values it near the orthogonal-only mirror image, not near the unrestricted one',
    Math.abs(valueDiagOnly - valueOrthOnly) < (valueAll - valueOrthOnly),
    `all=${valueAll} orthogonal=${valueOrthOnly} diagonal=${valueDiagOnly}`);

  // --- 8. the client engine agrees -----------------------------------------
  // Both engines implement the same rule; a divergence here is a bug that would
  // show up as hover dots disagreeing with what the server allows.
  const { stepInRange } = requireClientEngine();
  const cases = [
    [1, 1, 1, false, true, true],    // one diagonal step, diagonal-only: yes
    [1, 0, 1, false, true, false],   // one orthogonal step, diagonal-only: no
    [0, 2, 2, false, true, true],    // two diagonal steps in a line: yes
    [1, 2, 2, false, true, false],   // wrong colour: no however many steps
    [1, 0, 1, true, false, true],    // orthogonal-only still works
    [1, 1, 2, true, false, true],    // ...and reaches diagonals in two steps
  ];
  const mismatches = cases.filter(([dx, dy, max, nd, no, want]) =>
    stepInRange(dx, dy, max, nd, no) !== want);
  check('the client engine matches the server rule', mismatches.length === 0,
    JSON.stringify(mismatches));

  report();
}

/** Pull stepInRange out of the client engine, which is an ES module. */
function requireClientEngine() {
  const fs = require('fs');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'chessus-frontend', 'src', 'helpers', 'moveEngine.js'), 'utf8');
  const start = src.indexOf('export const stepInRange');
  const end = src.indexOf('};', start) + 2;
  const body = src.slice(start, end).replace('export const', 'const');
  // eslint-disable-next-line no-new-func -- reading the real source is the point:
  // a copy of the rule here would defeat the comparison.
  return { stepInRange: new Function(`${body}; return stepInRange;`)() };
}

function report() {
  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail || ''}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); report(); });
