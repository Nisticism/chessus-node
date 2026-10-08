/*
 * Upvotes on things people make: games, pieces and puzzles.
 *
 * One toggle and one status read for all three, so the rules are the same
 * everywhere:
 *   - only signed-in players vote, once per thing (a unique key per table);
 *   - nobody upvotes their OWN creation. A self-upvote is refused here, on the
 *     server - hiding the button is a courtesy, not the rule;
 *   - only something others can see can be voted on (no drafts).
 *
 * Forum posts keep their own "likes" table and route (index.js), with the same
 * own-post rule applied there.
 */

const KINDS = {
  game: {
    table: 'game_type_upvotes', column: 'game_type_id',
    owner: 'SELECT creator_id AS owner_id, is_draft FROM game_types WHERE id = ? LIMIT 1',
    noun: 'game',
  },
  piece: {
    table: 'piece_upvotes', column: 'piece_id',
    owner: 'SELECT creator_id AS owner_id, is_draft FROM pieces WHERE id = ? LIMIT 1',
    noun: 'piece',
  },
  puzzle: {
    table: 'puzzle_upvotes', column: 'puzzle_id',
    owner: 'SELECT creator_id AS owner_id, is_draft FROM puzzles WHERE id = ? LIMIT 1',
    noun: 'puzzle',
  },
};

/**
 * SELECT-list columns for a list query: the count, and whether the viewer has
 * voted. `alias` is the listed table's alias; the viewer id is the ONE
 * placeholder, which comes wherever these columns sit in the statement.
 */
function upvoteColumns(kind, alias) {
  const k = KINDS[kind];
  return `(SELECT COUNT(*) FROM ${k.table} uv WHERE uv.${k.column} = ${alias}.id) AS upvote_count,
          EXISTS(SELECT 1 FROM ${k.table} uv WHERE uv.${k.column} = ${alias}.id AND uv.user_id = ?) AS upvoted_by_user`;
}

async function countFor(db, kind, id) {
  const k = KINDS[kind];
  const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${k.table} WHERE ${k.column} = ?`, [id]);
  return Number(row.n) || 0;
}

function registerUpvoteRoutes(app, { db_pool, authenticateToken, optionalAuthenticate }) {
  const routes = [
    ['game', '/api/games/:id/upvote'],
    ['piece', '/api/pieces/:id/upvote'],
    ['puzzle', '/api/puzzles/:id/upvote'],
  ];

  for (const [kind, path] of routes) {
    const k = KINDS[kind];

    // Toggle: on if it was off, off if it was on.
    app.post(path, authenticateToken, async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const [[thing]] = await db_pool.query(k.owner, [id]);
        if (!id || !thing || thing.is_draft) return res.status(404).send({ message: `That ${k.noun} was not found.` });
        if (Number(thing.owner_id) === Number(req.user.id)) {
          return res.status(403).send({ message: `You can't upvote your own ${k.noun}.`, own: true });
        }
        const [del] = await db_pool.query(
          `DELETE FROM ${k.table} WHERE ${k.column} = ? AND user_id = ?`, [id, req.user.id]
        );
        let upvoted = false;
        if (del.affectedRows === 0) {
          // INSERT IGNORE: a double click that races itself still leaves one vote.
          await db_pool.query(`INSERT IGNORE INTO ${k.table} (${k.column}, user_id) VALUES (?, ?)`, [id, req.user.id]);
          upvoted = true;
        }
        res.json({ upvoted, upvote_count: await countFor(db_pool, kind, id) });
      } catch (err) {
        console.error(`POST ${path}:`, err);
        res.status(500).send({ message: 'Could not update the upvote' });
      }
    });

    // The count, whether the viewer has voted, and whether they may.
    app.get(path, optionalAuthenticate, async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const viewer = req.user?.id || null;
        const [[thing]] = await db_pool.query(k.owner, [id]);
        let upvoted = false;
        if (viewer) {
          const [[mine]] = await db_pool.query(
            `SELECT 1 AS yes FROM ${k.table} WHERE ${k.column} = ? AND user_id = ? LIMIT 1`, [id, viewer]
          );
          upvoted = !!mine;
        }
        res.json({
          upvoted,
          upvote_count: await countFor(db_pool, kind, id),
          own: !!(viewer && thing && Number(thing.owner_id) === Number(viewer)),
        });
      } catch (err) {
        console.error(`GET ${path}:`, err);
        res.status(500).send({ message: 'Could not load the upvotes' });
      }
    });
  }
}

module.exports = { registerUpvoteRoutes, upvoteColumns, UPVOTE_KINDS: KINDS };
