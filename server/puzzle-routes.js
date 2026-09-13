/*
 * Puzzle HTTP routes: creator CRUD, the solver endpoint, and solver feedback.
 *
 * Mounted from index.js as registerPuzzleRoutes(app, deps) so the puzzle feature
 * stays in one readable file instead of adding another few hundred lines to a
 * 15k-line module.
 *
 * Two rules shape most of what is here:
 *
 *  - The solution never leaves the server for an unsolved puzzle. Listing and
 *    detail responses strip solution_line, or the puzzle is one view-source away
 *    from being spoiled.
 *  - Feedback is critique addressed to the creator. It cannot unpublish a puzzle
 *    or mark it invalid, and it requires a written message.
 */
const {
  validatePuzzle, moveKey, GOALS, GOAL_DEFS, MECHANICAL_GOALS, VALIDATION,
  goalsForGameType, describeGoal, buildGameState, playLine,
} = require('./puzzle-validation');
const {
  getPromotionOptions, checkPromotionEligibility, getAllLegalMovesForPlayer,
} = require('./game-socket');
const { summariseRules } = require('./game-rules-summary');
const { renderPuzzle } = require('./puzzle-image');
const { rulesForPuzzle, ensureSnapshot, readLive } = require('./puzzle-snapshot');
/*
 * Hydration lives in its own module because more than one thing needs it - the
 * routes here and the snapshot backfill - and a second copy of it is exactly
 * the bug this codebase keeps having. See server/puzzle-hydrate.js.
 */
const { hydratePosition, toEngineFields } = require('./puzzle-hydrate');

/*
 * Where uploaded piece art lives. Same rule index.js uses: an explicit
 * UPLOADS_DIR (a mounted volume in production) or the repo-relative folder, so
 * a deployment that has never set the variable keeps working.
 */
const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? require('path').resolve(process.env.UPLOADS_DIR)
  : require('path').join(__dirname, '../uploads');
const { optionalDiscord } = require('./discord-auth');
const { recordDiscordAttempt } = require('./discord-routes');
const {
  createDailyPuzzle, DAILY_REQUIREMENTS, DAILY_DISCRETION,
} = require('./daily-puzzle');
const {
  rateAttempt, scoreAttempt, foldSolverIntoPuzzleRating, isRatingPublic,
  PUZZLE_ELO_DEFAULT, MIN_SOLVERS_FOR_PUBLIC_RATING,
} = require('./puzzle-rating');

/**
 * Column names on the `pieces` table are not the names the move engine reads.
 * When a live game builds its piece objects it renames a handful of fields, and
 * anything that feeds the engine has to do the same - otherwise the piece is
 * spread in with the WRONG keys and the engine sees no movement at all. It does
 * not error; the piece simply generates zero moves. That is how a knight came
 * to be "unable" to move in puzzle validation while working fine in a live game.
 *
 * Only these eight of 174 fields are renamed (the rest pass through untouched);
 * the live builders in game-socket.js are the source of truth.
 */

/*
 * A solution line is a flat list of plies that ALTERNATES, starting with the
 * side to move: index 0 is the solver's first move, index 1 is the opponent's
 * scripted reply, index 2 is the solver's second move, and so on. A one-ply
 * line - every puzzle built before multi-move puzzles existed - is just the
 * solver's move, so nothing about the old shape changes.
 *
 * The opponent's replies are written by the creator rather than searched for.
 * There is no engine for user-defined pieces, so there is nothing to ask what
 * the best defence is; the creator knows what they meant, and a solver who
 * plays something the creator did not anticipate is simply told they are off
 * the line. That is a deliberate limit, not an oversight.
 */
const MAX_MOVES_PER_SIDE = 8;
const MAX_PLIES = MAX_MOVES_PER_SIDE * 2;

const solverPlies = (line) => line.filter((_, i) => i % 2 === 0);
const replyPlies = (line) => line.filter((_, i) => i % 2 === 1);

const isPly = (m) => !!m && m.from && m.to
  && Number.isFinite(Number(m.from.x)) && Number.isFinite(Number(m.from.y))
  && Number.isFinite(Number(m.to.x)) && Number.isFinite(Number(m.to.y));

/** Coerce whatever the client sent into a storable line, or say why not. */
function sanitizeLine(raw) {
  const list = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  if (!list.length) return { error: 'A puzzle needs a solution' };
  if (list.length > MAX_PLIES) {
    return { error: `A solution can be at most ${MAX_MOVES_PER_SIDE} moves per side` };
  }
  if (!list.every(isPly)) return { error: 'Every move in the solution needs a from and a to square' };
  return { line: list };
}

/*
 * Pool requirements, mirrored from scripts/puzzle-pool-sweep.js. Duplicated
 * deliberately and kept small: the sweep owns the expensive duplicate
 * comparison, this owns the cheap per-game checks the API needs at request time.
 */
const POOL_MAX_BOARD_ASPECT = 1.5;
const POOL_MIN_PIECE_TYPES = 3;

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_FEEDBACK = 2000;
const MIN_FEEDBACK = 10;

