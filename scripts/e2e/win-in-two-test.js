/*
 * Win-in-two search (server/puzzle-search.js), and the validator's use of it.
 * In-process against the real move engine; reads a game type and piece rows,
 * writes nothing.
 *
 *   node scripts/e2e/win-in-two-test.js
 *
 * The position is a rook ladder on Capablanca's 10x8 board, small enough to
 * work out by hand:
 *
 *   black king e7 (4,1); white rooks j6 (9,2) and a3 (0,5); white king j1 (9,7)
 *
 * The j6 rook seals the 6th rank. Ra3-a7+ checks along the 7th, the king has
 * to drop to the 8th (the 6th is sealed), and Rj6-j8 is mate. Rj6-j7+ is NOT
 * forced: it unseals the 6th and the king steps up. Nothing mates in one.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { validatePuzzle, moveKey, GOALS, VALIDATION } = require('../../server/puzzle-validation');
const { searchWinInTwo } = require('../../server/puzzle-search');
const dbHelpers = require('../../server/db-helpers');

const GAME_TYPE_ID = parseInt(process.env.TEST_GAME_TYPE_ID || '18', 10); // Capablanca 10x8

const at = (proto, id, x, y, player) => ({ ...proto, id, x, y, player_id: player, team: player });

async function loadPieceProtos() {
  // Same merge as puzzle-validation-test.js: the royal flags live on the junction.
  const rows = await dbHelpers.query(
    `SELECT p.*, gtp.ends_game_on_checkmate, gtp.ends_game_on_capture
     FROM game_type_pieces gtp JOIN pieces p ON p.id = gtp.piece_id
     WHERE gtp.game_type_id = ?`, [GAME_TYPE_ID]
  );
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
    for (const [from, to] of Object.entries(RENAMES)) if (r[from] !== undefined) mapped[to] = r[from];
    byName[(r.piece_name || '').toLowerCase()] = mapped;
  }
  return byName;
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });
const k = (m) => (m ? `${m.from?.x},${m.from?.y}>${m.to?.x},${m.to?.y}` : '-');

async function main() {
  const [gameType] = await dbHelpers.query('SELECT * FROM game_types WHERE id = ?', [GAME_TYPE_ID]);
  if (!gameType) throw new Error(`game type ${GAME_TYPE_ID} not found`);
  const protos = await loadPieceProtos();
  const { king, rook } = protos;
  if (!king || !rook) throw new Error(`need King and Rook in game type ${GAME_TYPE_ID}`);

  const ladder = {
    goal: GOALS.CHECKMATE_IN_1,
    side_to_move: 1,
    position: [
      at(king, 'bk', 4, 1, 2),
      at(king, 'wk', 9, 7, 1),
      at(rook, 'wr6', 9, 2, 1),
      at(rook, 'wr3', 0, 5, 1),
    ],
  };
  const a7 = { from: { x: 0, y: 5 }, to: { x: 0, y: 1 }, pieceId: 'wr3' };
  const j7 = { from: { x: 9, y: 2 }, to: { x: 9, y: 1 }, pieceId: 'wr6' };
  const kd8 = { from: { x: 4, y: 1 }, to: { x: 4, y: 0 }, pieceId: 'bk' };
  const j8 = { from: { x: 9, y: 2 }, to: { x: 9, y: 0 }, pieceId: 'wr6' };

  // --- 1. The full search ---------------------------------------------------
  const all = await searchWinInTwo(ladder, gameType, { aim: GOALS.CHECKMATE_IN_1 });
  console.log(`  [1] complete=${all.complete} ${all.nodes} nodes ${all.ms}ms; in one: ${all.winsInOne.map(k).join(' ') || '-'}; `
    + `forced in two: ${all.winsInTwo.map((w) => k(w.move)).join(' ') || '-'}`);
  check('the search finishes', all.supported && all.complete, `${all.reason || ''}`);
  check('no mate in one is reported where there is none', all.winsInOne.length === 0, all.winsInOne.map(k).join(' '));
  check('Ra3-a7+ is found as a forced mate in two',
    all.winsInTwo.some((w) => moveKey(w.move) === moveKey(a7)), all.winsInTwo.map((w) => k(w.move)).join(' '));
  check('Rj6-j7+ is not (it unseals the 6th rank)',
    !all.winsInTwo.some((w) => moveKey(w.move) === moveKey(j7)), all.winsInTwo.map((w) => k(w.move)).join(' '));
  const a7Answers = all.winsInTwo.find((w) => moveKey(w.move) === moveKey(a7))?.answers || [];
  check('every king move after Ra3-a7+ has a mating answer',
    a7Answers.length >= 3 && a7Answers.every((a) => a.win), a7Answers.map((a) => `${k(a.reply)}->${k(a.win)}`).join(' '));

  // --- 2. One first move, and the defence that beats it ----------------------
  const one = await searchWinInTwo(ladder, gameType, { aim: GOALS.CHECKMATE_IN_1, firstMove: j7 });
  const escape = one.refuted[0]?.refutation;
  console.log(`  [2] Rj6-j7+ refuted by ${k(escape)}`);
  check('a non-forcing first move is refuted', one.complete && one.winsInTwo.length === 0 && !!escape, JSON.stringify(one.refuted));
  check('by the king stepping onto the unsealed 6th rank', escape && escape.to?.y === 2, k(escape));

  // --- 3. "Win in two" - the general aim finds the same answer ----------------
  const win = await searchWinInTwo(ladder, gameType, { aim: 'win' });
  const keys = (r) => r.winsInTwo.map((w) => moveKey(w.move)).sort().join(' ');
  console.log(`  [3] aim=win forced in two: ${win.winsInTwo.map((w) => k(w.move)).join(' ')}`);
  check("aim 'win' (any win condition) agrees with aim 'checkmate' in a checkmate game", keys(win) === keys(all), `${keys(win)} vs ${keys(all)}`);

  // --- 4. The validator: a two-move line is now checked, not taken on trust --
  const good = await validatePuzzle({ ...ladder, solution_line: [a7, kd8, j8] }, gameType);
  console.log(`  [4] ${good.status}: ${good.detail}`);
  check('a forced mate-in-two line is checked against every defence',
    good.searched && good.intendedWorks && (good.status === VALIDATION.VALID || good.status === VALIDATION.AMBIGUOUS), good.detail);
  check('and it is VALID exactly when it is the only forcing first move',
    (good.status === VALIDATION.VALID) === (all.winsInTwo.length === 1), `${good.status}, ${all.winsInTwo.length} forcing`);

  const bad = await validatePuzzle({
    ...ladder,
    solution_line: [j7, kd8, { from: { x: 0, y: 5 }, to: { x: 0, y: 0 }, pieceId: 'wr3' }],
  }, gameType);
  console.log(`  [5] ${bad.status}: ${bad.detail}`);
  check('a line whose defence was scripted to lose is rejected', bad.status === VALIDATION.UNSOLVABLE && !bad.intendedWorks, bad.detail);
  check('and the creator is told the reply that escapes', !!bad.refutation && /defend with/.test(bad.detail || ''), bad.detail);

  // --- 5. A longer line that walks past a mate in two -------------------------
  const long = await validatePuzzle({
    ...ladder,
    solution_line: [
      { from: { x: 9, y: 7 }, to: { x: 8, y: 7 }, pieceId: 'wk' },   // a waiting move
      { from: { x: 4, y: 1 }, to: { x: 4, y: 0 }, pieceId: 'bk' },
      a7,
      { from: { x: 4, y: 0 }, to: { x: 3, y: 0 }, pieceId: 'bk' },
      j8,
    ],
  }, gameType);
  console.log(`  [6] ${long.status}: ${long.detail}`);
  check('a three-move line is flagged when a mate in two was available', long.quickerWin === true, long.detail);
}

main()
  .then(() => {
    console.log('');
    let passed = 0;
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
      if (!r.ok && r.detail) console.log(`      ${r.detail}`);
      if (r.ok) passed++;
    }
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
