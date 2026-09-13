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

  const [placements] = await db_pool.query(
    'SELECT * FROM game_type_pieces WHERE game_type_id = ?', [id]
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

  let pieces = [];
  if (ids.size) {
    const list = [...ids];
    [pieces] = await db_pool.query(
      `SELECT * FROM pieces WHERE id IN (${list.map(() => '?').join(',')})`, list
    );
  }

  return { game, pieces, placements };
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

  collect(game.promotion_pieces_ids);
  // The starting layout names its own pieces, and a game can start with a piece
  // that has no junction row.
  collect(startingPieceIds(game));
  return out;
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
  try {
    const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!parsed?.game) return null;
    return parsed;
  } catch (_) {
    return null;
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
