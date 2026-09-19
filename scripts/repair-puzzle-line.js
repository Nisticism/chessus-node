/*
 * Find a solution line a puzzle's position can actually support, and write it.
 *
 *   node scripts/repair-puzzle-line.js --id 33
 *   node scripts/repair-puzzle-line.js --id 33 --write
 *   node scripts/repair-puzzle-line.js --id 33 --local
 *
 * WHY
 *
 * A puzzle can have a position worth solving and a recorded answer that is
 * simply wrong - a line mined out of a real game, or proved by an engine that
 * was shown a different game (see scripts/audit-puzzle-lines.js). Retiring it
 * throws away the position too, which is the part somebody built.
 *
 * So this searches the position with the SITE's engine for a line that meets the
 * puzzle's own goal, and only accepts one that is genuinely FORCED: every reply
 * the opponent has must still leave a win. That is what "mate in N" claims, and
 * it is the thing a line mined out of a real game does not establish - such a
 * line merely happens to have ended in mate against the defence that was played.
 *
 *   --depth N   how many of the solver's moves the search may use (default 2,
 *               max 4). The cost is the opponent's branching to the power of the
 *               depth, so a position where they have three replies is a hundred
 *               times cheaper than one where they have thirty.
 *   --budget N  ceiling on ENGINE CALLS. When it is exhausted the search says
 *               so, and "none found" then means "not found", NOT "does not
 *               exist" - a distinction worth keeping.
 *   --checks-only  explore only the solver's checking moves. Much cheaper and
 *               finds nearly every short forced mate, but it is a heuristic: a
 *               negative result under it is not a proof, and is labelled.
 *   --retitle   also correct a title whose move count no longer matches - only
 *               the "... in <number>" shape, and only with --write.
 *
 * It reports what it found and, with --write, replaces solution_line,
 * solution_depth and the validation verdict. It will not invent a position or a
 * goal, and it does NOT touch the title: a two-move puzzle that turns out to be
 * a three-move one needs renaming by a person.
 */
require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const FORCE_LOCAL = process.argv.includes('--local');
const ID = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();
/*
 * How many of the solver's moves the search may use. Two is cheap; three is not.
 * The opponent's branching is what decides: a position where they have three
 * legal replies costs a hundredth of one where they have thirty.
 */
const MAX_DEPTH = (() => {
  const i = process.argv.indexOf('--depth');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 2;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 4) : 2;
})();
/*
 * A hard ceiling on ENGINE CALLS - every applyPly, wherever it happens.
 *
 * An earlier version counted candidate moves instead, which undercounted the
 * real work by roughly the branching factor: enumerating a player's moves costs
 * one applyPly per candidate on its own, before any of them is explored. A
 * "budget" of 400,000 moves was several hours of engine, which is not a budget.
 */
const BUDGET = (() => {
  const i = process.argv.indexOf('--budget');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 250000;
  return Number.isFinite(n) && n > 0 ? n : 250000;
})();

/*
 * --checks-only: consider only the solver's moves that leave the opponent in
 * check.
 *
 * This is a HEURISTIC and it changes what a negative result means. A forced mate
 * usually proceeds by check - the opponent must not be given a free move - so
 * pruning to checks finds the overwhelming majority of short forced mates at a
 * fraction of the cost. But it is not exhaustive: quiet moves can force mate
 * (zugzwang, and any position where every opponent move walks into one). So with
 * this flag, "none found" means exactly that, and is printed as such rather than
 * as "none exists".
 */
const CHECKS_ONLY = process.argv.includes('--checks-only');

/*
 * --retitle: also correct a title that names the wrong number of moves.
 *
 * Off by default, because a title is editorial and this script has no business
 * rewriting prose. But "Mate in two" on a four-move line is not prose, it is a
 * wrong number in a fixed phrase, and leaving it means the puzzle still lies to
 * the solver after its line has been put right. So this handles exactly that
 * shape - "<anything> in <number word>" - and refuses anything else rather than
 * guessing.
 */
const RETITLE = process.argv.includes('--retitle');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/**
 * The same title with its move count corrected, or null when the title is not
 * of a shape this dares to touch.
 */
const retitled = (title, depth) => {
  const word = NUMBER_WORDS[depth];
  if (!word || !title) return null;
  const m = /^(.*\bin )(zero|one|two|three|four|five|six|seven|eight|\d+)(\b.*)$/i.exec(title);
  if (!m) return null;
  const next = `${m[1]}${word}${m[3]}`;
  return next === title ? null : next;
};
if (!ID) { console.error('[repair] --id <puzzle id> is required'); process.exit(1); }

