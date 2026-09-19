/*
 * Does a puzzle's recorded answer actually hold up?
 *
 *   node scripts/audit-puzzle-lines.js                 # every published puzzle
 *   node scripts/audit-puzzle-lines.js --fs            # only Fairy-Stockfish-validated ones
 *   node scripts/audit-puzzle-lines.js --id 33
 *   node scripts/audit-puzzle-lines.js --local
 *
 * WHY THIS EXISTS
 *
 * validation_status says a puzzle was checked, but not all checks are equal. A
 * line proved by Fairy-Stockfish was proved about the position FS was handed,
 * and FS has its own idea of chess: hand it a game with two royals a side, or
 * pieces it has no variant for, and it will happily prove something about a
 * different game. Puzzle 33 was "a forced mate in 2" on that basis and was
 * neither forced nor a mate.
 *
 * So this asks the questions the site's own engine can answer, with no engine but
 * ours:
 *
 *   IDS        does every ply name a piece that is on the board?  (a stale
 *              pieceId makes moveKey mismatch, so the puzzle rejects its own
 *              answer - see scripts/repair-puzzle-piece-ids.js)
 *   PROMO      is each promotion choice one the game actually offers?  (the same
 *              failure one field over, and the one the repair script does not fix)
 *   PLAYABLE   can the line be played through, ply by ply?
 *   GOAL       is the goal met at the end of it?
 *   FORCED     after the solver's FIRST move, does every reply the opponent has
 *              still leave a move that meets the goal?  This is the whole claim
 *              of "mate in two", and the only one a stored line cannot make on
 *              its own: a line scripts one defence, and a puzzle that says
 *              "forced" is asserting something about all of them.
 *
 *              ONLY ASKED OF A TWO-PLY LINE. A mate in four does not promise a
 *              mate is available after move one, so asking this of it would call
 *              every long puzzle broken - which is what a first version of this
 *              script did. Longer lines are reported as unchecked rather than
 *              failed: proving a deeper line forced is a real search, and this
 *              script deliberately is not one.
 *
 * Read-only. It changes nothing and prints a verdict per puzzle.
 */
require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');
const ONLY_FS = process.argv.includes('--fs');
const FORCE_LOCAL = process.argv.includes('--local');
const ONLY_ID = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

/*
 * Point the server's own db config at whichever database, then load the engine
 * through it - so the rules, the pieces and the position are the real ones
 * rather than a second hydration that could disagree with the site.
 */
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
      console.log(`[audit] production via tunnel ${cfg.TUNNEL_HOST}:${cfg.TUNNEL_PORT}\n`);
    }
  } catch (_) { /* fall through to the environment */ }
}
if (FORCE_LOCAL) console.log(`[audit] ${process.env.DB_HOST || 'localhost'}\n`);

const db_pool = require(path.join(ROOT, 'configs/db'));
const { rulesForPuzzle } = require(path.join(ROOT, 'server/puzzle-snapshot'));
const { hydratePosition } = require(path.join(ROOT, 'server/puzzle-hydrate'));
const {
  buildGameState, applyPly, goalMet, terminalOutcome, validatePuzzle, MECHANICAL_GOALS,
} = require(path.join(ROOT, 'server/puzzle-validation'));
const { getAllLegalMovesForPlayer } = require(path.join(ROOT, 'server/game-socket'));

const other = (n) => (Number(n) === 1 ? 2 : 1);
const sq = (p) => `${p.x},${p.y}`;
const parse = (v, fb) => {
  if (v == null) return fb;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
};
const clone = (state) => ({
  ...state, pieces: JSON.parse(JSON.stringify(state.pieces)), moveHistory: [],
});

/*
 * The GAME's full starting set, which is where promotion options come from - a
 * puzzle position is a handful of pieces and makes a terrible substitute. Same
 * thing loadStartingRoster builds in puzzle-routes.
 */
const startingRoster = async (rules) => {
  const parsed = parse(rules?.game?.pieces_string, null);
  if (!parsed || typeof parsed !== 'object') return [];
  const list = Object.entries(parsed).map(([key, v]) => {
    const [y, x] = String(key).split(',').map(Number);
    return { ...v, x: v.x ?? x, y: v.y ?? y };
  });
  return hydratePosition(rules, list);
};

/**
 * Every way a player can move from here, promotion choices expanded.
 *
 * A promoting move is offered once per piece it may become, because the choice
 * is part of the move: a mate that needs a knight is not found by a search that
 * only ever takes the game's default option.
 *
 * Returns [{ move, label }]. Capped, because each entry costs a move
 * application; over the cap it returns null, meaning "too many to establish".
 */
