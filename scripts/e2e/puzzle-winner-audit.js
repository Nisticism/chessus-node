/*
 * Does every puzzle's solution win for the side you PLAY as?
 *
 *   node scripts/e2e/puzzle-winner-audit.js
 *
 * A puzzle says "you are player N, find the move". Nothing until now checked
 * that the move it wants produces a win for player N rather than for their
 * opponent - every goal describes a thing to DO, and none of them asked who
 * ends up winning.
 *
 * That is fine until a game inverts an outcome. Antichess is the case that
 * found it: "stalemate the opponent" is satisfied exactly by stalemating them,
 * and in a game where the STALEMATED player wins, doing so hands them the
 * game. The solver is congratulated while looking at a loss.
 *
 * It went unnoticed because checkWinCondition does not decide stalemate -
 * that lives in the live game's move handler - so the position came back as
 * "game continues" and nothing further was asked. This uses terminalOutcome,
 * which mirrors the handler's own order of rules.
 *
 * Reports rather than changes anything. Reads the database directly, so it
 * does not need the server running.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db_pool = require('../../configs/db');
const { buildGameState, applyPly, terminalOutcome } = require('../../server/puzzle-validation');
const { rulesForPuzzle } = require('../../server/puzzle-snapshot');
const { hydratePosition } = require('../../server/puzzle-hydrate');

const safe = (v, fallback = null) => {
  try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fallback); } catch { return fallback; }
};
const other = (side) => (Number(side) === 1 ? 2 : 1);

async function main() {
  const draftsToo = process.argv.includes('--drafts');
  const [rows] = await db_pool.query(
    `SELECT p.id, p.title, p.goal, p.side_to_move, p.position, p.setup_move, p.solution_line,
            p.game_type_id, p.is_draft, gt.game_name
     FROM puzzles p JOIN game_types gt ON gt.id = p.game_type_id
     ${draftsToo ? '' : 'WHERE p.is_draft = 0'}
     ORDER BY p.id`
  );
  console.log(`Checking ${rows.length} puzzle(s)${draftsToo ? ' (drafts included)' : ''}.\n`);

  const wrongSide = [];
  const drawn = [];
  let unplayable = 0;

  for (const puzzle of rows) {
    const line = safe(puzzle.solution_line, []) || [];
    if (!line.length) continue;

    let state;
    try {
      const rules = await rulesForPuzzle(db_pool, puzzle);
      state = buildGameState({
        position: await hydratePosition(rules, safe(puzzle.position, [])),
        side_to_move: puzzle.side_to_move,
        setup_move: safe(puzzle.setup_move),
        game_type_id: puzzle.game_type_id,
      }, rules.game);
    } catch (err) {
      unplayable++;
      continue;
    }

    // Play the line, alternating sides from the one the solver plays.
    let side = Number(puzzle.side_to_move);
    let ctx = null;
    let played = true;
    for (const ply of line) {
      state.currentTurn = side;
      // eslint-disable-next-line no-await-in-loop -- the engine mutates shared
      // structures, so these must not overlap.
      const res = await applyPly(state, ply, { autoPromote: true });
      if (!res.ok) { played = false; break; }
      ctx = res;
      side = other(side);
    }
    if (!played) { unplayable++; continue; }

    // `side` is now whoever is to move after the whole line.
    const outcome = terminalOutcome(state, side, ctx);
    if (!outcome) continue;

    const you = Number(puzzle.side_to_move);
    const row = {
      id: puzzle.id,
      title: puzzle.title,
      game: puzzle.game_name,
      goal: puzzle.goal,
      youPlay: you,
      outcome: outcome.winner == null ? 'draw' : `player ${outcome.winner} wins`,
      reason: outcome.reason,
      draft: puzzle.is_draft ? 'yes' : '',
    };
    if (outcome.winner == null) drawn.push(row);
    else if (Number(outcome.winner) !== you) wrongSide.push(row);
  }

  if (wrongSide.length) {
    console.log('WINS FOR THE WRONG SIDE — the solver is told they succeeded and shown a loss:');
    console.table(wrongSide);
  } else {
    console.log('No puzzle ends in a win for the other side.');
  }

  if (drawn.length) {
    console.log('\nEnds in a draw rather than a win (allowed, but worth an eye):');
    console.table(drawn);
  }
  if (unplayable) {
    console.log(`\n${unplayable} puzzle(s) could not be replayed here and were skipped.`);
  }

  process.exit(wrongSide.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
