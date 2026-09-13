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

const toDateKey = (d) => d.toISOString().slice(0, 10);
const todayKey = () => toDateKey(new Date());
const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateKey(d);
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

function createDailyPuzzle({ db_pool }) {
  /** The scheduled puzzle for a date, or null if nothing is scheduled. */
  const forDate = async (dateKey) => {
    const [[row]] = await db_pool.query(
      `SELECT d.puzzle_date, d.puzzle_id, d.game_type_id,
              p.title, p.description, p.goal, p.goal_description, p.side_to_move,
              p.solution_depth, p.rating, p.rating_sample_count, p.hide_rating,
              p.attempt_count, p.solve_count, p.creator_id, p.position,
              u.username AS creator_username,
              gt.game_name, gt.board_width, gt.board_height
       FROM daily_puzzles d
       JOIN puzzles p ON p.id = d.puzzle_id
       JOIN game_types gt ON gt.id = d.game_type_id
       LEFT JOIN users u ON u.id = p.creator_id
       WHERE d.puzzle_date = ? LIMIT 1`,
      [dateKey]
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
    const takenDates = new Set(existing.map(r => toDateKey(new Date(r.puzzle_date))));
    // When each game type was last used, so the gap rule can be applied without
    // another query per candidate day.
    const lastUsed = new Map();
    for (const r of existing) {
      const key = toDateKey(new Date(r.puzzle_date));
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
      `SELECT p.id, p.game_type_id, p.rating, p.created_at, p.solution_depth ${ELIGIBLE_SQL}
       ORDER BY p.game_type_id, p.id`
    );
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
          const pick = list.find(c => !usedPuzzleIds.has(c.id) && depthBucket(c.solution_depth) === depth);
          if (pick) { chosen = { gameTypeId, pick, depth }; break; }
        }
        if (chosen) break;
      }
      // Nothing matched a depth we want; take the longest-waiting game anyway.
      if (!chosen) {
        const [gameTypeId, list] = options[0];
        const pick = list.find(c => !usedPuzzleIds.has(c.id));
        chosen = { gameTypeId, pick, depth: depthBucket(pick.solution_depth) };
      }

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

    return {
      scheduled,
      filledThrough: scheduled.length ? scheduled[scheduled.length - 1].date : null,
      ranOut,
      candidates: candidates.length,
      horizonEnd: end,
    };
  };

  /** How many puzzles could be scheduled but are not yet. */
  const eligibleCount = async () => {
    const [[row]] = await db_pool.query(`SELECT COUNT(*) AS n ${ELIGIBLE_SQL}`);
    return row?.n ?? 0;
  };

  return { forDate, fillQueue, eligibleCount, todayKey, addDays, HORIZON_DAYS };
}

module.exports = {
  createDailyPuzzle, HORIZON_DAYS, MIN_GAME_GAP_DAYS, DEPTH_SHARE,
  DAILY_REQUIREMENTS, DAILY_DISCRETION,
};
