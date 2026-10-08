/*
 * The "verified unique solution" badge, beyond what the builder's check can do.
 *
 * The builder's "Check puzzle" settles uniqueness for lines of up to three of
 * the solver's moves (puzzle-validation.js, in a background worker). Past that
 * the search is too long to run while somebody waits, so:
 *
 *   - a creator can REQUEST verification of a published puzzle; the site owner
 *     is notified, and the request shows on the admin Puzzle Verification tab;
 *   - staff can RUN a search of any puzzle from that tab. It runs in the 'long'
 *     job lane (puzzle-jobs.js): its own worker, a capped heap, a reduced CPU
 *     duty cycle, one at a time, for as long as it takes or until cancelled -
 *     and its verdict sets the badge;
 *   - staff can AWARD or REFUSE the badge by hand, for puzzles no search can
 *     judge (goals the engine cannot score, or simply too deep);
 *   - staff RESOLVE a request, and the requester is told the outcome and why.
 *
 * Badge state lives on the puzzle (unique_status / unique_method /
 * unique_detail); runs and requests in their own tables (migrations.js).
 */
const { startJob, getJob, cancelJob, activeJobs, limits } = require('./puzzle-jobs');
const { rulesForPuzzle } = require('./puzzle-snapshot');
const { hydratePosition, placeableDefinitions, startingRoster } = require('./puzzle-hydrate');
const { MECHANICAL_GOALS, GOAL_DEFS, lineWinsGame } = require('./puzzle-validation');

/*
 * Goals a search can judge: the engine-scored ones (losing your last piece
 * included - the search looks through the reply that takes it), and "find this
 * exact move" when the line wins the game, searched against the game's own win.
 */
const searchableGoal = (goal) => MECHANICAL_GOALS.has(goal) || goal === 'specific_move';

const UNIQUE_STATUSES = new Set(['unchecked', 'verified', 'not_unique']);
// How staff may close a request. The "not optimal" ones say WHOSE move was not.
// Refusals that grade the line rather than count its solutions - each refuses the badge.
const NOT_OPTIMAL = new Set(['weak_reply', 'slow_move', 'not_optimal', 'goal_not_met', 'earlier_win']);
const RESOLVE_OUTCOMES = new Set(['verified', 'not_unique', 'weak_reply', 'slow_move', 'not_optimal', 'goal_not_met', 'earlier_win', 'not_verified']);
const MAX_NOTE = 500;
const MAX_REASON = 1000;

const safeParse = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
};

// What a puzzle asks, as one string: a run's verdict only applies if this is unchanged when it ends.
const fingerprint = (p) => JSON.stringify([p.position, p.solution_line, p.goal, Number(p.side_to_move), p.setup_move]);

const solverMovesOf = (p) => Math.ceil((safeParse(p.solution_line, []) || []).length / 2);

const puzzleUrl = (p) => `/games/${p.game_type_id}/puzzles/${p.id}`;

