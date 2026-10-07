// The first-move field lists must be the same on the server and in the
// frontend (server/first-move.js, chessus-frontend/src/helpers/firstMove.js):
// a field one side copies and the other does not is a first move the board
// shows and the server refuses, or the reverse. Reads the frontend's copy out
// of its source and compares.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const server = require(path.join(ROOT, 'server/first-move.js'));
const src = fs.readFileSync(path.join(ROOT, 'chessus-frontend/src/helpers/firstMove.js'), 'utf8');
const cjs = src.replace(/export (const|function) /g, '$1 ') + '\nmodule.exports = { FIRST_MOVE_FIELDS, LEGACY_FIRST_MOVE_FIELDS, firstMoveVariant, sanitizeFirstMoveProfile };';
const m = { exports: {} };
new Function('module', 'exports', cjs)(m, m.exports);
const fe = m.exports;
let fail = 0;
const same = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) fail++;
};
same('FIRST_MOVE_FIELDS', server.FIRST_MOVE_FIELDS, fe.FIRST_MOVE_FIELDS);
same('LEGACY_FIRST_MOVE_FIELDS', server.LEGACY_FIRST_MOVE_FIELDS, fe.LEGACY_FIRST_MOVE_FIELDS);
const pawn = { id: 'p', moveCount: 0, up_movement: 1, first_move_profile: JSON.stringify({ up_movement: 2, up_movement_exact: true, ratio_one_movement: 2 }) };
same('firstMoveVariant (unmoved)', server.firstMoveVariant(pawn), fe.firstMoveVariant(pawn));
same('firstMoveVariant (moved)', server.firstMoveVariant({ ...pawn, moveCount: 1 }), fe.firstMoveVariant({ ...pawn, moveCount: 1 }));
same('sanitizeFirstMoveProfile', server.sanitizeFirstMoveProfile({ up_movement: 2, piece_name: 'x', special_scenario_capture: '{}' }), fe.sanitizeFirstMoveProfile({ up_movement: 2, piece_name: 'x', special_scenario_capture: '{}' }));
console.log(`${5 - fail}/5 passed`);
process.exit(fail ? 1 : 0);
