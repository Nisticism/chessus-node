/*
 * The rules a GAME is played under, frozen when it is created.
 *
 * WHY THIS EXISTS
 *
 * A game used to point at its game type and nothing else. Every time a game
 * was rebuilt from the database - a player rejoining, the server restarting, a
 * correspondence game picked up days later - it read the game type as it stood
 * THEN. So a creator editing their game changed every game of it already in
 * progress. Game 2838 (Strange Shogi) is the case that found this: the creator
 * took the board from nine rows to eight, and one player's whole back rank - its
 * king among them - was left on a row that no longer existed, invisible and
 * unplayable.
 *
 * A game is a contract made when it starts. So it keeps a copy of the rules it
 * started under - the game type row, every piece definition it can involve
 * (placed, promoted to, or placed mid-game), and the per-square placements -
 * and reads those for the rest of its life. Editing a game changes the games
 * that start afterwards, never the ones already being played.
 *
 * CONTENT-ADDRESSED, EXACTLY
 *
 * Stored once per distinct content (an md5 of the whole payload), so a thousand
 * games of an unchanged game type share one row. This is deliberately NOT the
 * rule fingerprint the puzzle snapshots use (game-fingerprint.js): that hashes
 * only the columns a puzzle's answer depends on, and a game needs the row it
 * actually started with, all of it.
 *
 * Games created before this existed have no copy; they read the live tables, as
 * every game used to. The boot backfill (migrations.js) freezes the ones still
 * active at the moment it runs.
 */
const crypto = require('crypto');
const { readLive } = require('./puzzle-snapshot');

const CACHE_MAX = 200;
const cache = new Map(); // hash -> { game, pieces, placements, pieceById }

const parse = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return null; }
};

function remember(hash, rules) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(hash, rules);
}

function withIndex(payload) {
  return {
    ...payload,
    pieceById: new Map((payload.pieces || []).map((p) => [Number(p.id), p])),
  };
}

/**
 * Store a game type's current rules as a snapshot (once per distinct content).
 * Returns { hash, boardWidth, boardHeight }, or null if the game type is gone.
 */
async function freezeGameType(db_pool, gameTypeId) {
  const live = await readLive(db_pool, gameTypeId);
  if (!live) return null;
  const payload = JSON.stringify(live);
  const hash = crypto.createHash('md5').update(payload).digest('hex');
  await db_pool.query(
    'INSERT IGNORE INTO game_rule_snapshots (hash, game_type_id, payload) VALUES (?, ?, ?)',
    [hash, Number(gameTypeId), payload]
  );
  remember(hash, withIndex(live));
  return { hash, boardWidth: live.game.board_width ?? null, boardHeight: live.game.board_height ?? null };
}

/**
 * Freeze a game type's current rules and attach them to a game.
 *
 * Also copies the board size onto the games row, so pages that list games
 * (match history, ongoing games, a finished match) draw each board at the size
 * it was played on without opening the snapshot.
 *
 * Non-fatal by design: a game whose rules could not be frozen still plays,
 * reading the live tables as games always did. Returns the hash, or null.
 */
async function freezeRulesForGame(db_pool, gameId, gameTypeId) {
  try {
    const frozen = await freezeGameType(db_pool, gameTypeId);
    if (!frozen) return null;
    await db_pool.query(
      'UPDATE games SET rule_snapshot = ?, board_width = ?, board_height = ? WHERE id = ?',
      [frozen.hash, frozen.boardWidth, frozen.boardHeight, gameId]
    );
    return frozen.hash;
  } catch (err) {
    console.warn(`[game ${gameId}] could not freeze its rules:`, err.message);
    return null;
  }
}

/** A frozen rule set by hash: { game, pieces, placements, pieceById }, or null. */
async function loadFrozenRules(db_pool, hash) {
  if (!hash) return null;
  if (cache.has(hash)) return cache.get(hash);
  try {
    const [[row]] = await db_pool.query('SELECT payload FROM game_rule_snapshots WHERE hash = ? LIMIT 1', [hash]);
    const payload = parse(row?.payload);
    if (!payload?.game) return null;
    const rules = withIndex(payload);
    remember(hash, rules);
    return rules;
  } catch (err) {
    console.warn(`[game rules] could not load snapshot ${hash}:`, err.message);
    return null;
  }
}

/**
 * The game type row a game is played under: its frozen copy when it has one,
 * the live row when it does not (a game from before this existed). `frozen`
 * says which, and `rules` carries the frozen pieces for the lookups below.
 */
async function gameTypeForGame(db_pool, gameRow) {
  const rules = await loadFrozenRules(db_pool, gameRow?.rule_snapshot);
  if (rules) return { gameType: rules.game, rules, frozen: true };
  if (gameRow?.rule_snapshot) {
    console.warn(`[game ${gameRow.id}] rule snapshot ${gameRow.rule_snapshot} missing - using the live game type`);
  }
  const [[gameType]] = await db_pool.query('SELECT * FROM game_types WHERE id = ?', [gameRow?.game_type_id]);
  return { gameType: gameType || null, rules: null, frozen: false };
}

/**
 * Piece definitions by id, as the game knows them: frozen ones first, the
 * pieces table for anything the snapshot does not hold (or every id, for a game
 * with no snapshot). Returns rows in the pieces table's own shape.
 */
async function pieceRowsFor(db_pool, rules, ids) {
  const wanted = [...new Set((ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!wanted.length) return [];
  const out = [];
  const missing = [];
  for (const id of wanted) {
    const row = rules?.pieceById?.get(id);
    if (row) out.push(row); else missing.push(id);
  }
  if (missing.length) {
    const [rows] = await db_pool.query('SELECT * FROM pieces WHERE id IN (?)', [missing]);
    out.push(...rows);
  }
  return out;
}

/**
 * The per-square placement row for a piece in this game, preferring the one
 * for `playerNumber` - the frozen placements when the game has them.
 */
async function placementFor(db_pool, rules, gameTypeId, pieceId, playerNumber) {
  if (rules) {
    const rows = (rules.placements || []).filter((r) => Number(r.piece_id) === Number(pieceId));
    return rows.find((r) => Number(r.player_number) === Number(playerNumber)) || rows[0] || null;
  }
  if (!gameTypeId) return null;
  const [rows] = await db_pool.query(
    `SELECT * FROM game_type_pieces WHERE game_type_id = ? AND piece_id = ?
     ORDER BY (player_number = ?) DESC LIMIT 1`,
    [gameTypeId, pieceId, playerNumber]
  );
  return rows[0] || null;
}

module.exports = { freezeGameType, freezeRulesForGame, loadFrozenRules, gameTypeForGame, pieceRowsFor, placementFor };
