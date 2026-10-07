// Multi-leg paths (server/move-paths.js): the frontend copy must be the same
// code (scripts/sync-move-paths.js writes it), and the classic path pieces
// must reach what they reach. Square counts are from the middle of an empty
// 8x8 board (d4 = x 3, y 4) and were checked by hand / against an independent
// XBetza generator.
//   node scripts/e2e/move-paths-test.js
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const P = require(path.join(ROOT, 'server/move-paths.js'));
const { frontendSource, frontendNow } = require(path.join(ROOT, 'scripts/sync-move-paths.js'));

let fail = 0;
let total = 0;
const ok = (name, cond, extra = '') => {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`);
  if (!cond) fail++;
};

ok('frontend movePaths.js is the server code', frontendNow() === frontendSource(),
  '- run node scripts/sync-move-paths.js');

const board = (pieces = {}, flip = false) => ({
  flip,
  inside: (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8,
  occupant: (x, y) => pieces[`${x},${y}`] || null,
});
const ends = (p, x = 3, y = 4, pieces, flip) => P.pathEnds(P.sanitizePath(p), x, y, board(pieces, flip));
const keys = (list) => new Set(list.map((e) => `${e.x},${e.y}`));

const GRIFFON = { legs: [{ step: [[1, 1]], dist: [1, 1] }, { step: [[1, 0]], dist: [1, null], times: [0, 1], turn: ['fl', 'fr'] }] };
const ROSE = { legs: [{ step: [[2, 1]], dist: [1, 1], times: [1, null], turn: ['fl', 'fr'] }], turning: 'same' };
const CROOKED_B = { legs: [{ step: [[1, 1]], dist: [1, 1], times: [1, null], turn: ['l', 'r'] }], turning: 'alternate' };
const DD = { legs: [{ step: [[2, 0]], dist: [1, null] }] };

ok('griffon reaches 24 squares', ends(GRIFFON).length === 24, ends(GRIFFON).length);
ok('rose reaches 14 squares', ends(ROSE).length === 14, ends(ROSE).length);
ok('crooked bishop reaches 18 squares', ends(CROOKED_B).length === 18, ends(CROOKED_B).length);
ok('dabbaba rider reaches 6 squares', ends(DD).length === 6, ends(DD).length);
// The rose turns either way round, then keeps to it: (2,1) then (2,-1) is (4,0).
ok('rose: two knight steps round the octagon', keys(ends(ROSE, 2, 4)).has('6,4'));
// A piece on the griffon's diagonal step stops the rook leg behind it, and is itself a landing.
const blocked = keys(ends(GRIFFON, 3, 4, { '4,3': 'enemy' }));
ok('griffon: blocked diagonal step is a landing', blocked.has('4,3'));
ok('griffon: nothing beyond a blocked step', !blocked.has('4,2') && !blocked.has('5,3'));
// over: 'any' lets a leg pass the pieces it lands on.
const hopper = { legs: [{ step: [[1, 0]], dist: [1, 3], over: 'any', dirs: [[0, -1]] }] };
ok('over any passes a piece', keys(ends(hopper, 3, 4, { '3,3': 'ally' })).has('3,1'));
ok('over none stops at it', !keys(ends({ ...hopper, legs: [{ ...hopper.legs[0], over: 'none' }] }, 3, 4, { '3,3': 'ally' })).has('3,2'));
ok('a wall is never a landing', !keys(ends(hopper, 3, 4, { '3,3': 'wall' })).has('3,3'));
// Player 2: forward is down.
const fwd = { legs: [{ step: [[1, 0]], dist: [1, 1], dirs: [[0, -1]] }] };
ok('forward is up for player 1', keys(ends(fwd)).has('3,3'));
ok('forward is down for player 2', keys(ends(fwd, 3, 4, {}, true)).has('3,5'));

// Cleaning: out-of-range numbers clamp, unknown fields go, and an optional first leg is not.
const clean = P.sanitizePath({ legs: [{ step: [[9, 1], [0, 0]], dist: [0, 20], times: [0, 3], over: 'x', junk: 1 }] });
ok('sanitize clamps a step to 8', JSON.stringify(clean.legs[0].step) === '[[8,1]]', JSON.stringify(clean.legs[0].step));
ok('sanitize: first leg is never optional', clean.legs[0].times[0] === 1, JSON.stringify(clean.legs[0].times));
ok('sanitize: distances 1-8', JSON.stringify(clean.legs[0].dist) === '[1,8]', JSON.stringify(clean.legs[0].dist));
ok('sanitize: unknown over is none', clean.legs[0].over === 'none');
ok('sanitize drops unknown fields', !('junk' in clean.legs[0]));
ok('parsePaths of junk is empty', P.parsePaths('not json').length === 0 && P.parsePaths(null).length === 0);
ok('pathsField of none is null', P.pathsField('[]') === null);

// Captures by kind: a movement path does not capture unless the piece attacks like it moves.
const piece = { x: 3, y: 4, team: 1, movement_paths: JSON.stringify([fwd]) };
const enemyAhead = { x: 3, y: 3, team: 2 };
const engineBoard = {
  flip: false,
  inside: (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8,
  pieceAt: (x, y) => (x === 3 && y === 3 ? enemyAhead : null),
  isAlly: (p) => p.team === 1,
};
ok('movement path does not capture', P.pathMoves(piece, engineBoard).length === 0);
ok('attacks_like_movement makes it capture', P.pathMoves({ ...piece, attacks_like_movement: 1 }, engineBoard).some((m) => m.capture));
ok('capture path attacks the square', P.pathAttacks({ ...piece, movement_paths: null, capture_paths: JSON.stringify([fwd]) }, 3, 3, engineBoard));
ok('cannot_be_captured is never taken', P.pathMoves({ ...piece, attacks_like_movement: 1 }, { ...engineBoard, pieceAt: (x, y) => (x === 3 && y === 3 ? { ...enemyAhead, cannot_be_captured: 1 } : null) }).length === 0);

console.log(`${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
