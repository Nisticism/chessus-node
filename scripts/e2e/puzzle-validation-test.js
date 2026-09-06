/*
 * Puzzle validator checks. Runs in-process against the real move engine - no
 * server, no sockets, no database writes (it only reads a game type and some
 * piece definitions to build positions from).
 *
 *   node scripts/e2e/puzzle-validation-test.js
 *
 * Positions are built from real piece rows so the engine sees exactly what it
 * would see in a live game.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { validatePuzzle, moveKey, GOALS, VALIDATION } = require('../../server/puzzle-validation');
const dbHelpers = require('../../server/db-helpers');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10); // Capablanca 10x8

// Board coordinates: y = 0 is the far rank, y grows downward toward player 1.
const at = (proto, id, x, y, player) => ({
  ...proto,
  id,
  x,
  y,
  player_id: player,
  team: player,
});

async function loadPieceProtos(gameType) {
  // Piece rows carry the movement columns, but the flags that make a piece
  // ROYAL (ends_game_on_checkmate / ends_game_on_capture) live on the junction
  // table - they are a property of the piece *in this game type*, not of the
  // piece itself. checkForCheck() looks for ends_game_on_checkmate on the piece
  // object, so a position built from `pieces` alone has no king in it and
  // nothing can ever be mate. A puzzle's stored position must be merged the
  // same way.
  const rows = await dbHelpers.query(
    `SELECT p.*, gtp.ends_game_on_checkmate, gtp.ends_game_on_capture
     FROM game_type_pieces gtp
     JOIN pieces p ON p.id = gtp.piece_id
     WHERE gtp.game_type_id = ?`, [GAME_TYPE_ID]
  );
  // The engine reads different names for a few fields than the table uses; see
  // ENGINE_FIELD_RENAMES in puzzle-routes.js. Without this a ratio piece (any
  // knight) generates no moves at all and fails silently.
  const RENAMES = {
    ratio_one_movement: 'ratio_movement_1', ratio_two_movement: 'ratio_movement_2',
    ratio_one_capture: 'ratio_capture_1', ratio_two_capture: 'ratio_capture_2',
    step_by_step_movement_value: 'step_movement_value',
    step_by_step_movement_style: 'step_movement_style',
    step_by_step_capture: 'step_capture_value',
  };
  const byName = {};
  for (const r of rows) {
    const mapped = { ...r };
    for (const [from, to] of Object.entries(RENAMES)) {
      if (r[from] !== undefined) mapped[to] = r[from];
    }
    byName[(r.piece_name || '').toLowerCase()] = mapped;
  }
  return byName;
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

async function main() {
  const [gameType] = await dbHelpers.query('SELECT * FROM game_types WHERE id = ?', [GAME_TYPE_ID]);
  if (!gameType) throw new Error(`game type ${GAME_TYPE_ID} not found`);

  const protos = await loadPieceProtos(gameType);
  const king = protos['king'];
  const queen = protos['queen'];
  const rook = protos['rook'];
  if (!king || !queen || !rook) {
    throw new Error(`need King/Queen/Rook in game type ${GAME_TYPE_ID}; found: ${Object.keys(protos).join(', ')}`);
  }

  // --- 1. A position with exactly one mate ---------------------------------
  // Black king cornered at a8 (0,0). White king at c7 (2,1) covers b8 and b7.
  // White queen on b1 (1,7) has a clear b-file run to b8 (1,0), which is mate:
  // defended by the white king, and it seals a7.
  const oneMate = {
    goal: GOALS.CHECKMATE_IN_1,
    side_to_move: 1,
    position: [
      at(king, 'bk', 0, 0, 2),
      at(king, 'wk', 2, 1, 1),
      at(queen, 'wq', 1, 7, 1),
    ],
    solution_line: [{ from: { x: 1, y: 7 }, to: { x: 1, y: 0 }, pieceId: 'wq' }],
  };

  const r1 = await validatePuzzle(oneMate, gameType);
  console.log(`  [1] status=${r1.status} solutions=${r1.solutions.length} -> ${r1.solutions.map(moveKey).join(' ') || 'none'}`);
  check('a mate-in-1 position is found at all', r1.solutions.length > 0, r1.detail);
  check('the intended move is among the solutions', r1.intendedWorks, r1.detail);

  // --- 2. Ambiguity is detected, not assumed -------------------------------
  // Same position plus a second white queen that can also mate on b8's file.
  // If the validator only checked the creator's move this would still read as
  // valid, which is the failure mode the whole module exists to prevent.
  const twoMates = {
    ...oneMate,
    position: [...oneMate.position, at(queen, 'wq2', 5, 0, 1)],
  };
  const r2 = await validatePuzzle(twoMates, gameType);
  console.log(`  [2] status=${r2.status} solutions=${r2.solutions.length} -> ${r2.solutions.map(moveKey).join(' ') || 'none'}`);
  check(
    'a second mating move makes the puzzle ambiguous',
    r2.solutions.length > r1.solutions.length && r2.status === VALIDATION.AMBIGUOUS,
    `${r1.solutions.length} -> ${r2.solutions.length} solutions; status ${r2.status}; ${r2.detail || ''}`
  );

  // --- 3. No mate available -> unsolvable ----------------------------------
  const noMate = {
    goal: GOALS.CHECKMATE_IN_1,
    side_to_move: 1,
    position: [
      at(king, 'bk', 4, 0, 2),
      at(king, 'wk', 4, 7, 1),
      at(rook, 'wr', 9, 7, 1),
    ],
    solution_line: [{ from: { x: 9, y: 7 }, to: { x: 9, y: 0 }, pieceId: 'wr' }],
  };
  const r3 = await validatePuzzle(noMate, gameType);
  console.log(`  [3] status=${r3.status} solutions=${r3.solutions.length}`);
  check('a position with no mate is unsolvable', r3.status === VALIDATION.UNSOLVABLE, r3.detail);

  // --- 4. A wrong recorded solution is rejected ----------------------------
  const wrongSolution = {
    ...oneMate,
    solution_line: [{ from: { x: 2, y: 1 }, to: { x: 2, y: 2 }, pieceId: 'wk' }], // king shuffle
  };
  const r4 = await validatePuzzle(wrongSolution, gameType);
  console.log(`  [4] status=${r4.status} intendedWorks=${r4.intendedWorks}`);
  check(
    'a recorded solution that does not mate is rejected',
    !r4.intendedWorks && r4.status === VALIDATION.UNSOLVABLE,
    r4.detail
  );

  // --- 5. Exactly one solution -> valid ------------------------------------
  // Rook mate with the black king cornered at a8 (0,0) and the white king on a6
  // (0,2) sealing a7/b7/b6. Only Rh1-h8 reaches the back rank, so the rook has
  // one mate and the king has none. This is the branch that lets a puzzle be
  // published, so it needs a case of its own - position [1] turned out to have
  // four mates, which is the whole reason the validator exists.
  const uniqueMate = {
    goal: GOALS.CHECKMATE_IN_1,
    side_to_move: 1,
    position: [
      at(king, 'bk', 0, 0, 2),
      at(king, 'wk', 0, 2, 1),
      at(rook, 'wr', 9, 7, 1),
    ],
    solution_line: [{ from: { x: 9, y: 7 }, to: { x: 9, y: 0 }, pieceId: 'wr' }],
  };
  const r5 = await validatePuzzle(uniqueMate, gameType);
  console.log(`  [5] status=${r5.status} solutions=${r5.solutions.length} -> ${r5.solutions.map(moveKey).join(' ') || 'none'}`);
  check(
    'a position with exactly one mate validates as publishable',
    r5.status === VALIDATION.VALID && r5.solutions.length === 1 && r5.intendedWorks,
    `status ${r5.status}, ${r5.solutions.length} solution(s): ${r5.solutions.map(moveKey).join(' ')}`
  );

  // --- 6. Non-mate goals are the creator's call ----------------------------
  // A material-winning puzzle cannot be scored by the server, so it comes back
  // not_checkable rather than being wrongly failed - but an answer that is not
  // even a legal move is still caught.
  const materialPuzzle = {
    goal: GOALS.WIN_MATERIAL,
    goal_description: 'Win the rook',
    side_to_move: 1,
    position: [
      at(king, 'bk', 0, 0, 2),
      at(king, 'wk', 0, 2, 1),
      at(rook, 'wr', 9, 7, 1),
    ],
    solution_line: [{ from: { x: 9, y: 7 }, to: { x: 9, y: 4 }, pieceId: 'wr' }],
  };
  const r6 = await validatePuzzle(materialPuzzle, gameType);
  console.log(`  [6] status=${r6.status} intendedWorks=${r6.intendedWorks}`);
  check(
    'a win-material puzzle is accepted as not_checkable, not failed',
    r6.status === VALIDATION.NOT_CHECKABLE && r6.intendedWorks,
    `status ${r6.status}: ${r6.detail}`
  );

  const materialIllegal = {
    ...materialPuzzle,
    solution_line: [{ from: { x: 9, y: 7 }, to: { x: 4, y: 4 }, pieceId: 'wr' }], // rooks do not move diagonally
  };
  const r7 = await validatePuzzle(materialIllegal, gameType);
  console.log(`  [7] status=${r7.status} intendedWorks=${r7.intendedWorks}`);
  check(
    'an illegal answer is caught even for goals the server cannot score',
    r7.status === VALIDATION.UNSOLVABLE && !r7.intendedWorks,
    `status ${r7.status}: ${r7.detail}`
  );

  console.log('');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail || ''}`}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