const expandedMoves = async (state, player, cap = 400) => {
  const candidates = getAllLegalMovesForPlayer(state, player) || [];
  if (candidates.length > cap) return null;

  const out = [];
  for (const cand of candidates) {
    const probe = clone(state);
    probe.currentTurn = player;
    // eslint-disable-next-line no-await-in-loop -- the engine mutates the pieces
    const first = await applyPly(probe, cand, { autoPromote: false });
    if (first.needsPromotionChoice) {
      for (const o of (first.promotionEligible?.options || [])) {
        out.push({
          move: {
            ...cand,
            promotionPieceId: o.id ?? o.piece_id,
            ...(o.player != null ? { promotionPlayer: o.player } : {}),
          },
          label: `${sq(cand.from)}>${sq(cand.to)}=${o.piece_name}`,
        });
      }
    } else if (first.ok) {
      out.push({ move: cand, label: `${sq(cand.from)}>${sq(cand.to)}` });
    }
  }
  return out;
};

/**
 * Did this position meet the puzzle's GOAL?
 *
 * The goal, and nothing else. A terminal outcome counts only when it is a WIN
 * FOR THIS PLAYER: terminalOutcome also reports stalemate, whose winner is null,
 * and an `||` against it let a checkmate puzzle accept a line ending in a draw.
 */
const meetsGoal = (state, player, res, goal) => {
  if (goalMet(goal, state, player, res)) return true;
  const term = terminalOutcome(state, other(player), res);
  return !!(term && Number(term.winner) === Number(player));
};

/** Does this move meet the goal, played from here? */
const reaches = async (state, player, move, goal) => {
  const trial = clone(state);
  trial.currentTurn = player;
  const res = await applyPly(trial, move, { autoPromote: false });
  if (!res.ok) return null;
  trial.currentTurn = other(player);
  return meetsGoal(trial, player, res, goal) ? { state: trial, res } : null;
};

/**
 * Is the solver's first move a forced win?
 *
 * Every legal reply has to leave a move that meets the goal. Returns
 * { forced, replies, unanswered } - unanswered being the replies that do not,
 * which is what a creator needs to see.
 */
const isForcing = async (base, gameType, first, side, goal) => {
  const state = buildGameState(base, gameType);
  state.currentTurn = side;
  const played = await applyPly(state, first, { autoPromote: false });
  if (!played.ok) return { forced: false, error: played.reason };

  state.currentTurn = other(side);
  // Already over: nothing to force.
  if (terminalOutcome(state, other(side), played)) {
    return { forced: true, replies: 0, unanswered: [], mateInOne: true };
  }

  const replies = await expandedMoves(state, other(side));
  if (!replies) return { forced: false, tooMany: true };
  if (!replies.length) return { forced: true, replies: 0, unanswered: [] };

  const unanswered = [];
  for (const r of replies) {
    const after = clone(state);
    after.currentTurn = other(side);
    // eslint-disable-next-line no-await-in-loop
    const rep = await applyPly(after, r.move, { autoPromote: false });
    if (!rep.ok) continue;

    after.currentTurn = side;
    // eslint-disable-next-line no-await-in-loop
    const mine = await expandedMoves(after, side);
    let answer = null;
    for (const m of (mine || [])) {
      // eslint-disable-next-line no-await-in-loop
      if (await reaches(after, side, m.move, goal)) { answer = m; break; }
    }
    if (!answer) unanswered.push(r.label);
  }
  return { forced: unanswered.length === 0, replies: replies.length, unanswered };
};