if (!FORCE_LOCAL) {
  try {
    const { loadEnv } = require(path.join(ROOT, 'scripts/dev-db/_config'));
    const cfg = loadEnv();
    if (cfg.RDS_HOST && cfg.RDS_PASSWORD) {
      process.env.DB_HOST = cfg.TUNNEL_HOST;
      process.env.DB_PORT = String(cfg.TUNNEL_PORT);
      process.env.DB_USER = cfg.RDS_USER;
      process.env.DB_PASSWORD = cfg.RDS_PASSWORD;
      process.env.DB_NAME = cfg.RDS_DB;
      console.log(`[repair] production via tunnel ${cfg.TUNNEL_HOST}:${cfg.TUNNEL_PORT}`
        + `${WRITE ? '  (WRITING)' : '  (dry run)'}\n`);
    }
  } catch (_) { /* fall through */ }
}

const db_pool = require(path.join(ROOT, 'configs/db'));
const { rulesForPuzzle } = require(path.join(ROOT, 'server/puzzle-snapshot'));
const { hydratePosition } = require(path.join(ROOT, 'server/puzzle-hydrate'));
const {
  buildGameState, applyPly, goalMet, terminalOutcome, validatePuzzle,
} = require(path.join(ROOT, 'server/puzzle-validation'));
const { getAllLegalMovesForPlayer, checkForCheck } = require(path.join(ROOT, 'server/game-socket'));

const other = (n) => (Number(n) === 1 ? 2 : 1);
const sq = (p) => `(${p.x},${p.y})`;
const parse = (v, fb) => {
  if (v == null) return fb;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
};
const clone = (state) => ({
  ...state, pieces: JSON.parse(JSON.stringify(state.pieces)), moveHistory: [],
});

const startingRoster = async (rules) => {
  const parsed = parse(rules?.game?.pieces_string, null);
  if (!parsed || typeof parsed !== 'object') return [];
  const list = Object.entries(parsed).map(([key, v]) => {
    const [y, x] = String(key).split(',').map(Number);
    return { ...v, x: v.x ?? x, y: v.y ?? y };
  });
  return hydratePosition(rules, list);
};

/** Every move a player has, with each promotion choice as its own candidate. */
const expandedMoves = async (state, player, cap = 400) => {
  const candidates = getAllLegalMovesForPlayer(state, player) || [];
  if (candidates.length > cap) return null;
  const out = [];
  for (const cand of candidates) {
    const probe = clone(state);
    probe.currentTurn = player;
    // eslint-disable-next-line no-await-in-loop
    const first = await applyCounted(probe, cand, { autoPromote: false });
    if (first.needsPromotionChoice) {
      for (const o of (first.promotionEligible?.options || [])) {
        out.push({
          move: {
            ...cand,
            promotionPieceId: o.id ?? o.piece_id,
            ...(o.player != null ? { promotionPlayer: o.player } : {}),
          },
          label: `${sq(cand.from)}->${sq(cand.to)} = ${o.piece_name}`,
        });
      }
    } else if (first.ok) {
      out.push({ move: cand, label: `${sq(cand.from)}->${sq(cand.to)}` });
    }
  }
  return out;
};

/* Every engine call goes through here, so the budget counts what it costs. */
let engineCalls = 0;
const applyCounted = async (state, move, opts) => {
  engineCalls++;
  return applyPly(state, move, opts);
};

/** Play a move on a copy; { state, res } when it is legal, else null. */
const play = async (state, player, move) => {
  const next = clone(state);
  next.currentTurn = player;
  const res = await applyCounted(next, move, { autoPromote: false });
  return res.ok ? { state: next, res } : null;
};

/**
 * Did this position meet the puzzle's GOAL?
 *
 * The goal, and nothing else. This used to read
 *
 *     goalMet(...) || terminalOutcome(...)
 *
 * which conflated two different claims and was wrong twice over. terminalOutcome
 * reports whatever the live engine would call the end of the game - and that
 * includes a STALEMATE, whose winner is null. So a checkmate puzzle accepted a
 * line that ended in a draw: puzzles 33 and 43 were written that way and had to
 * be redone. It also accepted a win by a condition the goal did not ask for,
 * which is a different puzzle wearing the same title.
 *
 * A terminal outcome is still worth consulting, but only as a WIN FOR THE SOLVER
 * that the goal function might not have spotted - never as a substitute for the
 * goal, and never when nobody won.
 */
const meets = (state, player, res, goal) => {
  const after = { ...state, currentTurn: other(player) };
  if (goalMet(goal, after, player, res)) return true;
  const term = terminalOutcome(after, other(player), res);
  return !!(term && Number(term.winner) === Number(player));
};

