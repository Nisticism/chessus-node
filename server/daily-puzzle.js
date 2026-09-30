/*
 * The daily puzzle: picking one, and keeping a queue of them.
 *
 * Two decisions shape everything here.
 *
 * IT IS SCHEDULED, NOT CHOSEN ON REQUEST. A row in daily_puzzles keyed by date
 * means everyone gets the same puzzle on the same day whatever their time zone,
 * a reload never swaps it, and yesterday's is still answerable. Picking at
 * request time - even deterministically, from a hash of the date - gives two
 * people in different places different puzzles around midnight, and leaves
 * nothing to look at or fix ahead of time.
 *
 * THE QUEUE RUNS AHEAD. The filler tops it up to HORIZON_DAYS so a gap is
 * visible weeks out rather than at midnight, and so a puzzle can be pulled or
 * swapped before anyone sees it.
 *
 * Everything is expressed in UTC. A "day" has to mean one thing, and the
 * alternative - the viewer's local day - would need a different answer per
 * request, which is the thing the table exists to avoid.
 */

const HORIZON_DAYS = 30;
// Two puzzles from the same game inside this window read as a repeat, however
// different they are. Padding the rotation out matters more than using every
// eligible puzzle.
const MIN_GAME_GAP_DAYS = 30;

/*
 * The shape of the rotation.
 *
 * A mate-in-one is a fine puzzle and a poor diet: spot the move, done. Most days
 * should ask for a short forced sequence, so one-movers are capped at a quarter
 * of the queue and the rest is weighted toward two, with three appearing
 * regularly and four as an occasional a-ha.
 *
 * Expressed as shares of the scheduled window rather than hard counts, so the
 * mix holds whether the queue is seven days long or thirty.
 */
const DEPTH_SHARE = { 1: 0.25, 2: 0.45, 3: 0.22, 4: 0.08 };
// Anything deeper than this is grouped with 4 when the mix is counted.
const MAX_TRACKED_DEPTH = 4;

const depthBucket = (d) => Math.min(MAX_TRACKED_DEPTH, Math.max(1, Number(d) || 1));

/*
 * When the puzzle changes over.
 *
 * The day used to be a UTC day, which put the switch at 8pm Eastern - so a
 * player in the US got "tomorrow's" puzzle during their evening and yesterday's
 * was gone before the day was. Eastern midnight is the switch most of the
 * audience actually experiences as midnight.
 *
 * The IANA zone rather than a fixed -05:00 on purpose. "EST" is literally UTC-5,
 * which is only correct for half the year; America/New_York follows the daylight
 * saving change, so the switch stays at midnight Eastern in July as well as
 * January. A fixed offset would drift an hour every spring.
 *
 * Nothing else moves. The Discord post is a cron job at its own time, and it
 * only ever asks for "today" - whatever that resolves to when it runs.
 */
const DAILY_TZ = 'America/New_York';

const keyParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The date key for an instant, as it stands in the daily timezone. */
const toDateKey = (d) => {
  const parts = keyParts.formatToParts(d).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const todayKey = () => toDateKey(new Date());

/*
 * A DATE column's value as a key. It is already a calendar day, so it is taken
 * as one - never turned into an instant and formatted back.
 *
 * The pool returns dates as strings (configs/db.js: dateStrings), and
 * toDateKey(new Date('2026-09-27')) is UTC midnight shown in Eastern time: the
 * 26th. Every scheduled day read as the day before, so the queue tried to fill
 * days that were taken (INSERT IGNORE quietly skipped them) and treated real
 * gaps as taken - days went out with no puzzle at all.
 */
const pad2 = (n) => String(n).padStart(2, '0');
const dbDateKey = (v) => {
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  return String(v).slice(0, 10);
};

/*
 * Calendar arithmetic on the key itself, deliberately NOT through toDateKey.
 *
 * A key is already a local date with no time in it. Parsing one as UTC midnight
 * and formatting it back through the Eastern formatter would land on 8pm the
 * previous evening and shift every result a day - which is exactly the bug this
 * comment exists to stop someone reintroducing.
 */
const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/*
 * What makes a puzzle fit to be somebody's first impression of the whole site.
 *
 * The validation_status clause is the one that matters and the one that will
 * keep the queue small for a while: only a puzzle the server has actually proved
 * - one goal, one move, one answer - is allowed to be the daily. A puzzle whose
 * status is `ambiguous` may be perfectly good, but "find the move" is a poor
 * thing to ask when several moves work; `not_checkable` means nobody has
 * verified it at all.
 *
 * The join through puzzle_pool is what keeps the rotation from showing four
 * builds of the same chess in a week - see scripts/puzzle-pool-sweep.js.
 */
const ELIGIBLE_SQL = `
  FROM puzzles p
  JOIN puzzle_pool pool ON pool.game_type_id = p.game_type_id
  JOIN game_types gt ON gt.id = p.game_type_id
  WHERE p.is_draft = 0
    AND p.published_at IS NOT NULL
    AND p.moderation_status = 'approved'
    AND p.validation_status = 'valid'
    AND p.allow_daily = 1
    AND pool.status IN ('auto_included', 'included')
    AND gt.is_draft = 0
    -- Veto puzzles are played in steps the daily card and the Discord
    -- activity do not offer yet (puzzle-veto.js); the puzzle page does.
    AND NOT (COALESCE(gt.veto_enabled, 0) = 1 AND COALESCE(gt.simultaneous_turns, 0) = 0)
    AND NOT EXISTS (SELECT 1 FROM daily_puzzles d WHERE d.puzzle_id = p.id)
`;

/*
 * The requirements, in the creator's words rather than the query's.
 *
 * Shared with the client so the modal in the builder and the rule the scheduler
 * actually applies cannot drift apart - a list of requirements that is not the
 * list being enforced is worse than no list.
 */
const DAILY_REQUIREMENTS = [
  {
    key: 'published',
    label: 'Published, not a draft',
    detail: 'Drafts are private to you, so they are never candidates.',
  },
  {
    key: 'validated',
    label: 'Checked, with exactly one answer',
    detail: 'Press "Check puzzle" and get a clean result. A puzzle with several '
      + 'answers, or one the server cannot judge, is not used - "find the move" '
      + 'is a poor thing to ask when more than one move works.',
  },
  {
    key: 'allow_daily',
    label: 'You have left the daily rotation switched on',
    detail: 'It is on by default. Turn it off on any puzzle and it will never be picked.',
  },
  {
    key: 'pool',
    label: 'Its game is in the daily pool',
    detail: 'The game needs a board no further from square than 3:2, at least three '
      + 'different piece types on each side, and it must not duplicate a game '
      + 'already in the rotation.',
  },
  {
    key: 'moderation',
    label: 'Nothing outstanding on moderation',
    detail: 'The title and description have to be approved, like anything else on the site.',
  },
  {
    key: 'fresh',
    label: 'It has not been the daily puzzle before',
    detail: 'Each puzzle gets one day, ever. A game is not repeated inside 30 days either.',
  },
];

const DAILY_DISCRETION =
  'Meeting all of this does not guarantee selection. The site owner and admins can '
  + "schedule, replace or remove any day's puzzle at any time, for any reason.";

/*
 * Does a puzzle's recorded answer actually do what the puzzle says?
 *
 * validation_status is only as good as whatever set it, and a generator once
 * set 'valid' on lines that were merely LEGAL: a "Mate in four" whose stored
 * line stopped after two of the solver's moves (the engine's own line had been
 * cut short), and mates the engine believed in for a game whose rules it had
 * wrong. Solvers were told "Solved!" two moves into a mate in four.
 *
 * So the queue asks the site's own validator before it schedules anything, and
 * for a goal the engine can score, requires the line to END with the goal met.
 * Goals it cannot score are the creator's call, as they are everywhere else, and
 * pass. Asked of the puzzle about to be scheduled, not the whole pool, and the
 * answer is cached for the run.
 */
const lineMeetsGoal = async (db_pool, p) => {
  // Required here, not at the top: these load the whole engine, and this file
  // is loaded by modules the engine itself depends on.
  const { validatePuzzle, playLine, terminalOutcome, MECHANICAL_GOALS } = require('./puzzle-validation');
  const { rulesForPuzzle } = require('./puzzle-snapshot');
  const { hydratePosition, placeableDefinitions } = require('./puzzle-hydrate');
  if (!MECHANICAL_GOALS.has(p.goal)) return true;
  const parse = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (_) { return fallback; }
  };
  const line = parse(p.solution_line, []);
  if (!Array.isArray(line) || !line.length) return false;
  try {
    const rules = await rulesForPuzzle(db_pool, p);
    if (!rules?.game) return false;
    const puzzle = {
      position: await hydratePosition(rules, parse(p.position, [])),
      placeable_definitions: placeableDefinitions(rules),
      side_to_move: p.side_to_move,
      setup_move: parse(p.setup_move, null),
      solution_line: line,
      goal: p.goal,
      game_type_id: p.game_type_id,
    };
    // validatePuzzle may mutate what it is handed; the replay below gets its own copy.
    const verdict = await validatePuzzle(JSON.parse(JSON.stringify(puzzle)), rules.game);
    if (!verdict.intendedWorks) return false;
    // The goal is not how this game is won (a "mate" in a capture-only game), or
    // the first move already wins and the line is beside the point.
    if (verdict.goalUnavailable || verdict.quickerWin) return false;
    // A one-move puzzle is valid (or ambiguous) exactly when its move does it.
    if (line.length === 1) return verdict.status === 'valid' || verdict.status === 'ambiguous';
    if (verdict.goalReached) return true;
    /*
     * Or the line ends the game in the solver's favour by the game's own rule,
     * one the goal's own test does not look at. (A "checkmate" label on a game
     * won by capture used to pass here; it is refused above now, since the
     * title then promises the wrong puzzle.) The same test scripts/audit-puzzle-lines.js
     * applies. A draw, or a line that simply stops, does not count.
     */
    const played = await playLine(puzzle, rules.game, line);
    if (!played.ok) return false;
    const side = Number(p.side_to_move);
    const toMove = line.length % 2 === 1 ? (side === 1 ? 2 : 1) : side;
    const outcome = terminalOutcome(played.state, toMove, played.ctx);
    return !!(outcome && Number(outcome.winner) === side);
  } catch (err) {
    console.warn(`[daily-puzzle] could not check puzzle ${p.id}: ${err.message}`);
    return false;
  }
};

