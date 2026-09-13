/*
 * Generate one verified puzzle for every game in the daily pool.
 *
 *   node scripts/seed-pool-puzzles.js                    # report only
 *   node scripts/seed-pool-puzzles.js --write            # insert them, published
 *   node scripts/seed-pool-puzzles.js --game 17          # one game, for a look
 *   node scripts/seed-pool-puzzles.js --attempts 400     # try harder per game
 *   node scripts/seed-pool-puzzles.js --local            # use the local DB (much faster)
 *
 * Against production, start the tunnel first (node scripts/dev-db/tunnel.js).
 * Writes db/seeds/daily-pool-puzzles.json either way, which is what the
 * migration installs on other servers - so the puzzles production gets are the
 * same ones verified here rather than a fresh random batch.
 *
 * HOW A PUZZLE IS FOUND
 *
 * Fairy-Stockfish is not involved. It was only ever a proxy filter for "a game
 * whose rules a puzzle can express"; the site's own engine can both find and
 * judge candidates, and using it means every puzzle here is verified by the
 * exact code that will judge it when somebody solves it.
 *
 * REAL GAMES, NOT RANDOM ONES. The first version of this played random legal
 * games from the opening and waited for a mate. That does not work: the engine
 * manages about 20 plies a second, and 600 plies of random chess produced zero
 * mates. Random play does not blunder into mate, it meanders.
 *
 * What does produce mates is people. 2,000-odd finished games are on the site
 * with their move histories, and a human game reaches positions where one side
 * is genuinely lost - which is where a mate-in-one lives. So each game is
 * REPLAYED, and at every position the question is "does the side to move have
 * exactly one move that achieves the goal?" A mate the player found ends the
 * game; a mate the player MISSED is still sitting there, and makes the better
 * puzzle of the two.
 *
 * WHERE TO LOOK. Asking "is there a unique winning move here" properly costs a
 * full move enumeration per candidate move, so it cannot be asked at every ply
 * of every game. It does not have to be asked more than ONCE: a decisive game
 * ended on its winning move, so that move is the LAST one recorded, and the
 * position one ply earlier is a goal-in-one by construction.
 *
 * So a replay walks to the penultimate ply without asking anything, plays the
 * final move, and checks the goal a single time. Checking every ply instead -
 * which the first working version did - costs a full opponent enumeration per
 * ply and made a 110-ply game take eleven seconds instead of one.
 *
 * The one thing still asked of it is UNIQUENESS. A real mate often has two or
 * three moves that deliver it, which makes a poor "find the move" - so when the
 * answer is not unique the next game is tried instead.
 *
 * MISSED WINS. A game's own ending is not the only puzzle in it. In the plies
 * just before the end one side is usually already lost, and a win they did not
 * see is sitting there - which is the better puzzle of the two, because nobody
 * found it at the table. Those positions have to be scanned properly (there is
 * no played move to point at them), so only the closing DEEP_PLIES of a game are
 * searched, and only for game types whose own endings were not unique.
 *
 * The position one ply back also supplies setup_move for free, which is what
 * makes en passant behave in the generated puzzles.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const compat = require(path.join(ROOT, 'server/ai/fairy-stockfish-compat'));
const { fingerprintGame } = require(path.join(ROOT, 'server/game-fingerprint'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const WRITE = process.argv.includes('--write');
const ONLY_GAME = arg('game', null) ? Number(arg('game', null)) : null;
const ATTEMPTS = Number(arg('attempts', 200));
/*
 * --local forces the ordinary DB_* environment even when the tunnel config is
 * present. Worth knowing: validatePuzzle asks the database for promotion
 * options, so over an SSM tunnel every candidate costs a round trip to another
 * continent. Local holds the same data (it is a pull of production) and is many
 * times faster.
 */
const FORCE_LOCAL = process.argv.includes('--local');

/* ------------------------------------------------------- quality gates -- */
/*
 * A puzzle has to be findable but not forced. These are the thresholds that
 * separate "somebody has to spot something" from "there was only one move".
 */
