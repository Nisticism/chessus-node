/*
 * The Discord side of the daily puzzle.
 *
 * The activity is a web page that GridGrove already serves, loaded in an iframe
 * inside the Discord client. It plays the SAME puzzle through the SAME
 * endpoints as the website - /api/puzzles/daily to fetch it, /api/puzzles/:id/
 * moves to enumerate, /api/puzzles/:id/solve to judge. Nothing about a puzzle
 * is re-implemented here, because a second copy of the rules is a second copy
 * that can be wrong.
 *
 * What IS here is the two things Discord needs and the website does not:
 *
 *   1. A token exchange, because the client secret cannot go in the iframe.
 *   2. Progress for a player with no GridGrove account - did they solve today,
 *      in how many tries, and how long is their streak. That is the part people
 *      come back for, and it has to work for someone who has never signed up.
 *
 * A Discord id proves continuity of person, not ownership of an account. It is
 * allowed to reach daily-puzzle progress and nothing else. See discord-auth.js.
 */

const { exchangeCode, optionalDiscord } = require('./discord-auth');
const { createDailyPuzzle } = require('./daily-puzzle');

/**
 * Fold today's finished attempt into a Discord player's record.
 *
 * Called from the solve endpoint once an attempt is terminal, for any attempt
 * that arrived with a verified Discord id - including from someone who also has
 * a GridGrove account, because the streak is about turning up on Discord and
 * their account rating is handled separately.
 *
 * Streaks only ever move on the DAILY puzzle. Solving six old puzzles in an
 * afternoon is worth doing and worth recording, but it is not a streak, and
 * letting it count would make the number mean nothing.
 *
 * @param {object}  db_pool
 * @param {object}  discord   The verified user from discord-auth.
 * @param {object}  opts
 * @param {boolean} opts.solved
 * @param {boolean} opts.isDaily     Whether this puzzle is today's daily one.
 * @param {string}  opts.date        Today's date key, 'YYYY-MM-DD'.
 * @param {string}  opts.yesterday   The day before it, for continuity.
 * @returns {Promise<object|null>} The player's record after the update.
 */
async function recordDiscordAttempt(db_pool, discord, { solved, isDaily, date, yesterday }) {
  if (!discord?.id) return null;

  await db_pool.query(
    `INSERT INTO discord_players (discord_user_id, username, avatar, total_attempts)
     VALUES (?,?,?,1)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       avatar = VALUES(avatar),
       total_attempts = total_attempts + 1`,
    [discord.id, discord.username, discord.avatar]
  );

  if (solved) {
    /*
     * Read-then-write rather than one statement, because the streak rule needs
     * to compare against the stored date and SQL cannot express "continue,
     * reset, or leave alone" in an ON DUPLICATE KEY clause without becoming
     * unreadable. The row is per-player, so the race is a player double-
     * submitting their own solve - and the guard below makes that a no-op.
     */
    const [[row]] = await db_pool.query(
      `SELECT current_streak, best_streak,
              DATE_FORMAT(last_solved_date, '%Y-%m-%d') AS last_solved_date
       FROM discord_players WHERE discord_user_id = ?`,
      [discord.id]
    );

    if (isDaily && row?.last_solved_date !== date) {
      // Yesterday's solve continues the run; anything older starts a new one.
      const streak = row?.last_solved_date === yesterday
        ? (Number(row.current_streak) || 0) + 1
        : 1;
      await db_pool.query(
        `UPDATE discord_players
         SET current_streak = ?, best_streak = GREATEST(best_streak, ?),
             last_solved_date = ?, total_solved = total_solved + 1
         WHERE discord_user_id = ?`,
        [streak, streak, date, discord.id]
      );
    } else if (!isDaily) {
      // Counts towards the total, never towards the streak.
      await db_pool.query(
        'UPDATE discord_players SET total_solved = total_solved + 1 WHERE discord_user_id = ?',
        [discord.id]
      );
    }
  }

  const [[after]] = await db_pool.query(
    `SELECT current_streak, best_streak, total_solved, total_attempts,
            DATE_FORMAT(last_solved_date, '%Y-%m-%d') AS last_solved_date
     FROM discord_players WHERE discord_user_id = ?`,
    [discord.id]
  );
  return after || null;
}

