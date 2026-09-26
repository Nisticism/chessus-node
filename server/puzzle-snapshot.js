/*
 * The rules a puzzle was built under, frozen.
 *
 * WHY THIS EXISTS
 *
 * A puzzle is a position PLUS the rules that make its answer correct. Until
 * now only the position was stored; the rules were a pointer to a game_types
 * row, its pieces, and its placements - all of them owned by somebody else and
 * editable at any moment.
 *
 * That made two things possible, and neither was noticeable when it happened:
 *
 *   A creator edits a piece's movement. Every puzzle on that game is now
 *   verified against rules that no longer exist. The stored answer may not be
 *   legal any more, or may no longer be the ONLY legal answer - and a solver
 *   who finds the new one is told they are wrong.
 *
 *   A creator deletes the game. The puzzles cascade away with it, and any day
 *   they were scheduled for goes blank.
 *
 * So the rules travel with the puzzle. A snapshot holds the game row, the piece
 * definitions and the placements, and the puzzle reads those rather than the
 * live tables. Editing a game cannot silently change what an existing puzzle
 * means, and deleting one cannot take its puzzles with it.
 *
 * CONTENT-ADDRESSED
 *
 * A snapshot's id is the fingerprint of what is in it (server/game-fingerprint.js),
 * so identical rules are stored once however many puzzles share them: twenty
 * puzzles on one game share one row, and a new row appears only when the game
 * actually changes in a way that could change a puzzle's answer. That same
 * property is what makes "has this game drifted?" a string comparison.
 *
 * STALE ON PURPOSE
 *
 * A puzzle whose snapshot is behind the live game shows the game as it WAS.
 * That is correct - a game from 1920 is played under 1920's rules - but it is
 * worth saying out loud in the interface rather than implying the current game.
 */

const { fingerprintGame } = require('./game-fingerprint');

/**
 * Read a game's rules from the live tables.
 *
 * @returns {Promise<{game: object, pieces: object[], placements: object[]}|null>}
 */
