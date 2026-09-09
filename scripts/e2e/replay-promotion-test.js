/*
 * A promoted piece must move like what it became, in a replay as well as live.
 *
 * The bug: a promotion record on a move carries only piece_id, name and images,
 * and the replay applied only those. The piece therefore kept its ORIGINAL
 * movement while showing the promoted piece's picture - so hovering a promoted
 * pawn on the review board showed a pawn's moves, or nothing at all, because a
 * pawn on the last rank has none left. Live play was always correct; the server
 * swaps the whole definition.
 *
 *   node scripts/e2e/replay-promotion-test.js
 *
 * Runs the REAL replay helper out of the frontend source, so it cannot pass
 * against a copy of the logic that has drifted from what the app runs.
 */
const path = require('path');
const fs = require('fs');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

/* The helper is an ES module; transpile the one export we need. */
function loadReplay() {
  const file = path.join(__dirname, '..', '..', 'chessus-frontend', 'src', 'helpers', 'pieceMovementUtils.js');
  const src = fs.readFileSync(file, 'utf8');

  const start = src.indexOf('const PROMOTION_PRESERVED_KEYS');
  const endMarker = '\nexport const ';
  const replayStart = src.indexOf('export const replayToMove');
  let end = src.indexOf(endMarker, replayStart + 10);
  if (end === -1) end = src.length;

  const body = src.slice(start, end).replace(/export const/g, 'const');
  // eslint-disable-next-line no-new-func -- reading the real source is the point.
  return new Function(`${body}; return replayToMove;`)();
}

const PAWN = {
  id: 'p1', piece_id: 21, piece_name: 'Pawn', x: 4, y: 1, player_id: 1, team: 1,
  up_movement: 1, down_movement: 0, left_movement: 0, right_movement: 0,
  up_left_movement: 0, up_right_movement: 0, down_left_movement: 0, down_right_movement: 0,
  ratio_one_movement: 0, ratio_two_movement: 0,
};

/* What it becomes: a rook, sliding in all four orthogonals. */
const ROOK_DEFINITION = {
  piece_id: 15, piece_name: 'Rook',
  up_movement: 99, down_movement: 99, left_movement: 99, right_movement: 99,
  up_left_movement: 0, up_right_movement: 0, down_left_movement: 0, down_right_movement: 0,
  ratio_one_movement: 0, ratio_two_movement: 0,
  can_hop_over_allies: 1,
};

const movesLikeRook = (piece) => piece
  && Number(piece.up_movement) === 99 && Number(piece.down_movement) === 99
  && Number(piece.left_movement) === 99 && Number(piece.right_movement) === 99;

function main() {
  const replayToMove = loadReplay();

  const initialPieces = [PAWN];
  const moveHistory = [{
    pieceId: 'p1',
    from: { x: 4, y: 1 }, to: { x: 4, y: 0 },
    promotion: { piece_id: 15, piece_name: 'Rook', image_url: '/uploads/rook.png' },
  }];

  // --- 1. an old game: the record has labels only ---------------------------
  // The final board still holds the piece, in full, which is where the replay
  // has to get the definition from.
  const finalBoard = [{ ...PAWN, ...ROOK_DEFINITION, x: 4, y: 0 }];
  const replayed = replayToMove(initialPieces, moveHistory, 0, finalBoard);
  const promoted = replayed.find((p) => p.id === 'p1');

  check('the promoted piece is renamed', promoted?.piece_name === 'Rook', promoted?.piece_name);
  check('the promoted piece keeps its square',
    promoted?.x === 4 && promoted?.y === 0, `${promoted?.x},${promoted?.y}`);
  check('and it MOVES like what it became', movesLikeRook(promoted),
    `up=${promoted?.up_movement} down=${promoted?.down_movement} left=${promoted?.left_movement} right=${promoted?.right_movement}`);
  check('it keeps its board identity and side',
    promoted?.id === 'p1' && Number(promoted?.player_id) === 1,
    `${promoted?.id} / ${promoted?.player_id}`);

  // --- 2. a new game: the record carries the definition ----------------------
  // No final board at all: the move record has to be enough on its own, which
  // is what matters for a piece that promotes and is then captured.
  const stamped = [{
    pieceId: 'p1',
    from: { x: 4, y: 1 }, to: { x: 4, y: 0 },
    promotion: {
      piece_id: 15, piece_name: 'Rook', image_url: '/uploads/rook.png',
      definition: { ...ROOK_DEFINITION },
    },
  }];
  const fromStamp = replayToMove(initialPieces, stamped, 0, null).find((p) => p.id === 'p1');
  check('a stamped record needs no other board to replay correctly',
    movesLikeRook(fromStamp), `up=${fromStamp?.up_movement} right=${fromStamp?.right_movement}`);

  // --- 3. before the promoting move, it is still a pawn ----------------------
  const before = replayToMove(initialPieces, moveHistory, -1, finalBoard).find((p) => p.id === 'p1');
  check('and before it promotes it is still the original piece',
    Number(before?.up_movement) === 1 && before?.piece_name === 'Pawn',
    `${before?.piece_name} up=${before?.up_movement}`);

  // --- 4. the same-type fallback --------------------------------------------
  // The promoted piece was captured later, so it is not in the final board -
  // but another rook is, and one rook defines another.
  const boardWithSibling = [{ ...PAWN, ...ROOK_DEFINITION, id: 'other', x: 0, y: 7 }];
  const viaSibling = replayToMove(initialPieces, moveHistory, 0, boardWithSibling).find((p) => p.id === 'p1');
  check('a piece captured after promoting still replays from another of its type',
    movesLikeRook(viaSibling), `up=${viaSibling?.up_movement} right=${viaSibling?.right_movement}`);

  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail || ''}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
