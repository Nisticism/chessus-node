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
const { validatePuzzle, moveKey, GOALS, VALIDATION } = require('./puzzle-validation');
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
const ENGINE_FIELD_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};

/** Rename the engine-facing fields on a raw `pieces` row. */
function toEngineFields(row) {
  const out = { ...row };
  for (const [from, to] of Object.entries(ENGINE_FIELD_RENAMES)) {
    if (row[from] !== undefined) out[to] = row[from];
  }
  return out;
}

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

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_FEEDBACK = 2000;
const MIN_FEEDBACK = 10;

function registerPuzzleRoutes(app, { db_pool, dbHelpers, authenticateToken, optionalAuthenticate, hasAdminRole, canCreatePuzzles }) {
  const isStaff = (user) => hasAdminRole(user?.role);

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
   * Turn a stored position into pieces the move engine understands.
   *
   * A puzzle stores placements in the same compact shape as a game type's
   * pieces_string - piece_id, player_id, x, y, plus the per-game-type flags -
   * rather than sixty movement columns per square. The movement fields are
   * merged in here from the pieces table.
   *
   * ends_game_on_checkmate is the one to be careful with: it is a property of a
   * piece IN A GAME TYPE, so it rides on the placement, not on the piece row.
   * Lose it and the engine sees no royal piece, nothing is ever check, and a
   * mate puzzle silently reports as unsolvable rather than erroring.
   */
  const hydratePosition = async (gameTypeId, placements) => {
    const list = Array.isArray(placements) ? placements : [];
    if (!list.length) return [];

    const pieceIds = [...new Set(list.map((p) => Number(p.piece_id)).filter(Boolean))];
    if (!pieceIds.length) return [];
    const [rows] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${pieceIds.map(() => '?').join(',')})`, pieceIds
    );
    const byId = new Map(rows.map((r) => [Number(r.id), r]));

    // Fall back to the junction flags when a placement did not carry them.
    const [flagRows] = await db_pool.query(
      `SELECT piece_id, ends_game_on_checkmate, ends_game_on_capture
       FROM game_type_pieces WHERE game_type_id = ?`, [gameTypeId]
    );
    const flagById = new Map(flagRows.map((r) => [Number(r.piece_id), r]));

    return list.map((p, i) => {
      const def = toEngineFields(byId.get(Number(p.piece_id)) || {});
      const fallback = flagById.get(Number(p.piece_id)) || {};
      const player = Number(p.player_id ?? p.team ?? 1);
      return {
        ...def,
        // Board identity, not the piece-definition id.
        id: p.id || `${p.piece_id}_${p.y}_${p.x}`,
        piece_id: p.piece_id,
        x: Number(p.x),
        y: Number(p.y),
        player_id: player,
        team: player,
        ends_game_on_checkmate: p.ends_game_on_checkmate ?? fallback.ends_game_on_checkmate ?? false,
        ends_game_on_capture: p.ends_game_on_capture ?? fallback.ends_game_on_capture ?? false,
      };
    });
  };

  const loadGameTypeFor = async (puzzle) => {
    const [[gt]] = await db_pool.query('SELECT * FROM game_types WHERE id = ? LIMIT 1', [puzzle.game_type_id]);
    return gt || null;
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
      res.json({ puzzle: out });
    } catch (err) {
      console.error('GET /api/puzzles/:id:', err);
      res.status(500).send({ message: 'Failed to load puzzle' });
    }
  });

  // ---------------------------------------------------------------- create --
  app.post('/api/game-types/:gameTypeId/puzzles', authenticateToken, async (req, res) => {
    try {
      const gameTypeId = parseInt(req.params.gameTypeId, 10);
      const [[gameType]] = await db_pool.query('SELECT * FROM game_types WHERE id = ? LIMIT 1', [gameTypeId]);
      if (!gameType) return res.status(404).send({ message: 'Game type not found' });

      // Authoring is the Silver perk; solving stays open to everyone.
      if (!(await canCreatePuzzles(req.user.id))) {
        return res.status(403).send({
          message: 'Building puzzles is a Silver Supporter perk. Solving them is free for everyone.',
          requiresSupporter: true,
        });
      }

      const {
        title, description, position, side_to_move, setup_move,
        goal, goal_description, solution_line,
      } = req.body || {};

      if (!Array.isArray(position) || position.length === 0) {
        return res.status(400).send({ message: 'A puzzle needs a starting position' });
      }
      const goalValue = Object.values(GOALS).includes(goal) ? goal : GOALS.CHECKMATE_IN_1;
      if (goalValue !== GOALS.CHECKMATE_IN_1 && !String(goal_description || '').trim()) {
        return res.status(400).send({
          message: 'Tell the solver what they are aiming for (e.g. "win the rook")',
        });
      }

      const { line, error: lineError } = sanitizeLine(solution_line);
      if (lineError) return res.status(400).send({ message: lineError });
      const [result] = await db_pool.query(
        `INSERT INTO puzzles
          (game_type_id, creator_id, title, description, position, side_to_move, setup_move,
           goal, goal_description, solution_line, solution_depth, is_draft)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
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
      if (b.goal !== undefined && Object.values(GOALS).includes(b.goal)) set('goal', b.goal);
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
      // Duplicating creates a puzzle, so it needs the same permission creating
      // one does - otherwise this is a way around the supporter gate.
      if (!isStaff(req.user) && !(await canCreatePuzzles(req.user.id))) {
        return res.status(403).send({
          message: 'Building puzzles is a Silver Supporter perk. Solving them is free for everyone.',
          requiresSupporter: true,
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
  app.post('/api/puzzles/:id/validate', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!canEdit(puzzle, req.user)) return res.status(403).send({ message: 'This is not your puzzle' });

      const gameType = await loadGameTypeFor(puzzle);
      if (!gameType) return res.status(400).send({ message: 'Puzzle has no game type' });

      const hydrated = {
        ...puzzle,
        position: await hydratePosition(puzzle.game_type_id, safeParse(puzzle.position, [])),
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
      await db_pool.query(
        'UPDATE puzzles SET is_draft = ?, published_at = ? WHERE id = ?',
        [publish ? 0 : 1, publish ? new Date() : null, puzzle.id]
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
  app.post('/api/puzzles/:id/solve', optionalAuthenticate, async (req, res) => {
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
      let ratingChange = null;
      let ratingNote = null;

      if (!userId) {
        // Nothing to rate, and a half-played line is not worth a row.
        if (terminal) {
          await db_pool.query(
            `INSERT INTO puzzle_attempts (puzzle_id, user_id, moves, solved, duration_ms, score)
             VALUES (?,?,?,?,?,?)`,
            [puzzle.id, null, JSON.stringify(submitted), solved ? 1 : 0,
             Number.isFinite(req.body?.duration_ms) ? req.body.duration_ms : null, scorePct]
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
                  rating_before, rating_after, score, state)
               VALUES (?,?,?,?,?,1,?,?,?,?)`,
              [puzzle.id, userId, JSON.stringify(submitted), solved ? 1 : 0,
               Number.isFinite(req.body?.duration_ms) ? req.body.duration_ms : null,
               result.before, result.after, scorePct, terminal ? null : 'in_progress']
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
            `INSERT INTO puzzle_attempts (puzzle_id, user_id, moves, solved, duration_ms, score)
             VALUES (?,?,?,?,?,?)`,
            [puzzle.id, userId, JSON.stringify(submitted), solved ? 1 : 0,
             Number.isFinite(req.body?.duration_ms) ? req.body.duration_ms : null, scorePct]
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