function registerPuzzleVerificationRoutes(app, { db_pool, dbHelpers, authenticateToken, hasAdminRole, puzzleValidateLimiter }) {
  const isStaff = (user) => hasAdminRole(user?.role);

  /*
   * A notification, pushed live if the person is online - the same two steps
   * every other notification on the site takes.
   */
  const notify = async (userId, { senderId = null, title, content, relatedId = null, actionUrl = null }) => {
    if (!userId) return;
    try {
      await dbHelpers.createNotification({
        user_id: userId, sender_id: senderId, type: 'system', title, content, related_id: relatedId, action_url: actionUrl,
      });
      const gameSocket = require('./game-socket');
      const socketId = gameSocket.userSockets?.get(String(userId));
      if (socketId && gameSocket.getIO()) {
        const unreadCount = await dbHelpers.getUnreadNotificationCount(userId);
        gameSocket.getIO().to(socketId).emit('newNotification', { type: 'system', title });
        gameSocket.getIO().to(socketId).emit('unreadNotificationCount', { unreadCount });
      }
    } catch (err) {
      console.error('[puzzle-verification] notification failed:', err.message);
    }
  };

  const loadPuzzle = async (id) => {
    const [[row]] = await db_pool.query('SELECT * FROM puzzles WHERE id = ? LIMIT 1', [id]);
    return row || null;
  };

  const setUnique = (puzzleId, { status, method, detail, by = null }) => db_pool.query(
    `UPDATE puzzles SET unique_status = ?, unique_method = ?, unique_detail = ?,
       unique_checked_at = ${status === 'unchecked' ? 'NULL' : 'NOW()'}, unique_checked_by = ? WHERE id = ?`,
    [status, status === 'unchecked' ? null : method, detail || null, status === 'unchecked' ? null : by, puzzleId]
  );

  const openRequestFor = async (puzzleId) => {
    const [[row]] = await db_pool.query(
      `SELECT r.*, u.username AS requester_username FROM puzzle_verification_requests r
       LEFT JOIN users u ON u.id = r.requester_id
       WHERE r.puzzle_id = ? AND r.status = 'open' ORDER BY r.id DESC LIMIT 1`, [puzzleId]
    );
    return row || null;
  };

  // A staff run of this puzzle still queued or running, if any.
  const liveRunFor = (puzzleId) => activeJobs((j) => j.kind === 'verify' && j.meta?.puzzleId === puzzleId)[0] || null;

  /* ----------------------------------------------------------- creators -- */

  /*
   * The creator's view of the badge on one of their puzzles: where it stands,
   * and their latest request. (Anyone can see the badge itself - it travels
   * with the puzzle.)
   */
  app.get('/api/puzzles/:id/verification', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (puzzle.creator_id !== req.user.id && !isStaff(req.user)) return res.status(403).send({ message: 'This is not your puzzle' });
      const [[request]] = await db_pool.query(
        `SELECT id, status, note, resolution, created_at, resolved_at FROM puzzle_verification_requests
         WHERE puzzle_id = ? ORDER BY id DESC LIMIT 1`, [puzzle.id]
      );
      res.json({
        unique_status: puzzle.unique_status, unique_method: puzzle.unique_method,
        unique_detail: puzzle.unique_detail, unique_checked_at: puzzle.unique_checked_at,
        solverMoves: solverMovesOf(puzzle),
        autoCheckable: searchableGoal(puzzle.goal) && solverMovesOf(puzzle) <= 3,
        request: request || null,
      });
    } catch (err) {
      console.error('GET /api/puzzles/:id/verification:', err);
      res.status(500).send({ message: 'Could not load the verification status' });
    }
  });

  /*
   * Ask staff to verify a puzzle's unique solution. Published puzzles only - a
   * draft can still change under the search - and one open request at a time.
   */
  app.post('/api/puzzles/:id/verification-request', puzzleValidateLimiter, authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (puzzle.creator_id !== req.user.id && !isStaff(req.user)) return res.status(403).send({ message: 'This is not your puzzle' });
      if (puzzle.is_draft || !puzzle.published_at) {
        return res.status(400).send({ message: 'Publish the puzzle first - a draft can still change while it is being checked.' });
      }
      if (puzzle.unique_status === 'verified') {
        return res.status(400).send({ message: 'This puzzle already has a verified unique solution.' });
      }
      if (await openRequestFor(puzzle.id)) {
        return res.status(409).send({ message: 'There is already a request open for this puzzle.' });
      }
      const note = String(req.body?.note || '').trim().slice(0, MAX_NOTE) || null;
      const [ins] = await db_pool.query(
        'INSERT INTO puzzle_verification_requests (puzzle_id, requester_id, note) VALUES (?, ?, ?)',
        [puzzle.id, req.user.id, note]
      );
      const ownerId = await dbHelpers.getOwnerUserId();
      if (ownerId && ownerId !== req.user.id) {
        const moves = solverMovesOf(puzzle);
        await notify(ownerId, {
          senderId: req.user.id,
          title: `Verification requested: "${puzzle.title || `Puzzle #${puzzle.id}`}"`,
          content: `${req.user.username || 'A creator'} asked for their ${moves}-move puzzle to be verified for a unique solution.`
            + (note ? ` Their note: "${note}"` : ''),
          relatedId: puzzle.id,
          actionUrl: '/admin/dashboard?tab=puzzle-verification',
        });
      }
      res.status(201).json({ message: 'Verification requested. You will get a notification when it has been looked at.', requestId: ins.insertId });
    } catch (err) {
      console.error('POST /api/puzzles/:id/verification-request:', err);
      res.status(500).send({ message: 'Could not send the request' });
    }
  });

  /* Withdraw an open request. */
  app.delete('/api/puzzles/:id/verification-request', authenticateToken, async (req, res) => {
    try {
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (puzzle.creator_id !== req.user.id && !isStaff(req.user)) return res.status(403).send({ message: 'This is not your puzzle' });
      const [r] = await db_pool.query(
        "UPDATE puzzle_verification_requests SET status = 'withdrawn', resolved_at = NOW() WHERE puzzle_id = ? AND status = 'open'",
        [puzzle.id]
      );
      /*
       * The owner was told about the request; say on that same notification
       * that it was withdrawn, or the tab it links to looks like it lost it.
       */
      if (r.affectedRows) {
        await db_pool.query(
          `UPDATE notifications SET title = CONCAT(title, ' (withdrawn)')
           WHERE related_id = ? AND title LIKE 'Verification requested:%' AND title NOT LIKE '%(withdrawn)'`,
          [puzzle.id]
        ).catch(() => {});
      }
      res.json({ message: r.affectedRows ? 'Request withdrawn.' : 'There was no open request.' });
    } catch (err) {
      console.error('DELETE /api/puzzles/:id/verification-request:', err);
      res.status(500).send({ message: 'Could not withdraw the request' });
    }
  });

  /* -------------------------------------------------------------- staff -- */

  const FILTERS = {
    all: '1 = 1',
    requested: "EXISTS (SELECT 1 FROM puzzle_verification_requests r WHERE r.puzzle_id = p.id AND r.status = 'open')",
    verified: "p.unique_status = 'verified'",
    not_unique: "p.unique_status = 'not_unique'",
    unchecked: "p.unique_status = 'unchecked'",
  };

  /*
   * Every puzzle, with where its badge stands, any open request, its latest
   * run, and live progress for a run in flight. Open requests first.
   */
  app.get('/api/admin/puzzle-verification', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const filter = FILTERS[req.query.filter] ? req.query.filter : 'all';
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const search = String(req.query.search || '').trim().slice(0, 80);
      const where = [FILTERS[filter]];
      const params = [];
      if (search) {
        const asId = /^#?\d+$/.test(search) ? Number(search.replace('#', '')) : null;
        where.push(`(p.title LIKE ? OR gt.game_name LIKE ? OR u.username LIKE ?${asId ? ' OR p.id = ?' : ''})`);
        const like = `%${search}%`;
        params.push(like, like, like);
        if (asId) params.push(asId);
      }
      const whereSql = where.join(' AND ');
      const [rows] = await db_pool.query(
        `SELECT p.id, p.title, p.game_type_id, gt.game_name, p.creator_id, u.username AS creator_username,
                p.is_draft, p.published_at, p.goal, p.solution_depth, p.solution_line, p.validation_status,
                p.unique_status, p.unique_method, p.unique_detail, p.unique_checked_at,
                cb.username AS unique_checked_by_username,
                req.id AS request_id, req.note AS request_note, req.created_at AS request_created_at,
                ru.username AS requester_username,
                run.id AS run_id, run.state AS run_state, run.verdict AS run_verdict, run.detail AS run_detail,
                run.started_at AS run_started_at, run.finished_at AS run_finished_at
         FROM puzzles p
         LEFT JOIN game_types gt ON gt.id = p.game_type_id
         LEFT JOIN users u ON u.id = p.creator_id
         LEFT JOIN users cb ON cb.id = p.unique_checked_by
         LEFT JOIN puzzle_verification_requests req ON req.id = (
           SELECT MAX(r2.id) FROM puzzle_verification_requests r2 WHERE r2.puzzle_id = p.id AND r2.status = 'open')
         LEFT JOIN users ru ON ru.id = req.requester_id
         LEFT JOIN puzzle_verification_runs run ON run.id = (
           SELECT MAX(x.id) FROM puzzle_verification_runs x WHERE x.puzzle_id = p.id)
         WHERE ${whereSql}
         ORDER BY (req.id IS NULL), req.created_at, p.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      );
      const [[{ total }]] = await db_pool.query(
        `SELECT COUNT(*) AS total FROM puzzles p
         LEFT JOIN game_types gt ON gt.id = p.game_type_id
         LEFT JOIN users u ON u.id = p.creator_id
         WHERE ${whereSql}`, params
      );
      const [[counts]] = await db_pool.query(
        `SELECT COUNT(*) AS \`all\`,
                SUM(unique_status = 'verified') AS verified,
                SUM(unique_status = 'not_unique') AS not_unique,
                SUM(unique_status = 'unchecked') AS unchecked,
                (SELECT COUNT(DISTINCT puzzle_id) FROM puzzle_verification_requests WHERE status = 'open') AS requested
         FROM puzzles`
      );
      const live = activeJobs((j) => j.kind === 'verify');
      const liveByPuzzle = new Map(live.map((j) => [j.meta.puzzleId, j]));
      res.json({
        puzzles: rows.map(({ solution_line: line, ...r }) => ({
          ...r,
          solverMoves: Math.ceil((safeParse(line, []) || []).length / 2),
          autoCheckable: searchableGoal(r.goal) && Math.ceil((safeParse(line, []) || []).length / 2) <= 3,
          searchable: searchableGoal(r.goal),
          goal_label: GOAL_DEFS[r.goal]?.label || r.goal,
          live: liveByPuzzle.get(r.id) || null,
        })),
        total: Number(total), page, limit, filter,
        counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0])),
        limits: limits(),
        running: live.length,
      });
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
        return res.json({ puzzles: [], total: 0, migrationPending: true });
      }
      console.error('GET /api/admin/puzzle-verification:', err);
      res.status(500).send({ message: 'Could not load puzzles' });
    }
  });

  /* Live progress of every staff run in flight (polled by the admin tab while any is running). */
  app.get('/api/admin/puzzle-verification/live', authenticateToken, (req, res) => {
    if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
    res.json({ live: activeJobs((j) => j.kind === 'verify'), limits: limits() });
  });

  /*
   * Start a uniqueness search of one puzzle, in the long lane. maxHours (optional)
   * stops it after that long; without it, it runs until it finishes or is
   * cancelled. The verdict sets the badge, provided the puzzle has not been
   * edited in the meantime.
   */
  app.post('/api/admin/puzzles/:id/verification-runs', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      if (!searchableGoal(puzzle.goal)) {
        return res.status(400).send({ message: `The search cannot judge the goal '${GOAL_DEFS[puzzle.goal]?.label || puzzle.goal}'. Award or refuse the badge by hand instead.` });
      }
      if (liveRunFor(puzzle.id)) return res.status(409).send({ message: 'This puzzle is already being searched.' });

      const rules = await rulesForPuzzle(db_pool, puzzle);
      if (!rules) return res.status(400).send({ message: 'Puzzle has no game type' });
      const hydrated = {
        ...puzzle,
        position: await hydratePosition(rules, safeParse(puzzle.position, [])),
        placeable_definitions: placeableDefinitions(rules),
        initial_pieces: await startingRoster(rules),
        setup_move: safeParse(puzzle.setup_move),
        solution_line: safeParse(puzzle.solution_line, []),
      };
      // "Find this exact move" is searched against the game's own win - so its line has to win the game.
      let aim = puzzle.goal;
      if (puzzle.goal === 'specific_move') {
        if (!(await lineWinsGame(hydrated, rules.game, hydrated.solution_line))) {
          return res.status(400).send({ message: 'This puzzle\'s line does not end by winning the game, so there is nothing for the search to check it against. Award or refuse the badge by hand instead.' });
        }
        aim = 'win_in_1';
      }
      const hours = Number(req.body?.maxHours);
      const maxMs = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600 * 1000) : Infinity;
      const startedPrint = fingerprint(puzzle);
      const staffId = req.user.id;

      const [ins] = await db_pool.query(
        "INSERT INTO puzzle_verification_runs (puzzle_id, started_by, state, max_ms) VALUES (?, ?, 'queued', ?)",
        [puzzle.id, staffId, Number.isFinite(maxMs) ? maxMs : null]
      );
      const runId = ins.insertId;

      const jobId = startJob({
        kind: 'verify',
        lane: 'long',
        owner: staffId,
        meta: { runId, puzzleId: puzzle.id, title: puzzle.title, solverMoves: solverMovesOf(puzzle) },
        maxMs,
        workerData: {
          kind: 'verify', puzzle: hydrated, gameType: rules.game,
          opts: { aim, budgetMs: Infinity, ttMax: Number(process.env.PUZZLE_LONG_TT_MAX) || 400000 },
        },
        onStart: () => db_pool.query("UPDATE puzzle_verification_runs SET state = 'running' WHERE id = ?", [runId]),
        onDone: async (result) => {
          const after = await loadPuzzle(puzzle.id);
          const unchanged = after && fingerprint(after) === startedPrint;
          let detail = result.detail;
          if (!unchanged) detail += ' (The puzzle was edited while this ran, so the badge was left as it is.)';
          await db_pool.query(
            `UPDATE puzzle_verification_runs SET state = 'done', verdict = ?, detail = ?, result_json = ?, finished_at = NOW()
             WHERE id = ?`,
            [result.verdict, detail, JSON.stringify({ steps: result.steps, nodes: result.nodes, ms: result.ms, complete: result.complete, findings: result.findings || [] }), runId]
          );
          if (unchanged && result.verdict) {
            await setUnique(puzzle.id, {
              status: result.verdict === 'unique' ? 'verified' : 'not_unique',
              method: 'search', detail: result.detail, by: staffId,
            });
          }
          return { ...result, detail, applied: unchanged && !!result.verdict };
        },
        onEnd: (job) => {
          if (job.state === 'failed' || job.state === 'cancelled') {
            return db_pool.query(
              'UPDATE puzzle_verification_runs SET state = ?, detail = ?, finished_at = NOW() WHERE id = ?',
              [job.state, job.error || null, runId]
            );
          }
          return null;
        },
      });
      res.status(202).json({ message: 'Search started.', runId, jobId });
    } catch (err) {
      console.error('POST /api/admin/puzzles/:id/verification-runs:', err);
      res.status(500).send({ message: 'Could not start the search' });
    }
  });

  /* Stop a run, queued or running. */
  app.post('/api/admin/puzzle-verification-runs/:runId/cancel', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const runId = parseInt(req.params.runId, 10);
      const job = activeJobs((j) => j.kind === 'verify' && j.meta?.runId === runId)[0];
      if (!job || !cancelJob(job.id, `Canceled by ${req.user.username || 'staff'}.`)) {
        // Not in memory: a run cut off by a restart, still marked live. Close it.
        await db_pool.query(
          "UPDATE puzzle_verification_runs SET state = 'cancelled', finished_at = NOW() WHERE id = ? AND state IN ('queued','running')",
          [runId]
        );
      }
      res.json({ message: 'Search canceled.' });
    } catch (err) {
      console.error('POST /api/admin/puzzle-verification-runs/:runId/cancel:', err);
      res.status(500).send({ message: 'Could not cancel the search' });
    }
  });

  /* One run in full, steps included. */
  app.get('/api/admin/puzzle-verification-runs/:runId', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const [[run]] = await db_pool.query(
        `SELECT r.*, u.username AS started_by_username FROM puzzle_verification_runs r
         LEFT JOIN users u ON u.id = r.started_by WHERE r.id = ?`, [parseInt(req.params.runId, 10)]
      );
      if (!run) return res.status(404).send({ message: 'No such run' });
      res.json({ ...run, result: safeParse(run.result_json), result_json: undefined });
    } catch (err) {
      console.error('GET /api/admin/puzzle-verification-runs/:runId:', err);
      res.status(500).send({ message: 'Could not load the run' });
    }
  });

  /*
   * Set the badge by hand: 'verified' awards it, 'not_unique' refuses it,
   * 'unchecked' clears any verdict. For what no search can settle - a goal the
   * engine cannot score, or a line too deep to finish.
   */
  app.post('/api/admin/puzzles/:id/unique', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const puzzle = await loadPuzzle(parseInt(req.params.id, 10));
      if (!puzzle) return res.status(404).send({ message: 'Puzzle not found' });
      const status = String(req.body?.status || '');
      if (!UNIQUE_STATUSES.has(status)) return res.status(400).send({ message: 'status must be verified, not_unique or unchecked' });
      const detail = String(req.body?.detail || '').trim().slice(0, MAX_REASON)
        || (status === 'verified' ? 'Verified by GridGrove staff.' : status === 'not_unique' ? 'More than one solution (staff).' : null);
      await setUnique(puzzle.id, { status, method: 'manual', detail, by: req.user.id });
      res.json({ message: status === 'verified' ? 'Badge awarded.' : status === 'not_unique' ? 'Marked as not unique.' : 'Cleared.' });
    } catch (err) {
      console.error('POST /api/admin/puzzles/:id/unique:', err);
      res.status(500).send({ message: 'Could not update the puzzle' });
    }
  });

  /*
   * Close a request and tell the requester.
   *   outcome 'verified'     award the badge (keeping a search's verdict as the
   *                          method if one already set it) and say so
   *   outcome 'not_unique'   refuse it - more than one solution
   *   outcome 'weak_reply'   refuse it - an opponent's reply in the line is not
   *                          their best: another lasts longer or stops the goal
   *   outcome 'slow_move'    refuse it - one of the solver's moves is not the
   *                          best: another finishes the goal sooner
   *                          ('not_optimal', from before the split, is a
   *                          weak_reply or slow_move without saying which)
   *   outcome 'goal_not_met' refuse it - the line does not meet the puzzle's
   *                          goal (it may win the game another way)
   *   outcome 'earlier_win'  refuse it - the game can be won at an earlier move
   *                          than the line's last
   *   outcome 'not_verified' close it without changing the badge (could not be
   *                          settled, not eligible, ...); the reason says why
   */
  app.post('/api/admin/puzzle-verification-requests/:requestId/resolve', authenticateToken, async (req, res) => {
    try {
      if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
      const [[request]] = await db_pool.query('SELECT * FROM puzzle_verification_requests WHERE id = ?', [parseInt(req.params.requestId, 10)]);
      if (!request) return res.status(404).send({ message: 'No such request' });
      if (request.status !== 'open') return res.status(409).send({ message: 'That request is already closed.' });
      const outcome = String(req.body?.outcome || '');
      if (!RESOLVE_OUTCOMES.has(outcome)) {
        return res.status(400).send({ message: `outcome must be one of: ${[...RESOLVE_OUTCOMES].join(', ')}` });
      }
      const reason = String(req.body?.reason || '').trim().slice(0, MAX_REASON);
      if (outcome !== 'verified' && !reason) return res.status(400).send({ message: 'Give the requester a reason.' });
      const puzzle = await loadPuzzle(request.puzzle_id);
      if (!puzzle) return res.status(404).send({ message: 'The puzzle no longer exists' });

      if (outcome === 'verified') {
        if (puzzle.unique_status !== 'verified') {
          await setUnique(puzzle.id, { status: 'verified', method: 'manual', detail: reason || 'Verified by GridGrove staff.', by: req.user.id });
        }
      } else if (outcome === 'not_unique') {
        await setUnique(puzzle.id, { status: 'not_unique', method: puzzle.unique_method === 'search' && puzzle.unique_status === 'not_unique' ? 'search' : 'manual', detail: reason, by: req.user.id });
      } else if (NOT_OPTIMAL.has(outcome)) {
        // A move that is not the best available - either side's - means the
        // line is not THE solution: the badge is refused, with the reason.
        await setUnique(puzzle.id, { status: 'not_unique', method: 'manual', detail: reason, by: req.user.id });
      }
      await db_pool.query(
        `UPDATE puzzle_verification_requests SET status = ?, resolution = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?`,
        [outcome === 'verified' ? 'verified' : 'not_verified', reason || null, req.user.id, request.id]
      );
      const name = puzzle.title || `Puzzle #${puzzle.id}`;
      await notify(request.requester_id, {
        senderId: req.user.id,
        title: outcome === 'verified'
          ? `"${name}" has a verified unique solution`
          : `"${name}" did not earn the unique-solution badge`,
        content: outcome === 'verified'
          ? `Your puzzle has been verified: exactly one winning move at every step. It now shows the unique-solution badge.${reason ? ` ${reason}` : ''}`
          : `Reason: ${reason}`,
        relatedId: puzzle.id,
        actionUrl: puzzleUrl(puzzle),
      });
      res.json({ message: 'Request resolved and the requester notified.' });
    } catch (err) {
      console.error('POST /api/admin/puzzle-verification-requests/:requestId/resolve:', err);
      res.status(500).send({ message: 'Could not resolve the request' });
    }
  });

  // Live job lookup for a run, by job id (the same view the builder polls).
  app.get('/api/admin/puzzle-verification/jobs/:jobId', authenticateToken, (req, res) => {
    if (!isStaff(req.user)) return res.status(403).send({ message: 'Admins only' });
    const job = getJob(String(req.params.jobId || ''));
    if (!job) return res.status(404).send({ message: 'That search has finished and expired, or never existed.' });
    res.json({ ...job.view, meta: job.meta });
  });
}

/*
 * At boot: a run still marked queued or running was cut off by the restart -
 * its worker died with the old process.
 */
async function markInterruptedRuns(db_pool) {
  try {
    await db_pool.query(
      `UPDATE puzzle_verification_runs SET state = 'interrupted', finished_at = NOW(),
         detail = 'The server restarted while this ran. Start it again.'
       WHERE state IN ('queued', 'running')`
    );
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') console.warn('[puzzle-verification] could not close interrupted runs:', err.message);
  }
}

module.exports = { registerPuzzleVerificationRoutes, markInterruptedRuns };
