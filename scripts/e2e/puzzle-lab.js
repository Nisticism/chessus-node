/*
 * Offline puzzle lab.
 *
 * Loads a game type straight from the database, hydrates a hand-written
 * position the same way the puzzle routes do, and runs it through the REAL
 * validator. Nothing is written anywhere - this exists so a candidate position
 * can be iterated on in a second instead of being created, validated and
 * deleted over HTTP.
 *
 *   node scripts/e2e/puzzle-lab.js            # check every candidate
 *
 * Candidates live in scripts/e2e/capablanca-candidates.js so the seeder and the
 * lab judge exactly the same positions.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const db = require('../../configs/db');
const { validatePuzzle, moveKey } = require('../../server/puzzle-validation');

const ENGINE_FIELD_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};
const toEngineFields = (row) => {
  const out = { ...row };
  for (const [from, to] of Object.entries(ENGINE_FIELD_RENAMES)) {
    if (row?.[from] !== undefined) out[to] = row[from];
  }
  return out;
};

async function main() {
  const { GAME_TYPE_ID, CANDIDATES } = require('./capablanca-candidates');
  const [[gameType]] = await db.query('SELECT * FROM game_types WHERE id = ?', [GAME_TYPE_ID]);
  const [pieceRows] = await db.query(
    `SELECT p.* FROM pieces p JOIN game_type_pieces g ON g.piece_id = p.id WHERE g.game_type_id = ?`,
    [GAME_TYPE_ID]
  );
  const byId = new Map(pieceRows.map((r) => [Number(r.id), toEngineFields(r)]));

  const hydrate = (placements) => placements.map((p) => {
    const def = byId.get(Number(p.piece_id)) || {};
    const player = Number(p.player_id ?? 1);
    return {
      ...def,
      id: `${p.piece_id}_${p.y}_${p.x}`,
      piece_id: p.piece_id,
      x: Number(p.x), y: Number(p.y),
      player_id: player, team: player,
      ends_game_on_checkmate: p.ends_game_on_checkmate ?? false,
      ends_game_on_capture: p.ends_game_on_capture ?? false,
    };
  });

  // A candidate carries either a single move or a whole alternating line.
  const lineOf = (c) => (Array.isArray(c.line) ? c.line : [c.solution]);

  for (const c of CANDIDATES) {
    const puzzle = {
      position: hydrate(c.position),
      side_to_move: c.side_to_move,
      goal: c.goal,
      solution_line: lineOf(c),
    };
    console.log(`
=== ${c.title}`);
    // eslint-disable-next-line no-await-in-loop
    const v = await validatePuzzle(puzzle, gameType);
    console.log(`   status   : ${v.status}`);
    console.log(`   solutions: ${v.solutions.length}${v.solutions.length ? ' -> ' + v.solutions.map(moveKey).join(', ') : ''}`);
    if (v.detail) console.log(`   detail   : ${v.detail}`);

    /*
     * 'win_material' is the creator's word, and the server only checks that the
     * move is legal - so check the claim here instead of trusting my own read of
     * the position. After the move: what does the piece now attack, and can
     * Black simply take it?
     */
    if (c.goal !== 'checkmate_in_1') {
      const { getAllLegalMovesForPlayer, validateAndApplyMove } = require('../../server/game-socket');
      const build = () => ({
        pieces: JSON.parse(JSON.stringify(puzzle.position)), gameType,
        currentTurn: c.side_to_move, status: 'active', moveHistory: [],
        players: [{ id: 'p1', position: 1 }, { id: 'p2', position: 2 }],
        otherGameData: gameType?.other_game_data || {},
      });
      const after = build();
      const line = lineOf(c);
      const other = c.side_to_move === 1 ? 2 : 1;
      for (let i = 0; i < line.length; i++) {
        // The engine gates moves on currentTurn and never advances it itself.
        after.currentTurn = i % 2 === 0 ? c.side_to_move : other;
        // eslint-disable-next-line no-await-in-loop -- strictly sequential.
        const applied = await validateAndApplyMove(after, line[i], { skipTurnCheck: true });
        if (applied && applied.valid === false) {
          console.log(`   !! ply ${i} did not apply: ${applied.reason}`);
          break;
        }
      }
      const to = line[line.length - 1].to;
      const at = (x, y) => after.pieces.find((p) => p.x === x && p.y === y);
      const mover = at(to.x, to.y);

      const whiteNext = getAllLegalMovesForPlayer(after, 1) || [];
      const hits = whiteNext
        .filter((m) => m.from.x === to.x && m.from.y === to.y)
        .map((m) => at(m.to.x, m.to.y))
        .filter((p) => p && Number(p.player_id) === 2)
        .map((p) => `${p.piece_name}@${p.x},${p.y}`);

      const blackReplies = getAllLegalMovesForPlayer(after, 2) || [];
      const recaptures = blackReplies
        .filter((m) => m.to.x === to.x && m.to.y === to.y)
        .map((m) => { const p = at(m.from.x, m.from.y); return p ? `${p.piece_name}@${p.x},${p.y}` : '?'; });

      console.log(`   ${mover?.piece_name} on ${to.x},${to.y} attacks: ${hits.join(', ') || 'nothing'}`);
      console.log(`   Black can take it with: ${recaptures.join(', ') || 'nothing'}`);
      console.log(`   Black replies available: ${blackReplies.length}`);
    }

    if (process.env.LAB_MOVES) {
      const { getAllLegalMovesForPlayer } = require('../../server/game-socket');
      const state = {
        pieces: JSON.parse(JSON.stringify(puzzle.position)), gameType,
        currentTurn: c.side_to_move, status: 'active', moveHistory: [],
        players: [{ id: 'p1', position: 1 }, { id: 'p2', position: 2 }],
        otherGameData: gameType?.other_game_data || {},
      };
      const legal = getAllLegalMovesForPlayer(state, c.side_to_move) || [];
      console.log('   legal    : ' + legal.map(moveKey).join(' '));
    }
  }
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