async function readLive(db_pool, gameTypeId) {
  const id = Number(gameTypeId);
  if (!Number.isFinite(id)) return null;

  const [[game]] = await db_pool.query('SELECT * FROM game_types WHERE id = ? LIMIT 1', [id]);
  if (!game) return null;

  /*
   * ORDERED, because a junction row is per SQUARE and consumers that want one
   * row per piece have to pick one. Without an ORDER BY the server may hand
   * back the same rows in a different sequence between two identical queries,
   * so "whichever row came first" is a coin flip and a puzzle can hydrate with
   * different flags on two consecutive loads. See the lookup in
   * server/puzzle-hydrate.js, which reads this order as lowest square first.
   *
   * This does not move any fingerprint: fingerprintGame sorts its cells by
   * square before hashing, and (game_type_id, x, y, player_number) is unique,
   * so the sort is total and row order cannot reach the digest. Checked against
   * production - all 335 games with placements fingerprint identically ordered
   * and unordered, and all four stored snapshots still recompute to their own id.
   */
  const [placements] = await db_pool.query(
    `SELECT * FROM game_type_pieces WHERE game_type_id = ?
      ORDER BY player_number, y, x, piece_id, id`, [id]
  );

  /*
   * Every piece the game can involve, which is NOT the same as every piece
   * currently placed on it: a puzzle's position can hold a piece that was
   * removed from the starting layout, and a promotion can introduce one that
   * was never placed at all. The placements plus the starting layout together
   * are the closure that has to be frozen.
   */
  const ids = new Set(placements.map((p) => Number(p.piece_id)).filter(Boolean));
  for (const extra of piecesNamedIn(game)) ids.add(extra);

  /*
   * Promotion targets named PER PLACEMENT, which is where most of them live.
   *
   * A game can set its promotion list three different ways, and this used to
   * see only one of them: the game-level column. "Darkness 3x12" configures its
   * pawn through game_type_pieces.promotion_pieces_override - [Knight, Bishop,
   * Rook] - so the Rook was never loaded, and a Rook standing on a puzzle board
   * hydrated from `byId.get(15) || {}`: an empty definition, with no movement
   * and no capture. The engine then said "Piece cannot capture to that square"
   * about a rook staring down an open file at a king, in a game where taking it
   * was not only legal but compulsory.
   */
  for (const row of placements) {
    for (const extra of idsIn(row.promotion_pieces_override)) ids.add(extra);
  }

  let pieces = [];
  if (ids.size) {
    const list = [...ids];
    [pieces] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${list.map(() => '?').join(',')})`, list
    );

    /*
     * And the third way: a piece's OWN default promotion list, which is only
     * visible once the piece has been read. One extra round trip, and only when
     * it names something new - a promotion target that promotes further is the
     * rare case, so this closes rather than loops.
     */
    const more = new Set();
    for (const row of pieces) {
      for (const extra of idsIn(row.promotion_pieces_ids)) if (!ids.has(extra)) more.add(extra);
      for (const extra of idsIn(row.promotion_options)) if (!ids.has(extra)) more.add(extra);
    }
    if (more.size) {
      const extraList = [...more];
      const [extraRows] = await db_pool.query(
        `SELECT * FROM pieces WHERE id IN (${extraList.map(() => '?').join(',')})`, extraList
      );
      pieces = pieces.concat(extraRows);
    }
  }

  return { game, pieces, placements };
}

/**
 * Piece ids inside a stored promotion list, whatever shape it is in.
 *
 * These columns have collected three encodings over time: a JSON array of ids,
 * a JSON array of {id, player} objects (cross-player and neutral promotion),
 * and - in older rows - a bare comma-separated string. All three mean the same
 * thing and all three appear on production.
 */
function idsIn(raw) {
  const out = new Set();
  const collect = (value) => {
    if (value == null) return;
    let v = value;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (_) {
        for (const part of String(value).split(',')) {
          const num = Number(String(part).trim());
          if (Number.isFinite(num) && num > 0) out.add(num);
        }
        return;
      }
    }
    if (Array.isArray(v)) {
      for (const n of v) {
        if (n && typeof n === 'object') {
          const num = Number(n.id ?? n.piece_id);
          if (Number.isFinite(num) && num > 0) out.add(num);
        } else {
          const num = Number(n);
          if (Number.isFinite(num) && num > 0) out.add(num);
        }
      }
    } else if (v && typeof v === 'object') {
      for (const inner of Object.values(v)) collect(inner);
    } else {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) out.add(num);
    }
  };
  collect(raw);
  return out;
}

/**
 * Piece ids a game mentions outside its placements.
 *
 * Promotion lists are the reason this exists: promoting into a piece whose
 * definition was not frozen would read the live row, which is the hole this
 * whole module is closing.
 */
function piecesNamedIn(game) {
  const out = new Set();
  const collect = (raw) => {
    if (raw == null) return;
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (_) {
        // Also stored as a bare comma-separated list in older rows.
        for (const part of String(raw).split(',')) {
          const n = Number(part.trim());
          if (Number.isFinite(n) && n > 0) out.add(n);
        }
        return;
      }
    }
    if (Array.isArray(v)) {
      for (const n of v) {
        const num = Number(n);
        if (Number.isFinite(num) && num > 0) out.add(num);
      }
    } else if (v && typeof v === 'object') {
      for (const inner of Object.values(v)) collect(inner);
    }
  };

  /*
   * NOTE: game_types has no promotion_pieces_ids column on production - this
   * collect() has never returned anything. It is left in place because the
   * schema is not the same everywhere and costs nothing, but it must not be
   * mistaken for the working path: promotion targets are configured per
   * placement (game_type_pieces.promotion_pieces_override) and per piece
   * (pieces.promotion_pieces_ids), and readLive reads both. Believing this line
   * was doing the job is what left promoted pieces with no definition at all.
   */
  collect(game.promotion_pieces_ids);
  // The starting layout names its own pieces, and a game can start with a piece
  // that has no junction row.
  collect(startingPieceIds(game));
  // And the pieces it PLACES. A piece that only ever enters by being placed is
  // on no starting square, so nothing above named it and it hydrated with no
  // definition - Clobber Four's token could not move in a puzzle.
  collect(placeablePieceIds(game));
  return out;
}

/** Piece ids a game lets players place (other_game_data.placeable_pieces). */
function placeablePieceIds(game) {
  let data = game?.other_game_data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return []; }
  }
  const list = Array.isArray(data?.placeable_pieces) ? data.placeable_pieces : [];
  return list.map((t) => Number(t?.piece_id)).filter((n) => Number.isFinite(n) && n > 0);
}

/** Piece ids mentioned by a game's pieces_string starting layout. */
function startingPieceIds(game) {
  if (!game?.pieces_string) return [];
  try {
    const parsed = typeof game.pieces_string === 'string'
      ? JSON.parse(game.pieces_string) : game.pieces_string;
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.values(parsed)
      .map((v) => Number(v?.piece_id))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch (_) {
    return [];
  }
}

/**
 * Freeze a game's current rules, returning the snapshot's id.
 *
 * Idempotent by construction: the id IS the content, so re-running this for an
 * unchanged game finds the row already there and writes nothing.
 *
 * @returns {Promise<string|null>} The fingerprint, or null if the game is gone.
 */
async function ensureSnapshot(db_pool, gameTypeId) {
  const live = await readLive(db_pool, gameTypeId);
  if (!live) return null;

  const pieceById = new Map(live.pieces.map((p) => [Number(p.id), p]));
  const fingerprint = fingerprintGame(live.game, live.placements, pieceById);

  await db_pool.query(
    `INSERT INTO puzzle_rule_snapshots (fingerprint, game_type_id, payload)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE game_type_id = VALUES(game_type_id)`,
    [fingerprint, Number(gameTypeId), JSON.stringify(live)]
  );

  return fingerprint;
}

/**
 * Read a frozen snapshot back.
 *
 * @returns {Promise<{game, pieces, placements}|null>}
 */
async function loadSnapshot(db_pool, fingerprint) {
  if (!fingerprint) return null;
  const [[row]] = await db_pool.query(
    'SELECT payload FROM puzzle_rule_snapshots WHERE fingerprint = ? LIMIT 1',
    [fingerprint]
  ).catch(() => [[null]]);
  if (!row?.payload) return null;
  let parsed;
  try {
    parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  } catch (_) {
    return null;
  }
  if (!parsed?.game) return null;
  return completeSnapshot(db_pool, fingerprint, parsed);
}

/*
 * A snapshot frozen before piecesNamedIn knew about a kind of piece is missing
 * that piece's definition for good - its fingerprint does not change (only
 * pieces on starting squares are hashed), so it is never rewritten. Fill such
 * gaps from the pieces table ONCE and save them into the snapshot, so it is
 * frozen again from then on. A piece that no longer exists stays missing.
 */
async function completeSnapshot(db_pool, fingerprint, snap) {
  const have = new Set((snap.pieces || []).map((p) => Number(p.id)));
  const missing = [...piecesNamedIn(snap.game)].filter((id) => !have.has(id));
  if (!missing.length) return snap;
  try {
    const [rows] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${missing.map(() => '?').join(',')})`, missing
    );
    if (!rows.length) return snap;
    const completed = { ...snap, pieces: [...(snap.pieces || []), ...rows] };
    await db_pool.query(
      'UPDATE puzzle_rule_snapshots SET payload = ? WHERE fingerprint = ?',
      [JSON.stringify(completed), fingerprint]
    );
    return completed;
  } catch (e) {
    console.warn(`[puzzle] could not complete snapshot ${fingerprint}:`, e.message);
    return snap;
  }
}

/**
 * The rules to play a given puzzle under.
 *
 * The snapshot when it has one, the live game when it does not. The fallback is
 * what lets puzzles written before snapshots existed keep working while they
 * are backfilled, and it is the ONLY path that can see a later edit.
 *
 * @returns {Promise<{game, pieces, placements, fromSnapshot: boolean}|null>}
 */
async function rulesForPuzzle(db_pool, puzzle) {
  if (puzzle?.rule_snapshot) {
    const snap = await loadSnapshot(db_pool, puzzle.rule_snapshot);
    if (snap) return { ...snap, fromSnapshot: true };
    /*
     * A snapshot id that resolves to nothing. Falling back to live rules is the
     * lesser evil - a playable puzzle that might be judged under changed rules
     * beats a puzzle that will not load - but it is worth a line in the log,
     * because it should not be possible.
     */
    console.warn(`[puzzle] snapshot ${puzzle.rule_snapshot} missing for puzzle ${puzzle.id}`);
  }
  const live = await readLive(db_pool, puzzle?.game_type_id);
  return live ? { ...live, fromSnapshot: false } : null;
}

module.exports = {
  readLive, ensureSnapshot, loadSnapshot, rulesForPuzzle, piecesNamedIn,
};