// Don't look before this ply: the opening is not a puzzle.
const MIN_PLY = 6;
// The solver needs real alternatives, or the answer is just the only legal move.
const MIN_LEGAL_MOVES = 6;
// Both sides need something left on the board.
const MIN_PIECES_PER_SIDE = 2;
/*
 * How many plies back from the end to search for a win somebody missed. Each one
 * costs a full scan of the position, so this is the expensive knob.
 */
const DEEP_PLIES = Number(arg('deep', 14));
/*
 * Only search a position for a missed win when the defender has at most this
 * many legal moves. A win-in-one needs them nearly trapped, so this throws away
 * almost every position for the cost of one enumeration.
 */
const MAX_DEFENDER_MOVES = Number(arg('defender-moves', 8));
// How many finished games to replay per game type before giving up on it.
const MAX_GAMES_PER_TYPE = Number(arg('games-per-type', 40));

const SEED_OUT = path.join(ROOT, 'db', 'seeds', 'daily-pool-puzzles.json');

// Mirrors scripts/puzzle-pool-sweep.js. Kept here so the generator can be run
// before the pool table exists on a given server.
const MAX_BOARD_ASPECT = 1.5;
const MIN_PIECE_TYPES = 3;

const T = v => v === true || v === 1 || v === '1';

function connectionConfig() {
  try {
    if (FORCE_LOCAL) throw new Error('--local');
    const { loadEnv } = require(path.join(ROOT, 'scripts/dev-db/_config'));
    const cfg = loadEnv();
    if (cfg.RDS_HOST && cfg.RDS_PASSWORD) {
      return {
        host: cfg.TUNNEL_HOST, port: Number(cfg.TUNNEL_PORT),
        user: cfg.RDS_USER, password: cfg.RDS_PASSWORD, database: cfg.RDS_DB,
        label: `production via tunnel ${cfg.TUNNEL_HOST}:${cfg.TUNNEL_PORT}`,
      };
    }
  } catch (_) { /* no tunnel config - use the environment */ }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'chessusnode',
    label: `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'chessusnode'}`,
  };
}

/*
 * The engine reads the DB through configs/db, which builds its pool from
 * process.env at require time - so the environment has to be pointed at the
 * right database BEFORE game-socket is loaded.
 */
const dsn = connectionConfig();
process.env.DB_HOST = dsn.host;
process.env.DB_PORT = String(dsn.port);
process.env.DB_USER = dsn.user;
process.env.DB_PASSWORD = dsn.password;
process.env.DB_NAME = dsn.database;

const ENGINE_FIELD_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};

// The same per-placement overrides the puzzle routes merge. See the note on
// JUNCTION_OVERRIDES in server/puzzle-routes.js: null means "not overridden".
const JUNCTION_OVERRIDES = [
  'ends_game_on_checkmate', 'ends_game_on_capture',
  'manual_castling_partners', 'castling_partner_left_key', 'castling_partner_right_key',
  'castling_distance', 'can_control_squares', 'can_en_passant',
  'can_fire_over_allies', 'can_fire_over_enemies',
  'promotion_pieces_override', 'disable_promotion',
  'can_promote_to_checkmate', 'limit_promote_checkmate_to_original',
  'can_promote_to_capture', 'limit_promote_capture_to_original',
  'capture_points_gain', 'capture_points_loss',
  'cannot_move_outside_zone', 'cannot_be_captured', 'is_neutral',
  'hit_points', 'attack_damage', 'hp_regen', 'burn_damage', 'burn_duration',
  'trample', 'trample_radius', 'ghostwalk', 'die_on_capture',
  'die_on_capture_grants_win', 'attack_radius',
];