function createDailyPuzzle({ db_pool }) {
  /*
   * Everything a card or a board needs about a scheduled puzzle. Written once
   * because forDate and forPuzzleId differ only in how they find the row, and
   * two copies of a twenty-column select would drift.
   */
  const SCHEDULED_SELECT = `
      SELECT DATE_FORMAT(d.puzzle_date, '%Y-%m-%d') AS puzzle_date, d.puzzle_id, d.game_type_id,
              p.title, p.description, p.goal, p.goal_description, p.side_to_move,
              p.solution_depth, p.rating, p.rating_sample_count, p.hide_rating,
              p.attempt_count, p.solve_count, p.creator_id, p.position, p.setup_move,
              -- rule_snapshot so the card can hydrate its position through the
              -- puzzle's own frozen rules rather than the live game, and
              -- updated_at so anything caching that work knows when to stop.
              p.rule_snapshot, p.updated_at,
              u.username AS creator_username,
              gt.game_name, gt.board_width, gt.board_height,
              -- What the game lets a player put down. The home board needs it
              -- to offer a placement when the answer is one rather than a move.
              gt.other_game_data
       FROM daily_puzzles d
       JOIN puzzles p ON p.id = d.puzzle_id
       JOIN game_types gt ON gt.id = d.game_type_id
       LEFT JOIN users u ON u.id = p.creator_id`;

  /** The scheduled puzzle for a date, or null if nothing is scheduled. */
  const forDate = async (dateKey) => {
    const [[row]] = await db_pool.query(
      `${SCHEDULED_SELECT} WHERE d.puzzle_date = ? LIMIT 1`,
      [dateKey]
    );
    return row || null;
  };

  /**
   * A puzzle by its OWN id, as long as it has been a daily puzzle already.
   *
   * What a Discord post needs. The post names a specific puzzle and stays in
   * the channel for good, so clicking Play on it a week later has to open the
   * puzzle in the post rather than whatever is scheduled that morning - which
   * means looking a puzzle up by identity, not by the day it happens to be.
   *
   * Two things this is careful about. It refuses anything not scheduled on or
   * before today, so the queue still cannot be read ahead - the whole point of
   * scheduling is that tomorrow's puzzle is not spoilable, and an id is as good
   * a way to ask as a date. And when a puzzle has been scheduled more than once
   * it answers with the most recent day, because that is the one a player would
   * be thinking of.
   *
   * @param {number} puzzleId
   * @param {string} todayKeyValue Today, so "not yet" is decided in the same
   *                               timezone the rest of the schedule uses.
   */
  const forPuzzleId = async (puzzleId, todayKeyValue) => {
    const id = Number(puzzleId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [[row]] = await db_pool.query(
      `${SCHEDULED_SELECT}
       WHERE d.puzzle_id = ? AND d.puzzle_date <= ?
       ORDER BY d.puzzle_date DESC LIMIT 1`,
      [id, todayKeyValue]
    );
    return row || null;
  };

  /**
   * Fill every unscheduled day from today to the horizon.
   *
   * Weighted toward game types that have not appeared recently, and refusing to
   * repeat a game inside MIN_GAME_GAP_DAYS. When nothing qualifies for a day the
   * loop simply stops: a missing day is a visible, fixable gap, and is a great
   * deal better than scheduling a puzzle nobody has checked.
   *
   * @returns {{scheduled: Array<{date: string, puzzleId: number, gameTypeId: number}>,
   *            filledThrough: string|null, ranOut: boolean}}
   */
  const fillQueue = async ({ horizonDays = HORIZON_DAYS, scheduledBy = null } = {}) => {
    const start = todayKey();
    const end = addDays(start, horizonDays - 1);

    const [existing] = await db_pool.query(
      'SELECT puzzle_date, game_type_id FROM daily_puzzles WHERE puzzle_date >= ?',
      [addDays(start, -MIN_GAME_GAP_DAYS)]
    );
    const takenDates = new Set(existing.map(r => dbDateKey(r.puzzle_date)));
    // When each game type was last used, so the gap rule can be applied without
    // another query per candidate day.
    const lastUsed = new Map();
    for (const r of existing) {
      const key = dbDateKey(r.puzzle_date);
      const prev = lastUsed.get(r.game_type_id);
      if (!prev || key > prev) lastUsed.set(r.game_type_id, key);
    }

    // What the queue already contains, by depth, so the mix is measured across
    // the whole window rather than only the days this run happens to fill.
    const [scheduledDepths] = await db_pool.query(
      `SELECT p.solution_depth AS depth, COUNT(*) AS n
       FROM daily_puzzles d JOIN puzzles p ON p.id = d.puzzle_id
       WHERE d.puzzle_date >= ?
       GROUP BY p.solution_depth`,
      [start]
    );
    const placed = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of scheduledDepths) placed[depthBucket(r.depth)] += Number(r.n);

    const [candidates] = await db_pool.query(
      `SELECT p.id, p.game_type_id, p.rating, p.created_at, p.solution_depth,
              p.position, p.side_to_move, p.setup_move, p.solution_line, p.goal, p.rule_snapshot
       ${ELIGIBLE_SQL}
       ORDER BY p.game_type_id, p.id`
    );
    // lineMeetsGoal, once per puzzle per run. A puzzle that fails is skipped,
    // never scheduled, and reported.
    const checked = new Map();
    const rejected = [];
    const sound = async (c) => {
      if (!checked.has(c.id)) {
        const ok = await lineMeetsGoal(db_pool, c);
        checked.set(c.id, ok);
        if (!ok) rejected.push(c.id);
      }
      return checked.get(c.id);
    };
    // The first puzzle in `list` that is unused, matches `test`, and holds up.
    const firstSound = async (list, test) => {
      for (const c of list) {
        if (usedPuzzleIds.has(c.id) || !test(c)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await sound(c)) return c;
      }
      return null;
    };
    if (!candidates.length) {
      return { scheduled: [], filledThrough: null, ranOut: true, candidates: 0 };
    }

    const byGame = new Map();
    for (const c of candidates) {
      if (!byGame.has(c.game_type_id)) byGame.set(c.game_type_id, []);
      byGame.get(c.game_type_id).push(c);
    }

    const scheduled = [];
    const usedPuzzleIds = new Set();
    let ranOut = false;

    for (let i = 0; i < horizonDays; i++) {
      const date = addDays(start, i);
      if (takenDates.has(date)) continue;

      /*
       * Pick the game type that has gone longest without an appearance, so the
       * rotation spreads itself rather than leaning on whichever game happens to
       * have the most puzzles. A game never seen at all sorts first.
       */
      const options = [...byGame.entries()]
        .filter(([gameTypeId, list]) => {
          if (!list.some(c => !usedPuzzleIds.has(c.id))) return false;
          const last = lastUsed.get(gameTypeId);
          if (!last) return true;
          return date >= addDays(last, MIN_GAME_GAP_DAYS);
        })
        .sort((a, b) => {
          const la = lastUsed.get(a[0]) || '';
          const lb = lastUsed.get(b[0]) || '';
          if (la !== lb) return la < lb ? -1 : 1;
          return a[0] - b[0];
        });

      if (!options.length) { ranOut = true; break; }

      /*
       * Which depth does the queue most need? The one furthest below its share.
       * Depths with nothing available are skipped, so a shortage of three-movers
       * quietly falls back to whatever exists rather than stalling the queue.
       */
      const totalPlaced = Object.values(placed).reduce((a, n) => a + n, 0) || 1;
      const wanted = Object.keys(DEPTH_SHARE)
        .map(Number)
        .sort((a, b) => (placed[a] / totalPlaced - DEPTH_SHARE[a])
                      - (placed[b] / totalPlaced - DEPTH_SHARE[b]));

      let chosen = null;
      for (const depth of wanted) {
        for (const [gameTypeId, list] of options) {
          // eslint-disable-next-line no-await-in-loop
          const pick = await firstSound(list, c => depthBucket(c.solution_depth) === depth);
          if (pick) { chosen = { gameTypeId, pick, depth }; break; }
        }
        if (chosen) break;
      }
      // Nothing matched a depth we want; take the longest-waiting game anyway.
      if (!chosen) {
        for (const [gameTypeId, list] of options) {
          // eslint-disable-next-line no-await-in-loop
          const pick = await firstSound(list, () => true);
          if (pick) { chosen = { gameTypeId, pick, depth: depthBucket(pick.solution_depth) }; break; }
        }
      }
      // Every remaining candidate failed its own line: stop, as for running out.
      if (!chosen) { ranOut = true; break; }

      usedPuzzleIds.add(chosen.pick.id);
      lastUsed.set(chosen.gameTypeId, date);
      placed[chosen.depth] += 1;
      scheduled.push({ date, puzzleId: chosen.pick.id, gameTypeId: chosen.gameTypeId });
    }

    if (scheduled.length) {
      await db_pool.query(
        `INSERT IGNORE INTO daily_puzzles (puzzle_date, puzzle_id, game_type_id, scheduled_by)
         VALUES ${scheduled.map(() => '(?,?,?,?)').join(',')}`,
        scheduled.flatMap(s => [s.date, s.puzzleId, s.gameTypeId, scheduledBy])
      );
    }

    if (rejected.length) {
      console.warn(`[daily-puzzle] not scheduled - line does not meet its goal: ${rejected.map(id => `#${id}`).join(', ')}`);
    }

    return {
      scheduled,
      filledThrough: scheduled.length ? scheduled[scheduled.length - 1].date : null,
      ranOut,
      rejected,
      candidates: candidates.length,
      horizonEnd: end,
    };
  };

  /** How many puzzles could be scheduled but are not yet. */
  const eligibleCount = async () => {
    const [[row]] = await db_pool.query(`SELECT COUNT(*) AS n ${ELIGIBLE_SQL}`);
    return row?.n ?? 0;
  };

  return { forDate, forPuzzleId, fillQueue, eligibleCount, todayKey, addDays, HORIZON_DAYS };
}

module.exports = {
  createDailyPuzzle, HORIZON_DAYS, MIN_GAME_GAP_DAYS, DEPTH_SHARE,
  DAILY_REQUIREMENTS, DAILY_DISCRETION, lineMeetsGoal,
};