function registerPuzzleRoutes(app, {
  db_pool, dbHelpers, authenticateToken, optionalAuthenticate, hasAdminRole,
  canCreatePuzzles, puzzleCreateAllowance, PUZZLE_FREE_PER_GAME, PUZZLE_DAILY_CAP,
  puzzleValidateLimiter,
}) {
  const isStaff = (user) => hasAdminRole(user?.role);
  const dailyPuzzle = createDailyPuzzle({ db_pool });

  /**
   * Rows go out without the answer unless the caller is entitled to it, and
   * without the rating until enough people have solved the puzzle for it to
   * mean anything (or if the creator has chosen to hide it). The creator always
   * sees their own.
   */
  const publicPuzzle = (row, { includeSolution = false, includeRating = false } = {}) => {
    const { solution_line, ...rest } = row;
    const out = includeSolution ? { ...rest, solution_line: safeParse(solution_line) } : rest;
    out.rating_public = isRatingPublic(row);
    if (!includeRating && !out.rating_public) {
      delete out.rating;
      delete out.rating_sample_count;
    }
    return out;
  };

  const safeParse = (v, fallback = null) => {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (_) { return fallback; }
  };

  const loadPuzzle = async (id) => {
    const [[row]] = await db_pool.query('SELECT * FROM puzzles WHERE id = ? LIMIT 1', [id]);
    return row || null;
  };

  const canEdit = (puzzle, user) => !!user && (puzzle.creator_id === user.id || isStaff(user));

  /**
   * Every square a piece STARTS on in this game type, as "pieceId:player:y,x".
   *
   * Built from the game's own opening position, which is the only thing that can
   * answer "is this piece where it began?" - and that question is what decides
   * whether its first-move-only movement is still available.
   */
  /*
   * The rules to play this puzzle under: its snapshot if it has one, the live
   * game if it does not. Returns { game, pieces, placements, fromSnapshot }.
   */
  const loadRulesFor = (puzzle) => rulesForPuzzle(db_pool, puzzle);

  /** The live rules for a game, for a puzzle that does not exist yet. */
  const loadLiveRules = (gameTypeId) => readLive(db_pool, gameTypeId);

  /**
   * The game type's OPENING position, hydrated the same way a puzzle position is.
   *
   * This is what the engine means by initialPieces, and promotion needs it: the
   * menu of what a piece may become is built from the piece types the game
   * started with, so a queen that has already been captured is still an option.
   * A puzzle position is a handful of pieces and makes a terrible substitute -
   * a pawn one square from promoting with only kings left would be offered
   * nothing, and the promotion would be skipped without a word.
   */
  const loadStartingRoster = async (rules) => {
    const gameType = rules?.game;
    if (!gameType?.pieces_string) return [];
    const parsed = safeParse(gameType.pieces_string, null);
    if (!parsed || typeof parsed !== 'object') return [];
    // pieces_string is keyed "y,x"; the placements carry their own x/y for the
    // ones that were written with them.
    const list = Object.entries(parsed).map(([key, v]) => {
      const [y, x] = String(key).split(',').map(Number);
      return { ...v, x: v.x ?? x, y: v.y ?? y };
    });
    return hydratePosition(rules, list);
  };

  // ---------------------------------------------------------------- browse --
  // Published puzzles for one game type. Drafts are private to their creator.
  app.get('/api/game-types/:gameTypeId/puzzles', async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const [rows] = await db_pool.query(
        `SELECT p.id, p.game_type_id, p.creator_id, u.username AS creator_username,
                p.title, p.description, p.goal, p.goal_description, p.side_to_move,
                p.solution_depth,
                p.rating, p.rating_sample_count, p.hide_rating,
                p.attempt_count, p.solve_count, p.published_at, p.validation_status
         FROM puzzles p
         LEFT JOIN users u ON u.id = p.creator_id
         WHERE p.game_type_id = ? AND p.is_draft = 0 AND p.moderation_status = 'approved'
         ORDER BY p.published_at DESC
         LIMIT ? OFFSET ?`,
        [gameTypeId, limit, offset]
      );
      const [[{ total }]] = await db_pool.query(
        `SELECT COUNT(*) AS total FROM puzzles
         WHERE game_type_id = ? AND is_draft = 0 AND moderation_status = 'approved'`,
        [gameTypeId]
      );
      res.json({ puzzles: rows.map((r) => publicPuzzle(r)), total, limit, offset });
    } catch (err) {
      console.error('GET /api/game-types/:gameTypeId/puzzles:', err);
      res.status(500).send({ message: 'Failed to load puzzles' });
    }
  });

  // The creator's own puzzles, drafts included.
  app.get('/api/puzzles/mine', authenticateToken, async (req, res) => {
    try {
      const [rows] = await db_pool.query(
        `SELECT p.*, gt.game_name
         FROM puzzles p LEFT JOIN game_types gt ON gt.id = p.game_type_id
         WHERE p.creator_id = ? ORDER BY p.updated_at DESC`,
        [req.user.id]
      );
      res.json({ puzzles: rows.map((r) => publicPuzzle(r, { includeSolution: true, includeRating: true })) });
    } catch (err) {
      console.error('GET /api/puzzles/mine:', err);
      res.status(500).send({ message: 'Failed to load your puzzles' });
    }
  });

  /*
   * Every puzzle for this game type that the caller is allowed to edit, drafts
   * included - their own, or all of them for an admin or owner.
   *
   * Separate from the public browse route rather than a flag on it: that one is
   * a shelf for solvers and must never leak a draft, and mixing "what everyone
   * can see" with "what you may edit" into one endpoint is how it eventually
   * would. This one is for the builder's own list.
   */
  app.get('/api/game-types/:gameTypeId/puzzles/editable', authenticateToken, async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const staff = isStaff(req.user);
      const params = staff ? [gameTypeId] : [gameTypeId, req.user.id];
      const [rows] = await db_pool.query(
        `SELECT p.id, p.title, p.goal, p.goal_description, p.side_to_move, p.solution_depth,
                p.is_draft, p.creator_id, u.username AS creator_username,
                p.attempt_count, p.solve_count, p.updated_at, p.validation_status
         FROM puzzles p
         LEFT JOIN users u ON u.id = p.creator_id
         WHERE p.game_type_id = ?${staff ? '' : ' AND p.creator_id = ?'}
         ORDER BY p.is_draft DESC, p.updated_at DESC, p.id DESC
         LIMIT 200`,
        params
      );
      res.json({ puzzles: rows, staff });
    } catch (err) {
      console.error('GET /api/game-types/:gameTypeId/puzzles/editable:', err);
      res.status(500).send({ message: 'Failed to load puzzles' });
    }
  });

  /*
   * One published puzzle at random, preferring ones this solver has not tried.
   *
   * Once they have been through the lot the button still has to work, so it
   * falls back to the whole set and says so: a repeat is playable but cannot
   * move a rating, since only a first attempt is ever rated.
   *
   * Signed out, every puzzle is "unplayed" - there is nothing to remember them
   * by, and that is the honest answer rather than a reason to refuse.
   */
  app.get('/api/game-types/:gameTypeId/puzzles/random', optionalAuthenticate, async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const userId = req.user?.id || null;
      const published = `game_type_id = ? AND is_draft = 0 AND moderation_status = 'approved'`;

      let row = null;
      if (userId) {
        const [[fresh]] = await db_pool.query(
          `SELECT id FROM puzzles p
           WHERE ${published}
             AND NOT EXISTS (
               SELECT 1 FROM puzzle_attempts a WHERE a.puzzle_id = p.id AND a.user_id = ?
             )
           ORDER BY RAND() LIMIT 1`,
          [gameTypeId, userId]
        );
        row = fresh || null;
      }
      const unplayed = !!row;

      if (!row) {
        const [[any]] = await db_pool.query(
          `SELECT id FROM puzzles WHERE ${published} ORDER BY RAND() LIMIT 1`, [gameTypeId]
        );
        row = any || null;
      }
      if (!row) return res.status(404).send({ message: 'This game has no puzzles yet' });

      res.json({
        id: row.id,
        // Signed-out solvers get `unplayed: true` because nothing is tracked for
        // them; the client uses this only to decide whether to warn about rating.
        unplayed: userId ? unplayed : true,
      });
    } catch (err) {
      console.error('GET /api/game-types/:gameTypeId/puzzles/random:', err);
      res.status(500).send({ message: 'Failed to pick a puzzle' });
    }
  });

  // ---------------------------------------------------------------- detail --
  // optionalAuthenticate, not authenticateToken: anyone may read a published
  // puzzle, but the creator has to be recognised or they cannot open their own
  // draft and never get their own solution back.
  /*
   * ROUTE ORDER MATTERS HERE. These literal paths must be registered BEFORE
   * '/api/puzzles/:id', or Express matches "daily" as an id, parseInt gives NaN
   * and the home page is told there is no puzzle today - which is exactly what
   * happened.
   */
  /*
   * The daily puzzle, for the home page.
   *
   * Deliberately does NOT include the position or the solution - the card is a
   * hook, and the puzzle is played on its own page where the solve endpoint can
   * do its job. `?date=` reads a past day; future days are refused so the queue
   * cannot be read ahead.
   */
  app.get('/api/puzzles/daily', optionalAuthenticate, async (req, res) => {
    try {
      const today = dailyPuzzle.todayKey();
      let date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today;

      /*
       * ?preview=N walks N days FORWARD, for checking the card against boards of
       * different shapes without waiting a day per board.
       *
       * Development only. On production the queue is not readable ahead - part of
       * the point of scheduling is that tomorrow's puzzle is not spoilable - so
       * this is refused there even with the parameter present.
       */
      const preview = parseInt(req.query.preview, 10);
      if (Number.isFinite(preview) && preview > 0) {
        if (process.env.NODE_ENV === 'production') {
          return res.status(403).send({ message: 'Previewing future puzzles is disabled here' });
        }
        date = dailyPuzzle.addDays(today, Math.min(preview, dailyPuzzle.HORIZON_DAYS));
      } else if (date > today) {
        return res.status(400).send({ message: 'That day has not happened yet' });
      }

      const row = await dailyPuzzle.forDate(date);
      if (!row) {
        // No puzzle scheduled is a normal state, not an error - the queue can
        // legitimately be empty while there is nothing verified to put in it.
        return res.json({ date, puzzle: null, solvedByYou: false });
      }

      let solvedByYou = false;
      if (req.user?.id) {
        const [[hit]] = await db_pool.query(
          'SELECT 1 AS n FROM puzzle_attempts WHERE puzzle_id = ? AND user_id = ? AND solved = 1 LIMIT 1',
          [row.puzzle_id, req.user.id]
        );
        solvedByYou = !!hit;
      }

      /*
       * The position travels with the card so the home page can DRAW the puzzle.
       * That is the whole draw for a passer-by - a block of text about puzzles
       * is not one - and showing the position gives nothing away: the solution
       * is the secret, and it stays on the server as it does everywhere else.
       *
       * Only what the board needs to paint a square: who is on it and what it
       * looks like.
       */
      const stored = safeParse(row.position, []) || [];
      const pieceIds = [...new Set(stored.map(p => Number(p.piece_id)).filter(Boolean))];
      let art = new Map();
      if (pieceIds.length) {
        const [pieceRows] = await db_pool.query(
          `SELECT id, piece_name, image_location FROM pieces WHERE id IN (${pieceIds.map(() => '?').join(',')})`,
          pieceIds
        );
        art = new Map(pieceRows.map(r => [Number(r.id), r]));
      }
      const position = stored.map((pl) => {
        const def = art.get(Number(pl.piece_id)) || {};
        return {
          piece_id: pl.piece_id,
          player_id: Number(pl.player_id ?? pl.team ?? 1),
          x: Number(pl.x),
          y: Number(pl.y),
          piece_name: pl.piece_name || def.piece_name || null,
          image_url: pl.image_url || null,
          image_location: pl.image_location || def.image_location || null,
        };
      });

      const ratingPublic = isRatingPublic(row);
      res.json({
        date,
        solvedByYou,
        puzzle: {
          id: row.puzzle_id,
          game_type_id: row.game_type_id,
          game_name: row.game_name,
          board_width: row.board_width,
          board_height: row.board_height,
          position,
          title: row.title,
          description: row.description,
          goal: row.goal,
          goal_label: GOAL_DEFS[row.goal]?.label || null,
          side_to_move: row.side_to_move,
          solution_depth: row.solution_depth,
          creator_username: row.creator_username,
          attempt_count: row.attempt_count,
          solve_count: row.solve_count,
          rating: ratingPublic ? row.rating : null,
          rating_sample_count: ratingPublic ? row.rating_sample_count : null,
        },
      });
    } catch (err) {
      // A missing daily_puzzles table (migration not yet run) should leave the
      // home page working, not break it.
      if (err?.code === 'ER_NO_SUCH_TABLE') return res.json({ date: null, puzzle: null, solvedByYou: false });
      console.error('GET /api/puzzles/daily:', err);
      res.status(500).send({ message: 'Failed to load the daily puzzle' });
    }
  });

  /*
   * What it takes to be the daily puzzle.
   *
   * Public, and served from the same module the scheduler uses, so the list a
   * creator reads is the list actually being applied. A requirements page that
   * has drifted from the query behind it is worse than none.
   */
  app.get('/api/puzzles/daily/requirements', async (req, res) => {
    res.json({ requirements: DAILY_REQUIREMENTS, discretion: DAILY_DISCRETION });
  });

  // ------------------------------------------------------------ admin ----
  /*
   * The scheduled queue, for the admin dashboard: what is lined up, what is
   * eligible but unscheduled, and where the queue runs dry.
   */
  app.get('/api/admin/daily-puzzles', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const [rows] = await db_pool.query(
        `SELECT d.puzzle_date, d.puzzle_id, d.game_type_id, d.scheduled_at,
                p.title, p.goal, p.validation_status, p.rating, p.solution_depth,
                p.allow_daily, p.is_draft, p.moderation_status,
                gt.game_name, gt.board_width, gt.board_height,
                u.username AS creator_username,
                s.username AS scheduled_by_username
         FROM daily_puzzles d
         JOIN puzzles p ON p.id = d.puzzle_id
         JOIN game_types gt ON gt.id = d.game_type_id
         LEFT JOIN users u ON u.id = p.creator_id
         LEFT JOIN users s ON s.id = d.scheduled_by
         WHERE d.puzzle_date >= CURDATE() - INTERVAL 7 DAY
         ORDER BY d.puzzle_date`
      );
      const [[poolCounts]] = await db_pool.query(
        `SELECT
           SUM(status IN ('auto_included','included')) AS in_pool,
           SUM(status = 'review') AS awaiting,
           SUM(status IN ('auto_excluded','excluded')) AS excluded_count
         FROM puzzle_pool`
      );
      res.json({
        today: dailyPuzzle.todayKey(),
        horizonDays: dailyPuzzle.HORIZON_DAYS,
        scheduled: rows,
        eligibleUnscheduled: await dailyPuzzle.eligibleCount(),
        pool: poolCounts,
      });
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') {
        return res.json({ scheduled: [], eligibleUnscheduled: 0, pool: null, migrationPending: true });
      }
      console.error('GET /api/admin/daily-puzzles:', err);
      res.status(500).send({ message: 'Failed to load the daily puzzle queue' });
    }
  });

  /*
   * The review queue: games the sweep could not decide about on its own.
   *
   * A `review` row means the sweep found a game too similar to another to
   * auto-include, but not similar enough to drop without asking. Those games sit
   * OUT of the rotation until somebody rules on them, which is the safe default
   * but useless without somewhere to do the ruling - hence this.
   *
   * Each row comes back paired with the game it resembles, what the sweep matched
   * on, and how many usable puzzles each side already has - because "which of
   * these two do I keep" is much easier to answer when you can see that one of
   * them has a verified puzzle ready and the other has none.
   */
  app.get('/api/admin/puzzle-pool/review', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const [rows] = await db_pool.query(
        `SELECT pp.game_type_id, pp.status, pp.duplicate_of,
                pp.similarity_score, pp.similarity_kind, pp.note,
                gt.game_name, gt.board_width, gt.board_height,
                other.game_name AS other_name,
                other.board_width AS other_width, other.board_height AS other_height,
                (SELECT COUNT(*) FROM games g WHERE g.game_type_id = pp.game_type_id) AS plays,
                (SELECT COUNT(*) FROM games g WHERE g.game_type_id = pp.duplicate_of) AS other_plays,
                (SELECT COUNT(*) FROM puzzles p
                  WHERE p.game_type_id = pp.game_type_id
                    AND p.is_draft = 0 AND p.validation_status = 'valid') AS ready_puzzles,
                (SELECT COUNT(*) FROM puzzles p
                  WHERE p.game_type_id = pp.duplicate_of
                    AND p.is_draft = 0 AND p.validation_status = 'valid') AS other_ready_puzzles
         FROM puzzle_pool pp
         JOIN game_types gt ON gt.id = pp.game_type_id
         LEFT JOIN game_types other ON other.id = pp.duplicate_of
         WHERE pp.status = 'review'
         ORDER BY pp.similarity_score DESC, pp.game_type_id`
      );
      res.json({ review: rows });
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') return res.json({ review: [], migrationPending: true });
      console.error('GET /api/admin/puzzle-pool/review:', err);
      res.status(500).send({ message: 'Failed to load the review queue' });
    }
  });

  /*
   * Rule on one game. `included` and `excluded` are the human statuses, which
   * the sweep never overwrites - so a decision made here is permanent until
   * somebody changes it here again.
   */
  app.put('/api/admin/puzzle-pool/:gameTypeId', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const status = String(req.body?.status || '');
      if (!['included', 'excluded'].includes(status)) {
        return res.status(400).send({ message: "status must be 'included' or 'excluded'" });
      }
      const note = (req.body?.note || '').slice(0, 500) || null;
      const [result] = await db_pool.query(
        `UPDATE puzzle_pool
         SET status = ?, note = ?, decided_by = ?, decided_at = NOW(),
             exclusion_reason = CASE WHEN ? = 'excluded' THEN 'manual' ELSE NULL END
         WHERE game_type_id = ?`,
        [status, note, req.user.id, status, gameTypeId]
      );
      if (!result.affectedRows) return res.status(404).send({ message: 'That game is not in the pool table' });
      res.json({ message: status === 'included' ? 'Added to the pool' : 'Kept out of the pool' });
    } catch (err) {
      console.error('PUT /api/admin/puzzle-pool/:id:', err);
      res.status(500).send({ message: 'Failed to record that decision' });
    }
  });

  /*
   * Bring new games into the pool.
   *
   * Games are made all the time, and the pool has to notice. Rather than
   * re-deriving the whole sweep here (that lives in scripts/puzzle-pool-sweep.js,
   * where the duplicate detection belongs), this handles the case the sweep was
   * built for but cannot see on its own: a game that now has a usable puzzle, is
   * not already ruled on, and passes the Fairy-Stockfish, board-shape and
   * piece-variety requirements.
   *
   * Deliberately conservative. It only ever ADDS `auto_included` rows for games
   * with no row at all, so it can never overturn a human decision, never
   * resurrect something the sweep excluded, and never needs the duplicate
   * comparison - a brand new game that happens to duplicate an existing one is
   * caught the next time the full sweep runs.
   */
  app.post('/api/admin/puzzle-pool/refresh', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });

      // Games with at least one ready puzzle and no pool row yet.
      const [candidates] = await db_pool.query(
        `SELECT gt.*
         FROM game_types gt
         WHERE gt.is_draft = 0
           AND NOT EXISTS (SELECT 1 FROM puzzle_pool pp WHERE pp.game_type_id = gt.id)
           AND EXISTS (
             SELECT 1 FROM puzzles p
             WHERE p.game_type_id = gt.id
               AND p.is_draft = 0
               AND p.validation_status = 'valid'
               AND p.allow_daily = 1
           )`
      );

      const added = [];
      const rejected = [];
      for (const gt of candidates) {
        const [placements] = await db_pool.query(
          'SELECT * FROM game_type_pieces WHERE game_type_id = ?', [gt.id]
        );
        const reason = poolRejectionReason(gt, placements, await piecesFor(placements));
        if (reason) { rejected.push({ id: gt.id, name: gt.game_name, reason }); continue; }
        await db_pool.query(
          `INSERT INTO puzzle_pool (game_type_id, status, swept_at)
           VALUES (?, 'auto_included', NOW())
           ON DUPLICATE KEY UPDATE swept_at = NOW()`,
          [gt.id]
        );
        added.push({ id: gt.id, name: gt.game_name });
      }

      res.json({
        message: added.length
          ? `Added ${added.length} game(s) to the pool.`
          : 'No new games qualified.',
        added,
        rejected,
        considered: candidates.length,
      });
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') {
        return res.status(400).send({ message: 'The puzzle_pool table does not exist yet.' });
      }
      console.error('POST /api/admin/puzzle-pool/refresh:', err);
      res.status(500).send({ message: 'Failed to refresh the pool' });
    }
  });

  /** Piece rows for a set of placements, keyed by id. */
  const piecesFor = async (placements) => {
    const ids = [...new Set(placements.map(p => Number(p.piece_id)).filter(Boolean))];
    if (!ids.length) return new Map();
    const [rows] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`, ids
    );
    return new Map(rows.map(r => [Number(r.id), r]));
  };

  /**
   * Why this game cannot be in the pool, or null if it can.
   *
   * The same three requirements the sweep applies, minus the duplicate check -
   * see the note on the refresh route above for why that one is left out here.
   */
  const poolRejectionReason = (gameType, placements, pieceById) => {
    if (!placements.length) return 'no pieces placed';

    const defs = [...new Set(placements.map(p => Number(p.piece_id)).filter(Boolean))]
      .map(id => pieceById.get(id)).filter(Boolean);
    const compat = require('./ai/fairy-stockfish-compat')
      .checkCompatibility(gameType, defs, placements);
    if (compat.reasons.some(r => !r.safeToIgnore)) return 'rules Fairy-Stockfish cannot express';

    if (gameType.mate_condition_requires_all) return 'mate_condition_requires_all is not judged yet';

    const w = Number(gameType.board_width) || 0;
    const h = Number(gameType.board_height) || 0;
    if (!w || !h) return 'no board size';
    if (Math.max(w, h) / Math.min(w, h) > POOL_MAX_BOARD_ASPECT) {
      return `board is ${w}x${h}, further from square than 3:2`;
    }

    const kinds = (rows) => new Set(rows.map(x => x.piece_id).filter(Boolean)).size;
    const perSide = [1, 2].map(sd =>
      kinds(placements.filter(x => Number(x.player_number) === sd)));
    if (kinds(placements) < POOL_MIN_PIECE_TYPES || perSide.some(n => n < POOL_MIN_PIECE_TYPES)) {
      return `only ${kinds(placements)} piece type(s) (p1 ${perSide[0]}, p2 ${perSide[1]})`;
    }
    return null;
  };

  /** Put a specific puzzle on a specific day, replacing whatever was there. */
  app.put('/api/admin/daily-puzzles/:date', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const date = String(req.params.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).send({ message: 'Use a YYYY-MM-DD date' });
      }
      const puzzleId = parseInt(req.body?.puzzle_id, 10);
      const puzzle = await loadPuzzle(puzzleId);
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (puzzle.is_draft) return res.status(400).send({ message: 'That puzzle is still a draft' });

      /*
       * An admin may override the automatic requirements - that is the point of
       * being able to schedule by hand - but not the creator's own opt-out. If
       * somebody asked not to be featured, being an admin is not a reason to
       * overrule them.
       */
      if (!puzzle.allow_daily) {
        return res.status(400).send({
          message: 'That puzzle\'s creator has opted out of the daily rotation.',
        });
      }

      await db_pool.query(
        `INSERT INTO daily_puzzles (puzzle_date, puzzle_id, game_type_id, scheduled_by)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE
           puzzle_id = VALUES(puzzle_id),
           game_type_id = VALUES(game_type_id),
           scheduled_by = VALUES(scheduled_by),
           scheduled_at = NOW()`,
        [date, puzzle.id, puzzle.game_type_id, req.user.id]
      );
      res.json({ message: `Scheduled for ${date}`, puzzle_date: date, puzzle_id: puzzle.id });
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        return res.status(409).send({ message: 'That puzzle has already had a day.' });
      }
      console.error('PUT /api/admin/daily-puzzles/:date:', err);
      res.status(500).send({ message: 'Failed to schedule that puzzle' });
    }
  });

  /** Take a day out of the queue. The puzzle itself is untouched. */
  app.delete('/api/admin/daily-puzzles/:date', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const date = String(req.params.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).send({ message: 'Use a YYYY-MM-DD date' });
      }
      const [result] = await db_pool.query('DELETE FROM daily_puzzles WHERE puzzle_date = ?', [date]);
      if (!result.affectedRows) return res.status(404).send({ message: 'Nothing was scheduled for that day' });
      res.json({ message: `Cleared ${date}` });
    } catch (err) {
      console.error('DELETE /api/admin/daily-puzzles/:date:', err);
      res.status(500).send({ message: 'Failed to clear that day' });
    }
  });

  /** Top the queue back up to the horizon. */
  app.post('/api/admin/daily-puzzles/fill', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const result = await dailyPuzzle.fillQueue({ scheduledBy: req.user.id });
      res.json({
        message: result.scheduled.length
          ? `Scheduled ${result.scheduled.length} day(s), through ${result.filledThrough}.`
          : 'Nothing to schedule — no eligible puzzles are waiting.',
        ...result,
      });
    } catch (err) {
      console.error('POST /api/admin/daily-puzzles/fill:', err);
      res.status(500).send({ message: 'Failed to fill the queue' });
    }
  });

  /*
   * Where can this piece go?
   *
   * The solver page computes its own dots from the shared client engine, which
   * needs the full piece definitions - far too much JSON to ship to the home
   * page for one puzzle. So the home board asks instead: one small request per
   * piece clicked, answered by the same engine that will judge the move.
   *
   * This gives nothing away. It is the reachability of one piece, which is what
   * the board would show anyway; the ANSWER is which of those moves is right,
   * and that stays on the server.
   */
  app.get('/api/puzzles/:id/moves', optionalAuthenticate, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (puzzle.is_draft && !canEdit(puzzle, req.user || null)) {
        return res.status(404).send({ message: 'Puzzle not found' });
      }
      const x = Number(req.query.x);
      const y = Number(req.query.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return res.status(400).send({ message: 'x and y are required' });
      }

      const rules = await loadRulesFor(puzzle);
      if (!rules) return res.status(400).send({ message: 'Puzzle has no game type' });
      const gameType = rules.game;

      const state = buildGameState({
        position: await hydratePosition(rules, safeParse(puzzle.position, [])),
        initial_pieces: await loadStartingRoster(rules),
        side_to_move: puzzle.side_to_move,
        setup_move: safeParse(puzzle.setup_move),
        game_type_id: puzzle.game_type_id,
      }, gameType);

      const piece = state.pieces.find(p => Number(p.x) === x && Number(p.y) === y);
      if (!piece) return res.json({ moves: [] });
      const side = Number(piece.team ?? piece.player_id);

      /*
       * Any piece, not just the side to move - the solver page shows a piece's
       * raw reachability on hover whoever owns it, and this exists so the home
       * board can do the same. Seeing where an enemy piece could go is part of
       * reading the position, and gives nothing away: the answer is WHICH move
       * is right, and that stays on the server.
       */
      state.currentTurn = side;
      const all = getAllLegalMovesForPlayer(state, side) || [];
      const occupied = new Set(state.pieces.map(p => `${p.y},${p.x}`));
      const moves = all
        .filter(m => m.from.x === x && m.from.y === y)
        .map(m => ({
          x: m.to.x,
          y: m.to.y,
          isCapture: occupied.has(`${m.to.y},${m.to.x}`),
          isCastling: !!m.isCastling,
        }));

      /*
       * En passant is never enumerated by the move generator (it cannot see the
       * target), so it is added here the way the validator adds it - otherwise a
       * pawn that CAN take en passant shows no dot on the square where it lands
       * and the right answer looks illegal.
       */
      const ept = state.enPassantTarget;
      if (ept?.captureSquare && piece.can_en_passant) {
        const victim = state.pieces.find(p => p.id === ept.pieceId);
        if (victim && Number(victim.team ?? victim.player_id) !== side
            && piece.piece_id === victim.piece_id
            && piece.y === victim.y && Math.abs(piece.x - victim.x) === 1) {
          moves.push({ x: ept.captureSquare.x, y: ept.captureSquare.y, isCapture: true, isEnPassant: true });
        }
      }
      res.json({ moves });
    } catch (err) {
      console.error('GET /api/puzzles/:id/moves:', err);
      res.status(500).send({ message: "Failed to work out that piece's moves" });
    }
  });

  /*
   * The position as a PNG.
   *
   * For anywhere that cannot run the board component: a Discord channel post, a
   * link preview, an email. It shows exactly what the web board shows before a
   * solver touches anything - the position and the setup move - so it gives no
   * more away than the home page card does.
   *
   * Cached per (puzzle, board colours) for a day. The daily puzzle is one image
   * for everybody who sees the post, and re-composing it per request would make
   * a channel of a few hundred people expensive for no reason.
   */
  const imageCache = new Map();
  const IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
  const IMAGE_CACHE_MAX = 64;

  app.get('/api/puzzles/:id/image.png', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const light = typeof req.query.light === 'string' ? req.query.light.slice(0, 9) : '';
      const dark = typeof req.query.dark === 'string' ? req.query.dark.slice(0, 9) : '';
      const flip = req.query.flip === '1';
      const key = `${id}|${light}|${dark}|${flip ? 1 : 0}`;

      const hit = imageCache.get(key);
      if (hit && hit.expires > Date.now()) {
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(hit.png);
      }

      const puzzle = await loadPuzzle(id);
      // A draft has no public image, however it is asked for. This endpoint is
      // unauthenticated on purpose - Discord's proxy fetches it, not a browser
      // with a session - so "published" is the whole access rule.
      if (!puzzle || puzzle.is_draft || !puzzle.published_at) {
        return res.status(404).send({ message: 'Puzzle not found' });
      }

      const rules = await loadRulesFor(puzzle);
      const gameType = rules?.game;
      const stored = safeParse(puzzle.position, []) || [];
      const pieceIds = [...new Set(stored.map(p => Number(p.piece_id)).filter(Boolean))];
      let art = new Map();
      if (pieceIds.length) {
        const [pieceRows] = await db_pool.query(
          `SELECT id, piece_name, image_location FROM pieces WHERE id IN (${pieceIds.map(() => '?').join(',')})`,
          pieceIds
        );
        art = new Map(pieceRows.map(r => [Number(r.id), r]));
      }

      const png = await renderPuzzle({
        boardWidth: gameType?.board_width,
        boardHeight: gameType?.board_height,
        position: stored.map((pl) => {
          const def = art.get(Number(pl.piece_id)) || {};
          return {
            x: pl.x, y: pl.y,
            player_id: Number(pl.player_id ?? pl.team ?? 1),
            piece_name: pl.piece_name || def.piece_name || null,
            image_url: pl.image_url || null,
            image_location: pl.image_location || def.image_location || null,
          };
        }),
        uploadsBase: UPLOADS_BASE,
        lightColor: light || undefined,
        darkColor: dark || undefined,
        highlight: safeParse(puzzle.setup_move) || null,
        // The solver looks at the board from the side they are playing.
        flip: flip || Number(puzzle.side_to_move) === 2,
      });

      imageCache.set(key, { png, expires: Date.now() + IMAGE_TTL_MS });
      while (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);

      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(png);
    } catch (err) {
      console.error('GET /api/puzzles/:id/image.png:', err);
      res.status(500).send({ message: 'Could not draw that puzzle' });
    }
  });

  app.get('/api/puzzles/:id', optionalAuthenticate, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });

      // A draft is visible only to its creator (and staff).
      const viewer = req.user || null;
      if (puzzle.is_draft && !canEdit(puzzle, viewer)) {
        return res.status(404).send({ message: 'Puzzle not found' });
      }

      const includeSolution = canEdit(puzzle, viewer);
      const out = publicPuzzle(puzzle, { includeSolution, includeRating: includeSolution });
      out.position = safeParse(puzzle.position, []);
      out.setup_move = safeParse(puzzle.setup_move);

      /*
       * A solver may never have played this game. Everything they need to make
       * sense of the puzzle travels with it: what they are looking for, and the
       * game's rules for the expandable panel - so they never have to leave the
       * puzzle to find out how the game is won.
       */
      /*
       * The rules the puzzle was BUILT under, not whatever the game says today.
       * The rules panel has to describe the game the solver is about to be
       * judged against, or it is describing a different puzzle.
       */
      const rules = await loadRulesFor(puzzle);
      const gameType = rules?.game || null;
      // True when the game has been edited since - the page says so rather than
      // implying the current game.
      out.rules_snapshotted = !!rules?.fromSnapshot;
      out.rules_diverged_at = puzzle.rules_diverged_at || null;
      // The detail page shows who built it, beside the date.
      const [[creator]] = await db_pool.query(
        'SELECT username FROM users WHERE id = ? LIMIT 1', [puzzle.creator_id]
      );
      out.creator_username = creator?.username || null;

      out.goal_text = describeGoal(puzzle, gameType);
      out.goal_label = GOAL_DEFS[puzzle.goal]?.label || null;
      if (gameType) {
        out.game_name = gameType.game_name;
        // Fog is a rule of the game, so a puzzle in a fog game is played in fog.
        out.fog_of_war = !!gameType.fog_of_war;
        out.permanent_fog_reveal = !!gameType.permanent_fog_reveal;
        out.hide_enemy_pieces = !!gameType.hide_enemy_pieces;
        out.rules = summariseRules(gameType);

        /*
         * Three things the client cannot work out for itself, all derived from
         * one authoritative build of the position:
         *
         *  - the en passant target, which depends on whether the setup move was
         *    a first-move double step for that particular piece;
         *  - hasMoved, inferred from the game's own starting squares;
         *  - castling partner IDS, resolved from the game type's partner keys.
         *
         * The solver's board draws its move dots with the shared client engine,
         * and that engine reads exactly these fields off each piece. Leave them
         * off and a king that can castle simply shows no dot for it.
         */
        const state = buildGameState({
          position: await hydratePosition(rules, out.position),
          side_to_move: puzzle.side_to_move,
          setup_move: out.setup_move,
          game_type_id: puzzle.game_type_id,
        }, gameType);
        out.en_passant_target = state.enPassantTarget || null;

        const bySquare = new Map(state.pieces.map(p => [`${p.y},${p.x}`, p]));
        out.position = out.position.map((pl) => {
          const engine = bySquare.get(`${Number(pl.y)},${Number(pl.x)}`);
          if (!engine) return pl;
          return {
            ...pl,
            id: engine.id,
            hasMoved: !!engine.hasMoved,
            moveCount: Number(engine.moveCount) || 0,
            can_castle: !!engine.can_castle,
            castling_distance: engine.castling_distance ?? null,
            castling_partner_left_id: engine.castling_partner_left_id ?? null,
            castling_partner_right_id: engine.castling_partner_right_id ?? null,
          };
        });
      }
      res.json({ puzzle: out });
    } catch (err) {
      console.error('GET /api/puzzles/:id:', err);
      res.status(500).send({ message: 'Failed to load puzzle' });
    }
  });

  /*
   * Which goals this game can offer, for the builder's dropdown. Derived from
   * the game's own win conditions rather than a fixed list, so a creator is
   * never offered "stalemate the opponent" in a game with no stalemate rule.
   */
  /*
   * How many puzzles this account may still build for this game.
   *
   * The builder asks so it can say "2 of your 3 free puzzles left for this game"
   * rather than letting someone arrange a whole position and then refusing the
   * save. The server still enforces it on create - this is for the message.
   */
  app.get('/api/game-types/:gameTypeId/puzzle-allowance', authenticateToken, async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const allowance = await puzzleCreateAllowance(req.user.id, gameTypeId);
      res.json(allowance);
    } catch (err) {
      console.error('GET /api/game-types/:id/puzzle-allowance:', err);
      res.status(500).send({ message: 'Failed to check your puzzle allowance' });
    }
  });

  app.get('/api/game-types/:gameTypeId/puzzle-goals', async (req, res) => {
    try {
      const [[gameType]] = await db_pool.query(
        'SELECT * FROM game_types WHERE id = ? LIMIT 1', [parseInt(req.params.gameTypeId, 10)]
      );
      if (!gameType) return res.status(404).send({ message: 'Game type not found' });
      res.json({
        goals: goalsForGameType(gameType).map(g => ({
          ...g,
          help: GOAL_DEFS[g.value].describe(gameType, {}),
        })),
        rules: summariseRules(gameType),
        fog_of_war: !!gameType.fog_of_war,
        hide_enemy_pieces: !!gameType.hide_enemy_pieces,
      });
    } catch (err) {
      console.error('GET /api/game-types/:id/puzzle-goals:', err);
      res.status(500).send({ message: 'Failed to load puzzle goals' });
    }
  });

  /*
   * Everything the client needs to know about a move it is about to record.
   *
   * Two questions, one round trip, because both have the same answer shape: the
   * client can see WHERE a piece is going but not what that means.
   *
   *  - Does it promote, and into what? The options depend on per-placement
   *    promotion overrides, on which piece types the game started with, and on
   *    cross-player and neutral promotion targets.
   *  - Is it a castle? A king sliding two squares is only castling if the
   *    partner is there, unmoved, with a clear path and no square under attack.
   *    The engine already answers that when it enumerates moves; asking it is
   *    far safer than re-deriving "was that two squares sideways" on the client.
   *
   * Returns { promotes: false, castling: null } for an ordinary move, so callers
   * can ask about every move without special-casing.
   */
  app.post('/api/game-types/:gameTypeId/puzzle-move-info', optionalAuthenticate, async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const [[gameType]] = await db_pool.query(
        'SELECT * FROM game_types WHERE id = ? LIMIT 1', [gameTypeId]
      );
      if (!gameType) return res.status(404).send({ message: 'Game type not found' });

      const { position, side_to_move, setup_move, move } = req.body || {};
      if (!Array.isArray(position) || !move?.from || !move?.to) {
        return res.status(400).send({ message: 'A position and a move are required' });
      }

      /*
       * Live rules, deliberately. This serves the BUILDER, working on a puzzle
       * that does not exist yet and so has no snapshot - and which should be
       * built against the game as it is now, not as it once was.
       */
      const rules = await loadLiveRules(gameTypeId);
      const state = buildGameState({
        position: await hydratePosition(rules, position),
        initial_pieces: await loadStartingRoster(rules),
        side_to_move: Number(side_to_move) || 1,
        setup_move: setup_move || null,
        game_type_id: gameTypeId,
      }, gameType);

      const fromX = Number(move.from.x); const fromY = Number(move.from.y);
      const toX = Number(move.to.x); const toY = Number(move.to.y);
      const mover = state.pieces.find(p => Number(p.x) === fromX && Number(p.y) === fromY);
      if (!mover) return res.json({ promotes: false, options: [], castling: null });

      const moverSide = Number(mover.team ?? mover.player_id);

      /*
       * Castling, taken straight from the enumerated legal moves rather than
       * pattern-matched. Partners were resolved in buildGameState, so a move that
       * comes back flagged isCastling carries the partner id and the direction
       * that validateAndApplyMove will expect to see echoed back.
       */
      const legal = getAllLegalMovesForPlayer(state, moverSide) || [];
      const castleMove = legal.find(m =>
        m.from.x === fromX && m.from.y === fromY && m.to.x === toX && m.to.y === toY && m.isCastling);
      const castling = castleMove ? {
        isCastling: true,
        castlingWith: castleMove.castlingWith,
        castlingDirection: castleMove.castlingDirection,
        partnerName: state.pieces.find(p => p.id === castleMove.castlingWith)?.piece_name || null,
      } : null;

      // Ask the same question a live game asks, about the destination square.
      const eligibility = await checkPromotionEligibility(mover, { x: toX, y: toY }, state);
      if (!eligibility || !eligibility.eligible) {
        return res.json({ promotes: false, skipped: !!eligibility?.skipped, options: [], castling });
      }
      res.json({
        promotes: true,
        castling,
        options: (eligibility.options || []).map(o => ({
          id: o.id ?? o.piece_id,
          piece_name: o.piece_name,
          image_location: o.image_location,
          player: o.player ?? null,
        })),
      });
    } catch (err) {
      console.error('POST /api/game-types/:id/puzzle-move-info:', err);
      res.status(500).send({ message: 'Failed to inspect that move' });
    }
  });

  // ---------------------------------------------------------------- create --
  app.post('/api/game-types/:gameTypeId/puzzles', authenticateToken, async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const [[gameType]] = await db_pool.query('SELECT * FROM game_types WHERE id = ? LIMIT 1', [gameTypeId]);
      if (!gameType) return res.status(404).send({ message: 'Game type not found' });

      /*
       * Free accounts get a real go at this - PUZZLE_FREE_PER_GAME puzzles for
       * this game - and supporters get the run of it, under a daily ceiling that
       * exists for scripts rather than for people. The allowance says which
       * limit was hit, so the message can be specific instead of "no".
       */
      const allowance = await puzzleCreateAllowance(req.user.id, gameTypeId);
      if (!allowance.allowed) {
        return res.status(403).send({
          message: allowance.reason,
          requiresSupporter: !!allowance.requiresSupporter,
          allowance,
        });
      }

      const {
        title, description, position, side_to_move, setup_move,
        goal, goal_description, solution_line, allow_daily,
      } = req.body || {};

      if (!Array.isArray(position) || position.length === 0) {
        return res.status(400).send({ message: 'A puzzle needs a starting position' });
      }
      /*
       * A mechanical goal describes itself - describeGoal writes the sentence
       * the solver reads - so only the goals the server cannot score need the
       * creator to say what they are aiming for.
       */
      const goalValue = GOAL_DEFS[goal] ? goal : GOALS.CHECKMATE_IN_1;
      if (!MECHANICAL_GOALS.has(goalValue) && !String(goal_description || '').trim()) {
        return res.status(400).send({
          message: 'Tell the solver what they are aiming for (e.g. "win the rook")',
        });
      }

      const { line, error: lineError } = sanitizeLine(solution_line);
      if (lineError) return res.status(400).send({ message: lineError });
      const [result] = await db_pool.query(
        `INSERT INTO puzzles
          (game_type_id, creator_id, title, description, position, side_to_move, setup_move,
           goal, goal_description, solution_line, solution_depth, allow_daily, is_draft)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          gameTypeId, req.user.id,
          (title || '').slice(0, MAX_TITLE) || null,
          (description || '').slice(0, MAX_DESCRIPTION) || null,
          JSON.stringify(position),
          side_to_move === 2 ? 2 : 1,
          setup_move ? JSON.stringify(setup_move) : null,
          goalValue,
          (goal_description || '').slice(0, 255) || null,
          JSON.stringify(line),
          // Depth is what the solver has to find, so it counts their moves only.
          solverPlies(line).length,
          // Opted in unless the creator said otherwise.
          allow_daily === false ? 0 : 1,
        ]
      );
      const created = await loadPuzzle(result.insertId);
      res.status(201).json({ puzzle: publicPuzzle(created, { includeSolution: true }) });
    } catch (err) {
      console.error('POST /api/game-types/:gameTypeId/puzzles:', err);
      res.status(500).send({ message: 'Failed to create puzzle' });
    }
  });

  // ---------------------------------------------------------------- update --
  app.put('/api/puzzles/:id', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) return res.status(403).send({ message: 'This is not your puzzle' });

      const fields = [];
      const values = [];
      const set = (col, val) => { fields.push(`${col} = ?`); values.push(val); };
      const b = req.body || {};

      if (b.title !== undefined) set('title', (b.title || '').slice(0, MAX_TITLE) || null);
      if (b.description !== undefined) set('description', (b.description || '').slice(0, MAX_DESCRIPTION) || null);
      if (b.position !== undefined) set('position', JSON.stringify(b.position));
      if (b.side_to_move !== undefined) set('side_to_move', b.side_to_move === 2 ? 2 : 1);
      if (b.setup_move !== undefined) set('setup_move', b.setup_move ? JSON.stringify(b.setup_move) : null);
      if (b.goal !== undefined && GOAL_DEFS[b.goal]) set("goal", b.goal);
      if (b.allow_daily !== undefined) set('allow_daily', b.allow_daily ? 1 : 0);
      if (b.goal_description !== undefined) set('goal_description', (b.goal_description || '').slice(0, 255) || null);
      if (b.hide_rating !== undefined) set('hide_rating', b.hide_rating ? 1 : 0);
      if (b.solution_line !== undefined) {
        const { line, error: lineError } = sanitizeLine(b.solution_line);
        if (lineError) return res.status(400).send({ message: lineError });
        set('solution_line', JSON.stringify(line));
        set('solution_depth', solverPlies(line).length);
      }
      // Editing the puzzle invalidates whatever the validator last said.
      if (b.position !== undefined || b.solution_line !== undefined || b.goal !== undefined) {
        set('validation_status', 'unvalidated');
        set('validation_detail', null);
        set('validated_at', null);
      }
      if (!fields.length) return res.json({ puzzle: publicPuzzle(puzzle, { includeSolution: true }) });

      values.push(puzzle.id);
      await db_pool.query(`UPDATE puzzles SET ${fields.join(', ')} WHERE id = ?`, values);
      const updated = await loadPuzzle(puzzle.id);
      res.json({ puzzle: publicPuzzle(updated, { includeSolution: true }) });
    } catch (err) {
      console.error('PUT /api/puzzles/:id:', err);
      res.status(500).send({ message: 'Failed to update puzzle' });
    }
  });

  /*
   * Copy a puzzle into a new draft.
   *
   * For building a variation on a position rather than rebuilding it square by
   * square. The copy belongs to whoever made it - an admin duplicating someone
   * else's puzzle gets their own draft, not a second copy of theirs - and
   * starts unpublished with none of the original's history: attempts, ratings
   * and validation all belong to the puzzle that earned them.
   */
  app.post('/api/puzzles/:id/duplicate', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) {
        return res.status(403).send({ message: 'You can only duplicate your own puzzles' });
      }
      // Duplicating writes a new row, so it spends the same allowance as building
      // one from scratch - otherwise the cap is one click away from meaningless.
      const dupAllowance = await puzzleCreateAllowance(req.user.id, puzzle.game_type_id);
      if (!isStaff(req.user) && !dupAllowance.allowed) {
        return res.status(403).send({
          message: dupAllowance.reason,
          requiresSupporter: !!dupAllowance.requiresSupporter,
          allowance: dupAllowance,
        });
      }

      const title = `${puzzle.title || 'Untitled puzzle'} (Copy)`.slice(0, MAX_TITLE);
      const [result] = await db_pool.query(
        `INSERT INTO puzzles
           (game_type_id, creator_id, title, description, position, side_to_move, setup_move,
            goal, goal_description, solution_line, solution_depth, hide_rating, is_draft)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          puzzle.game_type_id, req.user.id, title, puzzle.description,
          puzzle.position, puzzle.side_to_move, puzzle.setup_move,
          puzzle.goal, puzzle.goal_description,
          puzzle.solution_line, puzzle.solution_depth, puzzle.hide_rating ? 1 : 0,
        ]
      );
      const created = await loadPuzzle(result.insertId);
      res.status(201).json({ puzzle: publicPuzzle(created, { includeSolution: true }) });
    } catch (err) {
      console.error('POST /api/puzzles/:id/duplicate:', err);
      res.status(500).send({ message: 'Failed to duplicate puzzle' });
    }
  });

  app.delete('/api/puzzles/:id', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) return res.status(403).send({ message: 'This is not your puzzle' });
      await db_pool.query('DELETE FROM puzzles WHERE id = ?', [puzzle.id]);
      res.json({ message: 'Puzzle deleted' });
    } catch (err) {
      console.error('DELETE /api/puzzles/:id:', err);
      res.status(500).send({ message: 'Failed to delete puzzle' });
    }
  });

  // -------------------------------------------------------------- validate --
  // Advisory. Reports what the server can work out and stores it, but never
  // refuses anything - a mate puzzle with two answers is still a puzzle.
  app.post('/api/puzzles/:id/validate', puzzleValidateLimiter, authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) return res.status(403).send({ message: 'This is not your puzzle' });

      /*
       * Validation re-checks against the LIVE game, not the snapshot. Asking
       * "does this puzzle still work?" of the rules it was verified under would
       * always answer yes and tell nobody anything; the question worth asking is
       * whether it still works against the game as it now stands.
       */
      const rules = await loadLiveRules(puzzle.game_type_id);
      if (!rules) return res.status(400).send({ message: 'Puzzle has no game type' });
      const gameType = rules.game;

      const hydrated = {
        ...puzzle,
        position: await hydratePosition(rules, safeParse(puzzle.position, [])),
        initial_pieces: await loadStartingRoster(rules),
        setup_move: safeParse(puzzle.setup_move),
        solution_line: safeParse(puzzle.solution_line, []),
      };
      const result = await validatePuzzle(hydrated, gameType);

      await db_pool.query(
        'UPDATE puzzles SET validation_status = ?, validation_detail = ?, validated_at = NOW() WHERE id = ?',
        [result.status, result.detail || null, puzzle.id]
      );
      res.json({
        status: result.status,
        detail: result.detail,
        solutionCount: result.solutions.length,
        alternatives: result.solutions.map(moveKey),
        blocksPublishing: false,
      });
    } catch (err) {
      console.error('POST /api/puzzles/:id/validate:', err);
      res.status(500).send({ message: 'Failed to validate puzzle' });
    }
  });

  // --------------------------------------------------------------- publish --
  app.post('/api/puzzles/:id/publish', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) return res.status(403).send({ message: 'This is not your puzzle' });

      const publish = req.body?.publish !== false;

      /*
       * Freeze the rules at the moment of publishing.
       *
       * Publishing is the point the puzzle stops being the author's private
       * draft and becomes something other people will be judged against, so it
       * is the right moment to fix what "correct" means. A draft deliberately
       * gets none: it should track the game while it is still being built.
       *
       * Best-effort - a puzzle that publishes without a snapshot still works,
       * it just falls back to live rules until the backfill catches it.
       */
      let snapshot = puzzle.rule_snapshot || null;
      if (publish) {
        try {
          snapshot = await ensureSnapshot(db_pool, puzzle.game_type_id) || snapshot;
        } catch (e) {
          console.warn('[puzzle] could not snapshot rules on publish:', e.message);
        }
      }

      await db_pool.query(
        'UPDATE puzzles SET is_draft = ?, published_at = ?, rule_snapshot = ?, rules_diverged_at = NULL WHERE id = ?',
        [publish ? 0 : 1, publish ? new Date() : null, snapshot, puzzle.id]
      );
      res.json({ message: publish ? 'Puzzle published' : 'Puzzle returned to draft', is_draft: publish ? 0 : 1 });
    } catch (err) {
      console.error('POST /api/puzzles/:id/publish:', err);
      res.status(500).send({ message: 'Failed to publish puzzle' });
    }
  });

  // ----------------------------------------------------------------- solve --
  // The answer is checked HERE. The client never receives solution_line for a
  // puzzle it has not solved, so the check cannot be done client-side.
  // optionalAuthenticate so guests can solve, but a signed-in solver's attempt
  // is recorded against them - without it every attempt lands as anonymous and
  // nobody has a puzzle history.
  /*
   * `optionalDiscord` runs alongside `optionalAuthenticate`, not instead of it.
   * The two answer different questions - "which GridGrove account is this" and
   * "which Discord person is this" - and a player in the activity who also has
   * an account is both at once: the attempt rates their account AND continues
   * their Discord streak.
   */
  app.post('/api/puzzles/:id/solve', optionalAuthenticate, optionalDiscord, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (puzzle.is_draft) return res.status(404).send({ message: 'Puzzle not found' });

      const submitted = Array.isArray(req.body?.moves) ? req.body.moves : [req.body?.move].filter(Boolean);
      const revealed = req.body?.revealed === true;
      if (!submitted.length && !revealed) return res.status(400).send({ message: 'No moves submitted' });

      const line = safeParse(puzzle.solution_line, []);
      const mine = solverPlies(line);      // the moves the solver has to find
      const theirs = replyPlies(line);     // the creator's scripted answers

      /*
       * One number decides everything: how many of the solver's moves, from the
       * first, match the line. "off the line", "keep going" and "solved" are all
       * derived from it, so they cannot disagree with each other.
       *
       * The client re-sends the whole prefix each time rather than just the
       * newest move, which keeps this endpoint stateless - a reload mid-puzzle
       * picks up exactly where it left off.
       */
      let matched = 0;
      while (matched < submitted.length && matched < mine.length
             && moveKey(submitted[matched]) === moveKey(mine[matched])) matched++;

      const wrong = !revealed && matched < submitted.length;
      const solved = !revealed && !wrong && mine.length > 0 && matched === mine.length;
      const inProgress = !revealed && !wrong && !solved;
      const terminal = !inProgress;
      // Same prefix rule as everywhere else: miss the first move and it is zero.
      const score = scoreAttempt(submitted.slice(0, matched), mine, (a, b) => moveKey(a) === moveKey(b));
      const scorePct = Math.round(score * 100);

      const userId = req.user?.id || null;
      // Where this attempt was played. Only a token Discord itself vouched for
      // can set it to 'discord'; the client cannot claim the surface.
      const discordId = req.discord?.id || null;
      const source = discordId ? 'discord' : 'web';
      let ratingChange = null;
      let ratingNote = null;

      if (!userId) {
        // Nothing to rate, and a half-played line is not worth a row.
        if (terminal) {
          await db_pool.query(
            `INSERT INTO puzzle_attempts
               (puzzle_id, user_id, moves, solved, duration_ms, score, source, discord_user_id)
             VALUES (?,?,?,?,?,?,?,?)`,
            [puzzle.id, null, JSON.stringify(submitted), solved ? 1 : 0,
             Number.isFinite(req.body?.duration_ms) ? req.body.duration_ms : null, scorePct,
             source, discordId]
          );
        }
      } else {
        const [[open]] = await db_pool.query(
          `SELECT id, rating_before, rating_after, score, state
           FROM puzzle_attempts WHERE puzzle_id = ? AND user_id = ? AND rated_attempt = 1 LIMIT 1`,
          [puzzle.id, userId]
        );

        if (!open) {
          /*
           * Their first attempt at this puzzle, and the only one that will ever
           * count. It is written NOW rather than when the line finishes, so
           * walking away from a half-solved multi-move puzzle keeps the partial
           * score instead of costing nothing - otherwise a solver could probe a
           * move, abandon, and come back knowing the answer for free.
           */
          const [[u]] = await db_pool.query('SELECT puzzle_elo FROM users WHERE id = ? LIMIT 1', [userId]);
          const [[counts]] = await db_pool.query(
            'SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id = ? AND rated_attempt = 1', [userId]
          );
          const before = u?.puzzle_elo ?? PUZZLE_ELO_DEFAULT;
          const result = rateAttempt({
            currentElo: before,
            ratedAttemptsSoFar: counts?.n || 0,
            score,
          });
          try {
            await db_pool.query(
              `INSERT INTO puzzle_attempts
                 (puzzle_id, user_id, moves, solved, duration_ms, rated_attempt,
                  rating_before, rating_after, score, state, source, discord_user_id)
               VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`,
              [puzzle.id, userId, JSON.stringify(submitted), solved ? 1 : 0,
               Number.isFinite(req.body?.duration_ms) ? req.body.duration_ms : null,
               result.before, result.after, scorePct, terminal ? null : 'in_progress',
               source, discordId]
            );
            await db_pool.query(
              'UPDATE users SET puzzle_elo = puzzle_elo + ? WHERE id = ?', [result.delta, userId]
            );
            ratingChange = {
              before: result.before, after: result.after, delta: result.delta,
              score: result.score, partial: result.score > 0 && result.score < 1,
            };
          } catch (e) {
            // Two requests raced for the one rated slot; the loser is unrated.
            if (e?.code !== 'ER_DUP_ENTRY') throw e;
          }
        } else if (open.state === 'in_progress') {
          /*
           * The same first attempt, further along. Re-score it from the rating
           * it started at and apply only the difference, so the rating cannot
           * drift as the line is played out, and an attempt at some other puzzle
           * in between is not clobbered.
           *
           * The score only ever goes up: restarting and stopping earlier should
           * not be able to take back ground already covered.
           */
          const bestPct = Math.max(scorePct, open.score || 0);
          const [[counts]] = await db_pool.query(
            'SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id = ? AND rated_attempt = 1', [userId]
          );
          const result = rateAttempt({
            currentElo: open.rating_before,
            ratedAttemptsSoFar: Math.max(0, (counts?.n || 1) - 1),
            score: bestPct / 100,
          });
          const alreadyApplied = (open.rating_after ?? open.rating_before) - open.rating_before;
          await db_pool.query(
            'UPDATE users SET puzzle_elo = puzzle_elo + ? WHERE id = ?',
            [result.delta - alreadyApplied, userId]
          );
          await db_pool.query(
            `UPDATE puzzle_attempts
             SET moves = ?, solved = ?, score = ?, rating_after = ?, state = ?
             WHERE id = ?`,
            [JSON.stringify(submitted), solved ? 1 : 0, bestPct, result.after,
             terminal ? null : 'in_progress', open.id]
          );
          ratingChange = {
            before: result.before, after: result.after, delta: result.delta,
            score: result.score, partial: result.score > 0 && result.score < 1,
          };
        } else if (terminal) {
          // A retry after their rated attempt closed. Recorded, never rated.
          await db_pool.query(
            `INSERT INTO puzzle_attempts
               (puzzle_id, user_id, moves, solved, duration_ms, score, source, discord_user_id)
             VALUES (?,?,?,?,?,?,?,?)`,
            [puzzle.id, userId, JSON.stringify(submitted), solved ? 1 : 0,
             Number.isFinite(req.body?.duration_ms) ? req.body.duration_ms : null, scorePct,
             source, discordId]
          );
          ratingNote = 'Only your first attempt at a puzzle affects your rating.';
        }
      }

      // Counters describe finished attempts; a multi-move puzzle would
      // otherwise count one attempt per move played.
      if (terminal) {
        await db_pool.query(
          'UPDATE puzzles SET attempt_count = attempt_count + 1, solve_count = solve_count + ? WHERE id = ?',
          [solved ? 1 : 0, puzzle.id]
        );
        if (solved && userId) {
          const [[prev]] = await db_pool.query(
            'SELECT COUNT(*) AS n FROM puzzle_attempts WHERE puzzle_id = ? AND user_id = ? AND solved = 1',
            [puzzle.id, userId]
          );
          // The row for this solve is already in, so 1 means this was the first.
          if ((prev?.n || 0) <= 1) {
            await db_pool.query('UPDATE users SET puzzles_solved = puzzles_solved + 1 WHERE id = ?', [userId]);
          }
        }
      }

      /*
       * The Discord player's own record: streak, totals, and today's state.
       *
       * Deliberately outside the rating code above. A Discord streak and a
       * GridGrove rating measure different things - turning up, and playing
       * well - so a player with both gets both, and a player with neither
       * account still gets the streak.
       */
      let discordProgress = null;
      if (discordId && terminal) {
        try {
          const date = dailyPuzzle.todayKey();
          const todayRow = await dailyPuzzle.forDate(date);
          discordProgress = await recordDiscordAttempt(db_pool, req.discord, {
            solved,
            isDaily: Number(todayRow?.puzzle_id) === Number(puzzle.id),
            date,
            yesterday: dailyPuzzle.addDays(date, -1),
          });
        } catch (e) {
          // A streak is a nicety. Losing it must not lose the solve, which is
          // already written by this point.
          console.warn('[discord] could not record progress:', e.message);
        }
      }

      // The puzzle's own rating is the mean of the people who SOLVED it, so
      // only a success is folded in, and only on the attempt that counted.
      if (solved && ratingChange) {
        const folded = foldSolverIntoPuzzleRating({
          rating: puzzle.rating,
          sampleCount: puzzle.rating_sample_count,
          solverElo: ratingChange.before,
        });
        await db_pool.query(
          'UPDATE puzzles SET rating = ?, rating_sample_count = ? WHERE id = ?',
          [folded.rating, folded.sampleCount, puzzle.id]
        );
      }

      res.json({
        solved,
        status: solved ? 'solved' : (revealed ? 'revealed' : (wrong ? 'wrong' : 'continue')),
        movesPlayed: matched,
        movesTotal: mine.length,
        /*
         * The opponent's answer to the move just found. Handing this back is not
         * a leak - it is the consequence of a move the solver already played,
         * and without it they cannot see the position their next move starts
         * from.
         */
        reply: inProgress ? (theirs[matched - 1] ?? null) : null,
        // The whole line only once they have it, or have given up on it.
        solution: solved || revealed ? line : undefined,
        rating: ratingChange,
        ratingNote: ratingChange ? null : (userId ? ratingNote : null),
        // Only present for the Discord activity; the website ignores it.
        discord: discordProgress,
      });
    } catch (err) {
      console.error('POST /api/puzzles/:id/solve:', err);
      res.status(500).send({ message: 'Failed to record attempt' });
    }
  });

  // -------------------------------------------------------------- feedback --
  // Critique addressed to the creator. It cannot unpublish a puzzle or mark it
  // invalid; the message is required so this cannot become a one-click
  // "this is bad" button.
  app.post('/api/puzzles/:id/feedback', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });

      const message = String(req.body?.message || '').trim();
      if (message.length < MIN_FEEDBACK) {
        return res.status(400).send({
          message: `Please say a bit more about what you noticed (at least ${MIN_FEEDBACK} characters) - this goes to the puzzle's creator.`,
        });
      }
      const allowed = ['multiple_solutions', 'no_solution', 'unclear_goal', 'too_easy', 'too_hard', 'praise', 'other'];
      const category = allowed.includes(req.body?.category) ? req.body.category : 'other';

      await db_pool.query(
        `INSERT INTO puzzle_feedback (puzzle_id, reporter_user_id, category, message, alternate_solution)
         VALUES (?,?,?,?,?)`,
        [puzzle.id, req.user.id, category, message.slice(0, MAX_FEEDBACK),
         req.body?.alternate_solution ? JSON.stringify(req.body.alternate_solution) : null]
      );
      await db_pool.query('UPDATE puzzles SET feedback_count = feedback_count + 1 WHERE id = ?', [puzzle.id]);

      res.status(201).json({ message: 'Sent to the puzzle\'s creator. Thanks for the note.' });
    } catch (err) {
      console.error('POST /api/puzzles/:id/feedback:', err);
      res.status(500).send({ message: 'Failed to send feedback' });
    }
  });

  // The creator reads their own puzzle's feedback.
  app.get('/api/puzzles/:id/feedback', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) return res.status(403).send({ message: 'This is not your puzzle' });

      const [rows] = await db_pool.query(
        `SELECT f.*, u.username AS reporter_username
         FROM puzzle_feedback f LEFT JOIN users u ON u.id = f.reporter_user_id
         WHERE f.puzzle_id = ? ORDER BY f.created_at DESC`,
        [puzzle.id]
      );
      res.json({ feedback: rows });
    } catch (err) {
      console.error('GET /api/puzzles/:id/feedback:', err);
      res.status(500).send({ message: 'Failed to load feedback' });
    }
  });

  app.put('/api/puzzle-feedback/:feedbackId', authenticateToken, async (req, res) => {
    try {
      const [[row]] = await db_pool.query(
        `SELECT f.*, p.creator_id FROM puzzle_feedback f
         JOIN puzzles p ON p.id = f.puzzle_id WHERE f.id = ? LIMIT 1`,
        [parseInt(req.params.feedbackId, 10)]
      );
      if (!row) return res.status(404).send({ message: 'Feedback not found' });
      if (row.creator_id !== req.user.id && !isStaff(req.user)) {
        return res.status(403).send({ message: 'This is not your puzzle' });
      }
      const status = ['new', 'read', 'addressed'].includes(req.body?.status) ? req.body.status : 'read';
      await db_pool.query(
        'UPDATE puzzle_feedback SET status = ?, acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ?',
        [status, req.user.id, row.id]
      );
      res.json({ message: 'Updated', status });
    } catch (err) {
      console.error('PUT /api/puzzle-feedback/:feedbackId:', err);
      res.status(500).send({ message: 'Failed to update feedback' });
    }
  });

  // --------------------------------------------------------------- history --
  app.get('/api/users/:userId/puzzle-history', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const [rows] = await db_pool.query(
        `SELECT a.id, a.puzzle_id, a.solved, a.duration_ms, a.created_at,
                p.title, p.goal, p.rating, p.game_type_id, gt.game_name
         FROM puzzle_attempts a
         JOIN puzzles p ON p.id = a.puzzle_id
         LEFT JOIN game_types gt ON gt.id = p.game_type_id
         WHERE a.user_id = ?
         ORDER BY a.created_at DESC LIMIT 100`,
        [userId]
      );
      const [[stats]] = await db_pool.query(
        `SELECT puzzle_elo, puzzles_solved FROM users WHERE id = ? LIMIT 1`, [userId]
      );
      res.json({ attempts: rows, puzzle_elo: stats?.puzzle_elo ?? null, puzzles_solved: stats?.puzzles_solved ?? 0 });
    } catch (err) {
      console.error('GET /api/users/:userId/puzzle-history:', err);
      res.status(500).send({ message: 'Failed to load puzzle history' });
    }
  });
}

module.exports = { registerPuzzleRoutes };
