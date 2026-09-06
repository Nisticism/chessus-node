/*
 * Capablanca Chess puzzle candidates.
 *
 * Shared by the offline lab (scripts/e2e/puzzle-lab.js) and the seeder
 * (scripts/e2e/seed-capablanca-puzzles.js) so a position is judged by the same
 * validator that later publishes it.
 *
 * Board is 10 wide x 8 tall. x = 0..9 are files a..j; y = 0 is Player 2's back
 * rank and y = 7 is Player 1's, so Player 1's pawns march toward y = 0.
 *
 * These are positions rather than diagrams: each side keeps a plausible pawn
 * structure and enough material that the answer is a tactic somebody could
 * actually reach in a game, not a two-piece study.
 */
const GAME_TYPE_ID = 18;                 // Capablanca Chess, 10x8

const P = { KING: 19, QUEEN: 25, ROOK: 15, BISHOP: 20, KNIGHT: 22, PAWN: 21, ARCHBISHOP: 29, CHANCELLOR: 30 };

// The royal flag is a property of the piece IN THIS GAME TYPE and rides on the
// placement; without it the engine sees no king and nothing is ever mate.
const at = (piece_id, x, y, player_id) => ({
  piece_id, x, y, player_id,
  ends_game_on_checkmate: piece_id === P.KING,
  ends_game_on_capture: false,
});

const w = (piece_id, x, y) => at(piece_id, x, y, 1);
const b = (piece_id, x, y) => at(piece_id, x, y, 2);
/*
 * A piece keeps the id it was given on its STARTING square for the whole game -
 * the engine never renames it - so the second move of the same piece in a line
 * has to quote that original id, not one built from where it now stands. Pass
 * `id` explicitly for those.
 */
const move = (fx, fy, tx, ty, piece_id, id) => ({
  from: { x: fx, y: fy }, to: { x: tx, y: ty }, pieceId: id || `${piece_id}_${fy}_${fx}`,
});

/*
 * A candidate records either a single `solution` move or a whole `line`. A line
 * ALTERNATES, starting with the side to move: [your move, their reply, your
 * move, ...]. The replies are written here rather than searched for - there is
 * no engine for user-defined pieces - so a line is only as forced as its author
 * made it. This one is: every legal Black reply loses the queen, which was
 * checked before it was written down.
 */