(async () => {
  let where = "solution_line IS NOT NULL AND is_draft = 0";
  if (ONLY_FS) where += " AND validation_detail LIKE '%Fairy-Stockfish%'";
  if (ONLY_ID) where = `id = ${Number(ONLY_ID)}`;
  const [puzzles] = await db_pool.query(
    `SELECT * FROM puzzles WHERE ${where} ORDER BY id`
  );
  console.log(`[audit] ${puzzles.length} puzzle(s)\n`);

  const bad = [];
  for (const puzzle of puzzles) {
    const line = parse(puzzle.solution_line, []);
    const side = Number(puzzle.side_to_move);
    const goal = puzzle.goal;
    let rules;
    try {
      rules = await rulesForPuzzle(db_pool, puzzle);
    } catch (e) {
      console.log(`#${puzzle.id} RULES FAILED: ${e.message}`);
      continue;
    }
    const [[game]] = await db_pool.query(
      'SELECT game_name FROM game_types WHERE id = ?', [puzzle.game_type_id]
    );
    const head = `#${String(puzzle.id).padStart(4)} ${String(game?.game_name || '?').slice(0, 28).padEnd(29)}`;

    if (!Array.isArray(line) || !line.length) {
      console.log(`${head} EMPTY LINE`);
      bad.push({ id: puzzle.id, why: 'empty line' });
      continue;
    }

    const base = {
      position: await hydratePosition(rules, parse(puzzle.position, [])),
      initial_pieces: await startingRoster(rules),
      side_to_move: side,
      setup_move: parse(puzzle.setup_move, null),
      game_type_id: puzzle.game_type_id,
      goal,
    };

    const problems = [];
    const notes = [];   // said, but not counted against the puzzle

    // IDS
    const onBoard = new Set(base.position.map((p) => p.id));
    const staleIds = line.filter((p) => p.pieceId && !onBoard.has(p.pieceId)).length;
    if (staleIds) problems.push(`${staleIds} stale pieceId(s)`);

    // Walk the line: PLAYABLE, PROMO, GOAL.
    const state = buildGameState(base, rules.game);
    let played = 0;
    let lastRes = null;
    for (let i = 0; i < line.length; i++) {
      state.currentTurn = i % 2 === 0 ? side : other(side);
      const ply = { ...line[i] };
      // The piece that is actually on the from-square, so a stale id does not
      // masquerade as an unplayable move.
      const mover = state.pieces.find(
        (p) => Number(p.x) === Number(ply.from?.x) && Number(p.y) === Number(ply.from?.y)
      );
      if (mover) ply.pieceId = mover.id;

      if (ply.promotionPieceId != null) {
        const probe = clone(state);
        probe.currentTurn = state.currentTurn;
        // eslint-disable-next-line no-await-in-loop
        const pr = await applyPly(probe, { ...ply, promotionPieceId: undefined }, { autoPromote: false });
        const offered = (pr.promotionEligible?.options || []).map((o) => String(o.id ?? o.piece_id));
        if (offered.length && !offered.includes(String(ply.promotionPieceId))) {
          problems.push(`ply ${i} promotes to ${ply.promotionPieceId}, not offered (${offered.join('/')})`);
        }
      }

      /*
       * autoPromote: false, deliberately. Auto-promoting takes the game's
       * DEFAULT option, which for a line that records a different piece plays a
       * move the creator never wrote - and then the goal is not met for a reason
       * that is this script's fault rather than the puzzle's. A ply that
       * promotes must carry its own choice, exactly as the solve endpoint
       * requires of a solver.
       */
      // eslint-disable-next-line no-await-in-loop
      const res = await applyPly(state, ply, { autoPromote: false });
      if (!res.ok) {
        problems.push(res.needsPromotionChoice
          ? `ply ${i} promotes with no usable choice recorded`
          : `ply ${i} unplayable: ${res.reason}`);
        break;
      }
      lastRes = res;
      played++;
    }

    if (played === line.length && MECHANICAL_GOALS.has(goal)) {
      state.currentTurn = other(side);
      if (!meetsGoal(state, side, lastRes, goal)) {
        const term = terminalOutcome(state, other(side), lastRes);
        problems.push(`goal "${goal}" NOT met at the end of the line`
          + (term ? ` (the line ends in ${term.reason}${term.winner == null ? ' - a draw' : ''})` : ''));
      }
    }

    /*
     * FORCED - and only for a TWO-PLY line, where "every reply still leaves a
     * move that meets the goal" is exactly what the puzzle claims. A four-ply
     * line claims that about move THREE, not move one, and testing it here would
     * report every deep puzzle as broken.
     */
    if (played === line.length && line.length > 2) {
      notes.push(`forcedness not checked (${line.length}-ply line)`);
    } else if (played === line.length && line.length === 2) {
      const first = { ...line[0] };
      const m0 = base.position.find(
        (p) => Number(p.x) === Number(first.from?.x) && Number(p.y) === Number(first.from?.y)
      );
      if (m0) first.pieceId = m0.id;
      // eslint-disable-next-line no-await-in-loop
      const f = await isForcing(base, rules.game, first, side, goal);
      if (f.tooMany) problems.push('too many replies to establish forcedness');
      else if (!f.forced) {
        problems.push(`NOT forced: ${f.unanswered.length} of ${f.replies} replies answer nothing`
          + ` (${f.unanswered.slice(0, 4).join(', ')}${f.unanswered.length > 4 ? ', …' : ''})`);
      }
    }

    /*
     * What the SITE says about the same line, from the same engine.
     *
     * Not decoration: validatePuzzle is the authority the puzzle's stored status
     * came from, and if it calls a line valid while this script calls it broken,
     * the script is what needs looking at. For a multi-move line it deliberately
     * answers "not checkable" rather than judging the defence - so a NOT forced
     * finding here ADDS to that answer rather than contradicting it, and the two
     * side by side is the only honest way to read either.
     */
    let sideVerdict = '?';
    try {
      const v = await validatePuzzle({ ...base, solution_line: line }, rules.game);
      sideVerdict = v.status;
    } catch (e) { sideVerdict = `threw: ${e.message}`; }

    const promotes = line.some((pl) => pl?.promotionPieceId != null);
    const meta = `[depth ${puzzle.solution_depth || '?'}${promotes ? ', promotes' : ''}]`
      + ` [site: ${sideVerdict}]`;

    const tail = notes.length ? ` {${notes.join('; ')}}` : '';
    if (!problems.length) {
      console.log(`${head} ok ${meta}${tail}`);
    } else {
      console.log(`${head} ${problems.join(' | ')} ${meta}${tail}`);
      bad.push({ id: puzzle.id, why: problems.join('; '), site: sideVerdict, stored: puzzle.validation_status });
    }
  }

  console.log(`\n${puzzles.length - bad.length} clean, ${bad.length} with problems`);
  if (bad.length) {
    bad.forEach((b) => console.log(`  #${b.id} (stored ${b.stored}, validator now ${b.site}): ${b.why}`));
  }
  process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
