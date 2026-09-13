/*
 * What happens to a game's puzzles when the game changes.
 *
 * Editing a game used to do nothing to its puzzles at all. They kept pointing
 * at the live rules, so a changed piece silently changed what every puzzle on
 * that game meant - and the first anyone knew was a solver being told their
 * correct answer was wrong.
 *
 * Puzzles now carry their own frozen rules, so an edit cannot break one. But
 * "cannot break" is not the same as "nothing to do": a puzzle left on an old
 * snapshot forever drifts away from the game it claims to be from, and the
 * honest thing is to move it forward WHEN it survives the move.
 *
 * So on every edit, each published puzzle on that game is re-checked against
 * the new rules:
 *
 *   it still works  -> repoint it at the new snapshot. The puzzle tracks the
 *                      game, and the solver plays the game as it is today.
 *   it does not     -> leave it on the old snapshot, and mark it diverged. It
 *                      keeps working, as a puzzle about the game as it was,
 *                      and the creator can be told.
 *
 * Deliberately never unpublishes. The daily queue is built weeks ahead, and a
 * creator's edit silently removing somebody else's scheduled puzzle is exactly
 * the failure this whole mechanism exists to prevent.
 *
 * Runs in the background after the save responds. It is thousands of engine
 * calls for a game with many puzzles, and nobody should wait on it to be told
 * their game saved.
 */

const { ensureSnapshot, readLive } = require('./puzzle-snapshot');
const { hydratePosition } = require('./puzzle-hydrate');

const safeParse = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
};

/**
 * Re-check a game's published puzzles against its current rules.
 *
 * @returns {Promise<{checked, moved, diverged, recovered}>}
 */
async function revalidateGamePuzzles(db_pool, gameTypeId) {
  const out = { checked: 0, moved: 0, diverged: 0, recovered: 0 };

  const [puzzles] = await db_pool.query(
    `SELECT id, game_type_id, position, side_to_move, setup_move, solution_line,
            goal, rule_snapshot, rules_diverged_at
     FROM puzzles
     WHERE game_type_id = ? AND is_draft = 0`,
    [gameTypeId]
  );
  if (!puzzles.length) return out;

  const rules = await readLive(db_pool, gameTypeId);
  if (!rules) return out;

  /*
   * One snapshot for the whole batch. It is content-addressed, so this is the
   * same row every puzzle that survives will point at - and if nothing about
   * the rules actually changed, it is the row they already point at and the
   * loop below has nothing to do.
   */
  const fingerprint = await ensureSnapshot(db_pool, gameTypeId);
  if (!fingerprint) return out;

  const { validatePuzzle } = require('./puzzle-validation');

  for (const p of puzzles) {
    out.checked++;
    // Already current. Nothing changed for this one.
    if (p.rule_snapshot === fingerprint && !p.rules_diverged_at) continue;

    let works = false;
    try {
      const verdict = await validatePuzzle({
        position: await hydratePosition(rules, safeParse(p.position, [])),
        side_to_move: p.side_to_move,
        setup_move: safeParse(p.setup_move),
        solution_line: safeParse(p.solution_line, []),
        goal: p.goal,
        game_type_id: gameTypeId,
      }, rules.game);
      works = !!verdict.intendedWorks;
    } catch (_) {
      works = false;
    }

    if (works) {
      /*
       * Moving forward also clears a previous divergence: a game edited into a
       * broken state and then edited back should stop being marked, or the flag
       * becomes a permanent scar from a problem that no longer exists.
       */
      if (p.rules_diverged_at) out.recovered++;
      await db_pool.query(
        'UPDATE puzzles SET rule_snapshot = ?, rules_diverged_at = NULL WHERE id = ?',
        [fingerprint, p.id]
      );
      out.moved++;
    } else {
      /*
       * Stays on its old snapshot, which is what keeps it playable. A puzzle
       * that never had one is given the OLD rules it was working under - except
       * there is no such thing to give it, so it gets this snapshot and the
       * mark, and at least stops changing underneath anyone from now on.
       */
      await db_pool.query(
        'UPDATE puzzles SET rule_snapshot = COALESCE(rule_snapshot, ?), rules_diverged_at = NOW() WHERE id = ?',
        [fingerprint, p.id]
      );
      if (!p.rules_diverged_at) out.diverged++;
    }
  }

  return out;
}

/**
 * Fire-and-forget wrapper for the game-save path.
 *
 * Never throws and never delays the response: a failure here must not make a
 * successful save look like a failed one.
 */
function revalidateInBackground(db_pool, gameTypeId) {
  setImmediate(() => {
    revalidateGamePuzzles(db_pool, gameTypeId)
      .then((r) => {
        if (r.moved || r.diverged || r.recovered) {
          console.log(
            `[puzzle] game ${gameTypeId} edited: ${r.checked} puzzle(s) checked, `
            + `${r.moved} moved to the new rules, ${r.diverged} left behind, `
            + `${r.recovered} recovered`
          );
        }
      })
      .catch((err) => console.warn('[puzzle] revalidation failed:', err.message));
  });
}

module.exports = { revalidateGamePuzzles, revalidateInBackground };