function registerDiscordRoutes(app, { db_pool }) {
  const dailyPuzzle = createDailyPuzzle({ db_pool });

  /*
   * Step one of the activity's handshake.
   *
   * The activity asks Discord to authorize it, gets a one-time code back, and
   * posts it here. This server swaps it for an access token using the client
   * secret and hands only the token back. The secret never leaves the server,
   * which is the entire reason this endpoint exists rather than the activity
   * doing the exchange itself.
   */
  app.post('/api/discord/token', async (req, res) => {
    try {
      const out = await exchangeCode(req.body?.code);
      res.json(out);
    } catch (err) {
      if (err.status) return res.status(err.status).send({ message: err.message });
      console.error('POST /api/discord/token:', err);
      res.status(500).send({ message: 'Could not complete the Discord sign-in' });
    }
  });

  /*
   * Who the caller is, and how they are doing.
   *
   * Answers with `player: null` for anyone we cannot identify rather than 401,
   * because "not signed in" is a supported way to play the puzzle and the
   * activity should render the board either way.
   */
  app.get('/api/discord/me', optionalDiscord, async (req, res) => {
    try {
      if (!req.discord) return res.json({ player: null });

      const [[row]] = await db_pool.query(
        `SELECT current_streak, best_streak, total_solved, total_attempts,
                DATE_FORMAT(last_solved_date, '%Y-%m-%d') AS last_solved_date
         FROM discord_players WHERE discord_user_id = ?`,
        [req.discord.id]
      );

      const date = dailyPuzzle.todayKey();
      const today = await dailyPuzzle.forDate(date);

      /*
       * Today's state, so the activity can open on "you solved it in 2" instead
       * of offering a puzzle the player has already finished. Attempts are
       * counted from the attempt rows rather than a counter on the player, so
       * the number survives the player record being rebuilt.
       */
      let todayState = { solved: false, attempts: 0 };
      if (today) {
        const [[t]] = await db_pool.query(
          `SELECT COUNT(*) AS attempts, MAX(solved) AS solved
           FROM puzzle_attempts
           WHERE puzzle_id = ? AND discord_user_id = ?`,
          [today.puzzle_id, req.discord.id]
        );
        todayState = { solved: !!Number(t?.solved), attempts: Number(t?.attempts) || 0 };
      }

      res.json({
        player: {
          id: req.discord.id,
          username: req.discord.username,
          avatar: req.discord.avatar,
          current_streak: Number(row?.current_streak) || 0,
          best_streak: Number(row?.best_streak) || 0,
          total_solved: Number(row?.total_solved) || 0,
          total_attempts: Number(row?.total_attempts) || 0,
          last_solved_date: row?.last_solved_date || null,
        },
        date,
        today: todayState,
      });
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') return res.json({ player: null });
      console.error('GET /api/discord/me:', err);
      res.status(500).send({ message: 'Could not load your Discord progress' });
    }
  });

  /*
   * The streak board.
   *
   * Public, because it is a scoreboard, and it only ever carries what Discord
   * already shows about a person in any channel they post in: their display
   * name and avatar.
   */
  app.get('/api/discord/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(25, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const [rows] = await db_pool.query(
        `SELECT discord_user_id, username, avatar, current_streak, best_streak, total_solved
         FROM discord_players
         WHERE total_solved > 0
         ORDER BY current_streak DESC, total_solved DESC
         LIMIT ?`,
        [limit]
      );
      res.json({ players: rows });
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') return res.json({ players: [] });
      console.error('GET /api/discord/leaderboard:', err);
      res.status(500).send({ message: 'Could not load the leaderboard' });
    }
  });
}

module.exports = { registerDiscordRoutes, recordDiscordAttempt };