const CANDIDATES = [
  {
    title: 'Smothered on the j-file',
    description:
      'Black is a whole queen up and threatening to trade off the attack. The king is safe behind its own pieces - which is exactly the problem.',
    goal: 'checkmate_in_1',
    side_to_move: 1,
    position: [
      // Black: extra material, but a king walled in by its own rook and pawns.
      b(P.KING, 9, 0), b(P.ROOK, 8, 0), b(P.PAWN, 8, 1), b(P.PAWN, 9, 1),
      b(P.QUEEN, 3, 3), b(P.PAWN, 0, 1), b(P.PAWN, 1, 1), b(P.PAWN, 2, 1),
      b(P.BISHOP, 2, 2),
      // White: a knight, a rook holding the centre, and a healthy pawn chain.
      w(P.KING, 5, 7), w(P.KNIGHT, 6, 3), w(P.ROOK, 2, 5),
      w(P.PAWN, 4, 6), w(P.PAWN, 5, 6), w(P.PAWN, 6, 6),
    ],
    solution: move(6, 3, 7, 1, P.KNIGHT),
  },
  {
    title: 'The archbishop closes the net',
    description:
      'Two pawns have driven the king to the edge. The archbishop covers the light squares and the knight squares at the same time - find the square that does both.',
    goal: 'checkmate_in_1',
    side_to_move: 1,
    position: [
      b(P.KING, 9, 1), b(P.ROOK, 9, 0), b(P.QUEEN, 1, 5),
      b(P.PAWN, 0, 1), b(P.PAWN, 1, 1), b(P.PAWN, 2, 2), b(P.KNIGHT, 2, 4),
      w(P.KING, 4, 7), w(P.ARCHBISHOP, 5, 4),
      w(P.PAWN, 7, 3), w(P.PAWN, 8, 3),
      w(P.PAWN, 3, 6), w(P.PAWN, 4, 6),
    ],
    solution: move(5, 4, 7, 2, P.ARCHBISHOP),
  },
  {
    title: 'Chancellor takes the fork',
    description:
      'The chancellor moves like a rook and a knight at once. Black has left the king and queen a knight’s jump apart on an open file.',
    goal: 'win_material',
    goal_description: 'Fork the king and the queen with the chancellor',
    side_to_move: 1,
    position: [
      b(P.KING, 6, 0), b(P.QUEEN, 9, 1), b(P.ROOK, 0, 0),
      b(P.PAWN, 0, 1), b(P.PAWN, 1, 1), b(P.PAWN, 5, 1), b(P.PAWN, 7, 1),
      b(P.KNIGHT, 3, 2), b(P.BISHOP, 2, 1),
      w(P.KING, 5, 7), w(P.CHANCELLOR, 7, 6), w(P.ROOK, 0, 7), w(P.BISHOP, 3, 5),
      w(P.KNIGHT, 2, 4),
      w(P.PAWN, 0, 6), w(P.PAWN, 1, 6), w(P.PAWN, 2, 6), w(P.PAWN, 4, 6), w(P.PAWN, 5, 6),
    ],
    solution: move(7, 6, 7, 2, P.CHANCELLOR),
  },
  {
    title: 'Discovered on the e-file',
    description:
      'The rook is already pointing at the queen. All the archbishop has to do is leave with check.',
    goal: 'win_material',
    goal_description: 'Win the queen with a discovered attack',
    side_to_move: 1,
    position: [
      b(P.KING, 8, 1), b(P.QUEEN, 4, 1), b(P.ROOK, 0, 0),
      b(P.PAWN, 0, 1), b(P.PAWN, 1, 1), b(P.PAWN, 9, 2), b(P.KNIGHT, 2, 3),
      b(P.BISHOP, 1, 2),
      w(P.KING, 5, 7), w(P.ROOK, 4, 7), w(P.ARCHBISHOP, 4, 4),
      w(P.PAWN, 2, 6), w(P.PAWN, 3, 6), w(P.PAWN, 6, 6), w(P.PAWN, 7, 6),
    ],
    solution: move(4, 4, 6, 2, P.ARCHBISHOP),
  },
  {
    title: 'Archbishop hits both',
    description:
      'A bishop and a knight in one piece. One square attacks the king and the rook together.',
    goal: 'win_material',
    goal_description: 'Fork the king and the rook with the archbishop',
    side_to_move: 1,
    position: [
      b(P.KING, 8, 0), b(P.ROOK, 3, 4), b(P.QUEEN, 0, 3),
      b(P.PAWN, 8, 2), b(P.PAWN, 9, 2), b(P.PAWN, 0, 2), b(P.PAWN, 1, 2),
      b(P.KNIGHT, 2, 5),
      w(P.KING, 5, 7), w(P.ARCHBISHOP, 9, 4), w(P.ROOK, 1, 7),
      w(P.PAWN, 4, 6), w(P.PAWN, 5, 6), w(P.PAWN, 6, 6), w(P.PAWN, 7, 6),
    ],
    solution: move(9, 4, 6, 1, P.ARCHBISHOP),
  },
  {
    title: 'Win the queen in two',
    description:
      'The chancellor forks the king and queen. Black has three legal answers and all of them lose the queen - play the fork, then take what it wins.',
    goal: 'win_material',
    goal_description: 'Fork with the chancellor, then take the queen',
    side_to_move: 1,
    position: [
      b(P.KING, 6, 0), b(P.QUEEN, 9, 1), b(P.ROOK, 0, 0),
      b(P.PAWN, 0, 1), b(P.PAWN, 1, 1), b(P.PAWN, 5, 1), b(P.PAWN, 7, 1),
      b(P.KNIGHT, 3, 2), b(P.BISHOP, 2, 1),
      w(P.KING, 5, 7), w(P.CHANCELLOR, 7, 6), w(P.ROOK, 0, 7), w(P.BISHOP, 3, 5),
      w(P.KNIGHT, 2, 4),
      w(P.PAWN, 0, 6), w(P.PAWN, 1, 6), w(P.PAWN, 2, 6), w(P.PAWN, 4, 6), w(P.PAWN, 5, 6),
    ],
    line: [
      move(7, 6, 7, 2, P.CHANCELLOR),   // the fork, with check
      move(6, 0, 7, 0, P.KING),         // Black steps aside - any square does
      // Still the chancellor that started on (7,6), so it keeps that id.
      move(7, 2, 9, 1, P.CHANCELLOR, `${P.CHANCELLOR}_6_7`),   // and the queen goes
    ],
  },
];

module.exports = { GAME_TYPE_ID, CANDIDATES, P };