/** Titles, from the goal. Short, and the owner can edit any of them afterwards. */
const TITLE_FOR_GOAL = {
  checkmate_in_1: 'Mate in one',
  capture_target: 'Take the key piece',
  stalemate_them: 'Stalemate in one',
  no_moves_them: 'Leave them stuck',
  lose_all_pieces: 'Lose it all',
  promote_a_piece: 'Promote in one',
  control_square: 'Claim the square',
  win_in_1: 'Win in one',
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

(async () => {
  const { label, ...conn } = dsn;
  console.log(`[seed-puzzles] ${label}${WRITE ? '  (WRITING)' : '  (dry run)'}`);
  console.log(`[seed-puzzles] up to ${ATTEMPTS} playout(s) per game\n`);

  const db = await mysql.createConnection({ ...conn, connectTimeout: 20000 });
  const [games] = await db.query('SELECT * FROM game_types');
  const [placements] = await db.query('SELECT * FROM game_type_pieces');
  const [pieceRows] = await db.query('SELECT * FROM pieces');

  const pieceById = new Map(pieceRows.map(p => [p.id, p]));
  const placeByGame = new Map();
  for (const pl of placements) {
    if (!placeByGame.has(pl.game_type_id)) placeByGame.set(pl.game_type_id, []);
    placeByGame.get(pl.game_type_id).push(pl);
  }

  /*
   * The pool. Read from puzzle_pool when it exists - that table is the decision,
   * hand-picks included - and otherwise recomputed from the same rules, so the
   * generator works on a server where the sweep has not been run yet.
   */
  let poolIds = null;
  try {
    const [rows] = await db.query(
      "SELECT game_type_id FROM puzzle_pool WHERE status IN ('auto_included','included')"
    );
    if (rows.length) {
      poolIds = new Set(rows.map(r => r.game_type_id));
      console.log(`[seed-puzzles] pool from puzzle_pool: ${poolIds.size} game(s)`);
    }
  } catch (_) { /* no table yet */ }

  if (!poolIds) {
    poolIds = new Set();
    for (const g of games) {
      if (T(g.is_draft)) continue;
      const mine = placeByGame.get(g.id) || [];
      if (!mine.length) continue;
      const defs = [...new Set(mine.map(p => p.piece_id))].map(i => pieceById.get(i)).filter(Boolean);
      if (compat.checkCompatibility(g, defs, mine).reasons.some(r => !r.safeToIgnore)) continue;
      if (T(g.mate_condition_requires_all)) continue;
      const w = Number(g.board_width), h = Number(g.board_height);
      if (!w || !h || Math.max(w, h) / Math.min(w, h) > MAX_BOARD_ASPECT) continue;
      const kinds = rows => new Set(rows.map(x => x.piece_id).filter(Boolean)).size;
      const per = [1, 2].map(s => kinds(mine.filter(x => Number(x.player_number) === s)));
      if (kinds(mine) < MIN_PIECE_TYPES || per.some(n => n < MIN_PIECE_TYPES)) continue;
      poolIds.add(g.id);
    }
    console.log(`[seed-puzzles] pool recomputed (no puzzle_pool rows): ${poolIds.size} game(s)`);
  }

  const [[owner]] = await db.query("SELECT id FROM users WHERE username = 'GridGrove' LIMIT 1");
  if (WRITE && !owner) {
    console.error('[seed-puzzles] No GridGrove account. Run migrations first.');
    process.exit(1);
  }

  const [existing] = owner
    ? await db.query('SELECT DISTINCT game_type_id FROM puzzles WHERE creator_id = ?', [owner.id])
    : [[]];
  const alreadySeeded = new Set(existing.map(r => r.game_type_id));

  const { goalsForGameType, validatePuzzle, buildGameState, applyPly, goalMet } =
    require(path.join(ROOT, 'server/puzzle-validation'));
  const { getAllLegalMovesForPlayer } = require(path.join(ROOT, 'server/game-socket'));

  /** Merge a placement into a full engine piece, exactly as the routes do. */
  const buildPiece = (pl, junctionBySide, junctionByPiece, startingSquares) => {
    const pieceId = Number(pl.piece_id);
    const player = Number(pl.player_id ?? pl.player_number ?? 1);
    const def = { ...(pieceById.get(pieceId) || {}) };
    for (const [from, to] of Object.entries(ENGINE_FIELD_RENAMES)) {
      if (def[from] !== undefined) def[to] = def[from];
    }
    const junction = junctionBySide.get(`${pieceId}:${player}`) || junctionByPiece.get(pieceId) || {};
    const home = startingSquares.has(`${pieceId}:${player}:${Number(pl.y)},${Number(pl.x)}`);
    const out = {
      ...def,
      id: `${pieceId}_${pl.y}_${pl.x}`,
      piece_id: pieceId,
      x: Number(pl.x), y: Number(pl.y),
      player_id: player, team: player, player_number: player,
      hasMoved: !home, moveCount: home ? 0 : 1,
    };
    for (const col of JUNCTION_OVERRIDES) if (junction[col] != null) out[col] = junction[col];
    return out;
  };

  /*
   * The compact placement shape a puzzle stores.
   *
   * `id` is kept deliberately. A move is applied by finding the piece whose id
   * matches move.pieceId, and a solution mined from a real game carries the id
   * that piece had THERE - derived from where it started, not where it now
   * stands. Drop the id here and hydratePosition invents a different one from
   * the current square, nothing matches, and the puzzle rejects its own answer.
   */
  const toPlacement = (p) => ({
    id: p.id,
    piece_id: p.piece_id,
    player_id: Number(p.player_id ?? p.team ?? 1),
    x: Number(p.x), y: Number(p.y),
    piece_name: p.piece_name,
    ends_game_on_checkmate: !!p.ends_game_on_checkmate,
    ends_game_on_capture: !!p.ends_game_on_capture,
    hasMoved: !!p.hasMoved,
    moveCount: Number(p.moveCount) || 0,
  });

  const found = [];
  const failed = [];
  const targets = games
    .filter(g => poolIds.has(g.id))
    .filter(g => (ONLY_GAME ? g.id === ONLY_GAME : true))
    .sort((a, b) => a.id - b.id);

  console.log(`[seed-puzzles] ${targets.length} game(s) to do\n`);

  for (const game of targets) {
    if (alreadySeeded.has(game.id) && !ONLY_GAME) {
      console.log(`  #${String(game.id).padStart(3)} ${String(game.game_name).slice(0, 30).padEnd(31)} already seeded`);
      continue;
    }

    const mine = placeByGame.get(game.id) || [];
    const junctionBySide = new Map();
    const junctionByPiece = new Map();
    for (const r of mine) {
      junctionBySide.set(`${r.piece_id}:${r.player_number}`, r);
      if (!junctionByPiece.has(r.piece_id)) junctionByPiece.set(r.piece_id, r);
    }

    // The opening, which is both the starting position and the answer to "has
    // this piece moved?" for every position derived from it.
    let opening = {};
    try { opening = JSON.parse(game.pieces_string || '{}') || {}; } catch (_) { opening = {}; }
    const startingSquares = new Set();
    const openingList = [];
    for (const [key, v] of Object.entries(opening)) {
      const [ky, kx] = String(key).split(',').map(Number);
      const x = Number(v.x ?? kx), y = Number(v.y ?? ky);
      const player = Number(v.player_id ?? v.player_number ?? 1);
      startingSquares.add(`${Number(v.piece_id)}:${player}:${y},${x}`);
      openingList.push({ ...v, x, y, player_id: player });
    }
    if (!openingList.length) {
      failed.push({ id: game.id, name: game.game_name, why: 'no starting position' });
      console.log(`  #${String(game.id).padStart(3)} ${String(game.game_name).slice(0, 30).padEnd(31)} no starting position`);
      continue;
    }

    const initialPieces = openingList.map(pl =>
      buildPiece(pl, junctionBySide, junctionByPiece, startingSquares));

    const goals = goalsForGameType(game).filter(g => g.mechanical);
    if (!goals.length) {
      failed.push({ id: game.id, name: game.game_name, why: 'no mechanical goal' });
      continue;
    }
    const goal = goals[0].value;

    /*
     * Replay this game type's DECISIVE games and stop at the first whose ending
     * is a unique goal-in-one. Only decisive games are worth replaying - a game
     * that timed out or was resigned never contained the winning move.
     */
    let hit = null;
    let replayed = 0;
    let endings = 0;     // goal-achieving moves found (unique or not)
    let scans = 0;       // positions searched for a win somebody missed
    const started = Date.now();
    const openingCache = new Map();

    /*
     * Does the side to move have exactly one move achieving the goal here?
     *
     * Returns the puzzle, or null. `origin` records whether it came from the
     * game's own ending or from a win the players walked past, which is worth
     * knowing when reading the output.
     */
    const tryPosition = async (state, side, priorMove, ply, gameId, origin) => {
      const enginePosition = JSON.parse(JSON.stringify(state.pieces));
      const storedPosition = state.pieces.map(toPlacement);
      const counts = [1, 2].map(sd =>
        storedPosition.filter(pp => Number(pp.player_id) === sd).length);
      if (!counts.every(n => n >= MIN_PIECES_PER_SIDE)) return null;

      const legal = getAllLegalMovesForPlayer(state, side) || [];
      if (legal.length < MIN_LEGAL_MOVES) return null;

      const probe = {
        position: enginePosition,
        initial_pieces: initialPieces,
        side_to_move: side,
        setup_move: { from: priorMove.from, to: priorMove.to },
        game_type_id: game.id,
        goal,
        // Any move serves as the "intended" one: the scan reports every move
        // that achieves the goal in `solutions` regardless of which is offered.
        solution_line: [legal[0]],
      };
      const scan = await validatePuzzle(probe, game);
      if (!scan.solutions || scan.solutions.length !== 1) return null;

      probe.solution_line = [scan.solutions[0]];
      const verdict = await validatePuzzle(probe, game);
      if (verdict.status !== 'valid') return null;

      return {
        position: storedPosition,
        side_to_move: side,
        setupMove: probe.setup_move,
        ply,
        goal,
        solution_line: probe.solution_line,
        detail: verdict.detail,
        fromGame: gameId,
        origin,
      };
    };

    /*
     * Decisive games are all the first pass needs - a game that timed out never
     * contained the winning move. The DEEP pass takes every finished game,
     * because a win somebody walked past is there whatever the game's result was,
     * and drawn games are full of them.
     */
    const historyFor = async (deep) => db.query(
      `SELECT gm.game_id, gm.moves_json, gm.initial_pieces_json
       FROM game_moves gm
       JOIN games g ON g.id = gm.game_id
       WHERE g.game_type_id = ? AND g.status = 'completed'
         AND gm.moves_json IS NOT NULL
         AND (g.winner_id IS NOT NULL OR ? = 1)
       ORDER BY g.move_count DESC
       LIMIT ?`,
      [game.id, deep ? 1 : 0, MAX_GAMES_PER_TYPE]
    ).then(([rows]) => rows);

    /*
     * Two passes. The first only looks at how each game ended, which is nearly
     * free; the second also searches the closing plies for a win nobody played,
     * which is not. The second only runs if the first found nothing.
     */
    for (const deep of [false, true]) {
    if (hit) break;
    if (deep && !DEEP_PLIES) break;
    replayed = 0;
    const history = await historyFor(deep);
    for (const row of history) {
      if (hit) break;
      let moves;
      try { moves = JSON.parse(row.moves_json); } catch (_) { continue; }
      if (!Array.isArray(moves) || moves.length < MIN_PLY + 2) continue;

      /*
       * Replay from the position the game ACTUALLY started from. Stored games
       * carry it; where they do not, the game type's opening is the fallback
       * (no completed game on the site used a randomised start, so the two
       * agree in practice).
       */
      let startPieces = initialPieces;
      if (row.initial_pieces_json) {
        /*
         * Recorded openings repeat: every game of a type that does not randomise
         * starts from the same board, so the same JSON is parsed and rebuilt for
         * each of them. Cached on the raw string, which is the cheapest honest
         * key - two identical strings are two identical openings.
         */
        const cached = openingCache.get(row.initial_pieces_json);
        if (cached) {
          startPieces = cached;
        } else {
          try {
            const recorded = JSON.parse(row.initial_pieces_json);
            if (Array.isArray(recorded) && recorded.length) {
              startPieces = recorded.map(pl =>
                buildPiece(pl, junctionBySide, junctionByPiece, startingSquares));
              openingCache.set(row.initial_pieces_json, startPieces);
            }
          } catch (_) { /* fall back to the game type's own opening */ }
        }
      }

      replayed++;
      const state = buildGameState({
        position: JSON.parse(JSON.stringify(startPieces)),
        initial_pieces: initialPieces,
        side_to_move: 1,
        game_type_id: game.id,
      }, game);

      const last = moves.length - 1;
      const winning = moves[last];
      const setupMove = moves[last - 1];
      if (!winning?.from || !winning?.to || !setupMove?.from || !setupMove?.to) continue;

      /*
       * Walk to the position the winning move was played from. Nothing on the
       * way needs the engine's opinion - these are moves that were played and
       * accepted once already - EXCEPT in the closing plies, where a win
       * somebody missed is worth looking for.
       */
      const deepFrom = deep ? Math.max(MIN_PLY, last - DEEP_PLIES) : last;
      let ok = true;
      let prior = null;   // the move that led into the current position

      for (let ply = 0; ply < last; ply++) {
        const played = moves[ply];
        if (!played?.from || !played?.to) { ok = false; break; }
        const mover = Number(played.position) === 2 ? 2 : (ply % 2 === 0 ? 1 : 2);
        state.currentTurn = mover;

        /*
         * The cheap gate before the expensive scan. A win-in-one needs the
         * DEFENDER nearly out of moves, and counting their moves is one
         * enumeration against the scan's fifty - so positions where they still
         * have plenty are skipped outright. Without this a 40-piece board spends
         * minutes per game and finds nothing faster than it would have anyway.
         */
        if (ply >= deepFrom && prior && !hit) {
          const defender = mover === 1 ? 2 : 1;
          state.currentTurn = defender;
          const defenderMoves = (getAllLegalMovesForPlayer(state, defender) || []).length;
          state.currentTurn = mover;
          if (defenderMoves > 0 && defenderMoves <= MAX_DEFENDER_MOVES) {
            scans++;
            const cand = await tryPosition(state, mover, prior, ply, row.game_id, 'missed');
            if (cand) { hit = cand; break; }
          }
        }

        let res;
        try {
          // eslint-disable-next-line no-await-in-loop
          res = await applyPly(state, played, { autoPromote: true });
        } catch (_) { ok = false; break; }
        if (!res.ok) { ok = false; break; }
        prior = played;
      }
      if (hit) break;
      if (!ok) continue;

      /*
       * Two forms of the same position, and they are not interchangeable.
       *
       * `enginePosition` is the full engine pieces - every movement column - and
       * is what validatePuzzle has to be given, because buildGameState uses
       * puzzle.position AS state.pieces without hydrating it. Hand it the
       * compact form and every piece has no movement configuration at all, so
       * the engine generates zero moves and every candidate comes back
       * unsolvable. (That is exactly what happened on the first full run: eighty
       * genuine mates found, not one of them judged valid.)
       *
       * `storedPosition` is the compact shape a puzzle row holds, which the
       * server re-hydrates through hydratePosition when it loads one.
       */
      const enginePosition = JSON.parse(JSON.stringify(state.pieces));
      const storedPosition = state.pieces.map(toPlacement);
      const side = Number(winning.position) === 2 ? 2 : (last % 2 === 0 ? 1 : 2);
      state.currentTurn = side;

      let res;
      try {
        res = await applyPly(state, winning, { autoPromote: true });
      } catch (_) { continue; }
      if (!res.ok) continue;

      // The single goal check.
      if (!goalMet(goal, state, side, res)) continue;
      endings++;

      const counts = [1, 2].map(sd =>
        storedPosition.filter(pp => Number(pp.player_id) === sd).length);
      if (!counts.every(n => n >= MIN_PIECES_PER_SIDE)) continue;

      const solution = { ...winning, ...(res.promotedTo || {}) };
      const probe = {
        position: enginePosition,
        initial_pieces: initialPieces,
        side_to_move: side,
        setup_move: { from: setupMove.from, to: setupMove.to },
        game_type_id: game.id,
        goal,
        solution_line: [solution],
      };
      /*
       * The one expensive call per game. It confirms the recorded move achieves
       * the goal AND reports every other move that does, so `valid` means the
       * answer is unique - the whole requirement for a daily puzzle.
       */
      // eslint-disable-next-line no-await-in-loop
      const verdict = await validatePuzzle(probe, game);
      if (verdict.status === 'valid') {
        hit = {
          position: storedPosition,
          side_to_move: side,
          setupMove: probe.setup_move,
          ply: last,
          goal,
          solution_line: [solution],
          detail: verdict.detail,
          fromGame: row.game_id,
          origin: 'ending',
        };
      }
    }
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const name = String(game.game_name).slice(0, 30).padEnd(31);
    if (hit) {
      found.push({
        game_type_id: game.id,
        game_name: game.game_name,
        /*
         * The fingerprint of the game this was verified in. The installer
         * recomputes it on the target server and refuses to attach the puzzle
         * to a game that has drifted - an id match alone would happily hang a
         * verified position on a different version of the same game.
         */
        game_fingerprint: fingerprintGame(game, placeByGame.get(game.id) || [], pieceById),
        title: TITLE_FOR_GOAL[goal] || 'Find the move',
        description: null,
        position: hit.position,
        side_to_move: hit.side_to_move,
        setup_move: hit.setupMove,
        goal,
        goal_description: null,
        solution_line: hit.solution_line,
        solution_depth: 1,
        validation_detail: hit.detail || null,
      });
      console.log(`  #${String(game.id).padStart(3)} ${name} FOUND  ${goal.padEnd(15)} ${hit.origin.padEnd(6)} game ${String(hit.fromGame).padStart(4)} ply ${String(hit.ply).padStart(3)}  ${scans} scan(s)  ${secs}s`);
    } else {
      failed.push({
        id: game.id, name: game.game_name, goal,
        why: replayed
          ? `${endings} ending(s) and ${scans} scanned position(s), none with a unique answer`
          : 'no decisive games on the site to mine',
      });
      console.log(`  #${String(game.id).padStart(3)} ${name} none   ${goal.padEnd(15)} ${endings} ending(s), ${scans} scan(s)  ${secs}s`);
    }
  }

  /* ----------------------------------------------------------- output -- */
  console.log(`\nfound: ${found.length}   none: ${failed.length}`);
  if (failed.length) {
    console.log('\n--- no puzzle found ---');
    for (const f of failed) console.log(`  #${String(f.id).padStart(3)} ${String(f.name).slice(0, 32).padEnd(33)} ${f.why}`);
  }

  /*
   * The seed file is NOT written here.
   *
   * This script only knows about the puzzles it just found, so writing the seed
   * from its own results overwrites everything earlier runs produced - a second
   * run replaced a 29-puzzle seed file with its own 4. The seed is a snapshot of
   * what is published, which only the database can answer, so
   * scripts/export-pool-puzzles.js writes it instead.
   */
  if (found.length) {
    console.log(`\nFound ${found.length}. Refresh the seed file with:`);
    console.log('  node scripts/export-pool-puzzles.js --local');
  }

  if (!WRITE) {
    console.log('\nDry run - nothing inserted. Re-run with --write to publish them here.');
    await db.end();
    return;
  }

  let inserted = 0;
  for (const p of found) {
    await db.query(
      `INSERT INTO puzzles
         (game_type_id, creator_id, title, description, position, side_to_move,
          setup_move, goal, goal_description, solution_line, solution_depth,
          allow_daily, is_draft, published_at, validation_status,
          validation_detail, validated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,0,NOW(),'valid',?,NOW())`,
      [
        p.game_type_id, owner.id, p.title, p.description,
        JSON.stringify(p.position), p.side_to_move,
        JSON.stringify(p.setup_move), p.goal, p.goal_description,
        JSON.stringify(p.solution_line), p.solution_depth,
        p.validation_detail,
      ]
    );
    inserted++;
  }
  await db.end();
  console.log(`\nPublished ${inserted} puzzle(s) as GridGrove.`);
  console.log('Now fill the rotation: the Puzzle of the Day tab in the admin dashboard.');
})().catch(e => { console.error(e.stack); process.exit(1); });