(async () => {
  const [[puzzle]] = await db_pool.query('SELECT * FROM puzzles WHERE id = ?', [ID]);
  if (!puzzle) { console.error(`[repair] no puzzle ${ID}`); process.exit(1); }
  const rules = await rulesForPuzzle(db_pool, puzzle);
  const side = Number(puzzle.side_to_move);
  const goal = puzzle.goal;

  const base = {
    position: await hydratePosition(rules, parse(puzzle.position, [])),
    initial_pieces: await startingRoster(rules),
    side_to_move: side,
    setup_move: parse(puzzle.setup_move, null),
    game_type_id: puzzle.game_type_id,
    goal,
  };

  console.log(`puzzle ${ID}: "${puzzle.title}" in ${rules.game.game_name}`);
  console.log(`  goal=${goal} depth=${puzzle.solution_depth} side_to_move=${side}`);
  console.log(`  current line: ${JSON.stringify(parse(puzzle.solution_line, []))}\n`);

  const root = buildGameState(base, rules.game);
  const mine = await expandedMoves(root, side);
  if (!mine) { console.error('[repair] too many candidate moves to search'); process.exit(1); }
  console.log(`searching ${mine.length} first moves for ${side === 1 ? 'player 1' : 'player 2'}\n`);

  // ---------------------------------------------------------- mate in one --
  const inOne = [];
  for (const m of mine) {
    // eslint-disable-next-line no-await-in-loop
    const played = await play(root, side, m.move);
    if (played && meets(played.state, side, played.res, goal)) inOne.push(m);
  }
  if (inOne.length) {
    console.log(`MATE IN ONE: ${inOne.length} move(s) meet the goal outright`);
    inOne.forEach((m) => console.log(`   ${m.label}`));
  }

  // ------------------------------------------------------- forced in N -----
  /*
   * A forced win in `movesLeft` of the solver's moves.
   *
   * "Forced" is the whole point and it is an AND over the opponent: every reply
   * they have must still leave a win. Against the solver it is an OR: one move
   * that works is enough. That asymmetry is what makes this a proof rather than
   * a suggestion, and it is why a line that merely happens to end in mate - what
   * a mined game gives you - is not the same thing.
   *
   * Returns a principal line [solverMove, reply, solverMove, ...] using the FIRST
   * reply at each opponent turn, since every reply is answered by construction
   * and a stored line can only script one of them. Null when there is no win.
   *
   * Budgeted rather than depth-limited alone: the cost is the opponent's
   * branching to the power of the depth, and that varies by three orders of
   * magnitude across positions.
   */
  let exhausted = false;
  const forcedWin = async (state, movesLeft) => {
    if (movesLeft <= 0) return null;
    const mineHere = await expandedMoves(state, side);
    if (!mineHere) return null;

    for (const m of mineHere) {
      if (engineCalls > BUDGET) { exhausted = true; return null; }
      const played = await play(state, side, m.move);
      if (!played) continue;
      if (meets(played.state, side, played.res, goal)) return [m];

      // Not a win yet, and no moves left to make it one.
      if (movesLeft <= 1) continue;

      /*
       * The prune. A move that does not check hands the opponent a free move,
       * and in a short forced mate they almost never get one - so exploring
       * only checks finds nearly every such mate for a fraction of the work.
       * Heuristic, and the verdict says so.
       */
      if (CHECKS_ONLY && !checkForCheck(played.state, other(side)).inCheck) continue;

      const replies = await expandedMoves(played.state, other(side));
      if (!replies) continue;
      // No reply at all: the position is over, and meets() above said it is not
      // a win for us - so this move is not the answer.
      if (!replies.length) continue;

      /*
       * The reply this line SCRIPTS is the one that holds out longest.
       *
       * Every reply is answered - that is what makes the line forced - but they
       * do not all take the same number of moves, and the stored line is what
       * the puzzle's title and depth end up describing. Scripting the first
       * reply tried gave puzzle 33 a three-move line while another defence
       * needed four, so it would have been stored as a "mate in three" that is
       * really a mate in four. Taking the longest branch makes the line, the
       * depth and the claim agree, and agree with the worst case - which is what
       * "mate in N" means.
       */
      let principal = null;
      let holds = true;
      for (const r of replies) {
        if (engineCalls > BUDGET) { exhausted = true; holds = false; break; }
        const afterReply = await play(played.state, other(side), r.move);
        if (!afterReply) continue;
        // eslint-disable-next-line no-await-in-loop
        const rest = await forcedWin(afterReply.state, movesLeft - 1);
        if (!rest) { holds = false; break; }
        if (!principal || rest.length > principal.length - 1) principal = [r, ...rest];
      }
      if (holds && principal) return [m, ...principal];
    }
    return null;
  };

  let found = null;
  let foundDepth = null;
  for (let d = 2; d <= MAX_DEPTH; d++) {
    // eslint-disable-next-line no-await-in-loop
    const line = await forcedWin(buildGameState(base, rules.game), d);
    const caveat = exhausted
      ? ' - BUDGET EXHAUSTED, so "none" means not found, not impossible'
      : (CHECKS_ONLY && d > 1 ? ' - among checking moves only' : '');
    console.log(`SEARCH TO ${d}: ${line ? `found a ${Math.ceil(line.length / 2)}-move forced line` : 'none'}`
      + `  (${engineCalls} engine calls${caveat})`);
    /*
     * The depth is a property of the line, not of the search that found it. `d`
     * is the ceiling the search was allowed; a line found under it can be
     * shorter, and writing `d` would have labelled puzzle 33's five-ply line as
     * a four-move puzzle.
     */
    if (line) { found = line; foundDepth = Math.ceil(line.length / 2); break; }
    if (exhausted) break;
  }
  if (found) {
    console.log('\nthe forced line:');
    found.forEach((step, i) => console.log(`   ${i % 2 === 0 ? 'you: ' : 'them:'} ${step.label}`));
  }
  const forced = found ? [{ first: found[0], replies: '?', answers: [] }] : [];

  /*
   * Which line to record.
   *
   * A forced two-move line is preferred over a one-move one when the puzzle says
   * depth 2, because rewriting a "mate in two" as a mate in one changes what the
   * puzzle IS, and that is a decision for whoever owns it rather than for this
   * script. Where the stored depth cannot be honoured it says so and stops.
   */
  const wantDepth = Number(puzzle.solution_depth) || 1;
  let chosen = null;
  let depth = null;
  if (found) {
    chosen = found.map((step) => step.move);
    depth = foundDepth;
    if (depth !== wantDepth) {
      console.log(`\nNOTE: the puzzle says depth ${wantDepth} and the forced line is ${depth}.`
        + ' The line and the depth are written together; the TITLE is not touched, so rename it.');
    }
  } else if (inOne.length) {
    chosen = [inOne[0].move];
    depth = 1;
    console.log(`\nonly a one-move answer is available: ${inOne[0].label}`);
    if (wantDepth >= 2) {
      console.log('   NOTE: the puzzle says depth 2. Recording this would change what the'
        + ' puzzle is, so it is not written automatically.');
      chosen = null;
    }
  }

  if (!chosen) {
    console.log('\nNothing written: no line matching this puzzle\'s own depth was found.');
    process.exit(0);
  }

  // Confirm the site's own validator accepts what we are about to store.
  const verdict = await validatePuzzle({ ...base, solution_line: chosen }, rules.game);
  console.log(`\nvalidator: ${verdict.status} - ${verdict.detail || '(no detail)'}`);

  if (!WRITE) {
    console.log('\nDry run - nothing written. Re-run with --write to apply.');
    process.exit(0);
  }
  /*
   * The detail records who established WHAT.
   *
   * The site validator answers "not checkable" for anything past two plies by
   * design, and that is the status this writes - promoting a line to 'valid' on
   * this script's own word is exactly the mistake that put a false
   * "Fairy-Stockfish proved a forced mate in N" on these rows. But the search
   * above really did check every reply, and saying so, attributed, is worth more
   * than dropping it.
   */
  const detail = `${verdict.detail || 'line replayed'} `
    + `[scripts/repair-puzzle-line.js verified this ${depth}-move line is forced: every reply the `
    + `opponent has at each of their turns is answered`
    + `${CHECKS_ONLY ? '; the search explored only checking moves, so a shorter line may exist' : ''}]`;

  const newTitle = RETITLE ? retitled(puzzle.title, depth) : null;
  await db_pool.query(
    `UPDATE puzzles
     SET solution_line = ?, solution_depth = ?, validation_status = ?, validation_detail = ?,
         validated_at = NOW()${newTitle ? ', title = ?' : ''}
     WHERE id = ?`,
    newTitle
      ? [JSON.stringify(chosen), depth, verdict.status, detail, newTitle, ID]
      : [JSON.stringify(chosen), depth, verdict.status, detail, ID]
  );
  console.log(`\nWrote a ${depth}-move line to puzzle ${ID}.`);
  if (newTitle) console.log(`Retitled: ${JSON.stringify(puzzle.title)} -> ${JSON.stringify(newTitle)}`);
  else if (RETITLE && depth !== (Number(puzzle.solution_depth) || 1)) {
    console.log(`NOT retitled: ${JSON.stringify(puzzle.title)} is not an "... in <number>" title.`
      + ' Rename it by hand.');
  }
  process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
