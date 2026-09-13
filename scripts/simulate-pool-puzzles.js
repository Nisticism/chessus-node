/*
 * Find puzzles for pool games that have never been played.
 *
 *   node scripts/simulate-pool-puzzles.js --local
 *   node scripts/simulate-pool-puzzles.js --local --write
 *   node scripts/simulate-pool-puzzles.js --local --game 187
 *
 * WHY THIS EXISTS
 *
 * scripts/seed-pool-puzzles.js mines real games, which is the best source there
 * is - but about forty pool games have never been finished by anybody, so there
 * is nothing to mine. This plays them instead.
 *
 * WHY FAIRY-STOCKFISH AND NOT THE SITE'S ENGINE
 *
 * A FORCED win has to be searched for, and the site's engine cannot do it at a
 * useful speed: it manages roughly 20 plies a second, so proving a mate in two
 * would take half a minute per position and there are thousands of positions.
 * Fairy-Stockfish searches the same position in milliseconds and reports the
 * mate distance directly. It can only play games it can express - which is
 * exactly the pool's entry requirement, so every game here qualifies.
 *
 * WHAT IT LOOKS FOR
 *
 * Self-play, then at each position ask the engine for its verdict:
 *
 *   - a mate in MORE than one move (mate >= 2), which is a forced sequence the
 *     solver has to see the whole of. Mate-in-one is deliberately skipped here:
 *     the mining script already produces those in quantity, and a multi-move
 *     forced mate is a better puzzle.
 *   - for a game with no mate condition, a forced win by the game's own rule -
 *     found the same way, because the variant INI encodes that rule, so the
 *     engine's "mate" is whatever ends that game.
 *
 * Every candidate is then replayed through the SITE's engine and validated by
 * the same validatePuzzle the solver will use. The engine finds candidates; it
 * never has the last word on whether one is a valid puzzle.
 *
 * UNIQUENESS OF THE FIRST MOVE
 *
 * A forced mate is not automatically a puzzle. If two different first moves both
 * mate, "find the move" has two answers, and a solver who finds the other one is
 * told they are wrong. So every alternative first move is played and searched,
 * and the position is accepted only when exactly one of them wins.
 *
 * When more than one does, the position is PERTURBED rather than abandoned:
 * one of the attacker's spare pieces is taken off and the question asked again.
 * Removing attacking material is what kills duplicate mates, and it usually
 * leaves the intended one standing. It is far cheaper than playing out another
 * whole game to reach a fresh position, which is why a game that yields nothing
 * on its own can still produce a puzzle.
 */
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const compat = require(path.join(ROOT, 'server/ai/fairy-stockfish-compat'));
const translator = require(path.join(ROOT, 'server/ai/fairy-stockfish-translator'));
const { createEngine } = require(path.join(ROOT, 'server/ai/fairy-stockfish-node'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const WRITE = process.argv.includes('--write');
const FORCE_LOCAL = process.argv.includes('--local');
const ONLY_GAME = arg('game', null) ? Number(arg('game', null)) : null;

// Self-play games to run per game type before giving up on it.
const GAMES_PER_TYPE = Number(arg('games', 6));
// Plies to play in each. Long enough to reach an endgame where mates live.
const MAX_PLY = Number(arg('max-ply', 120));
// Search depth for the self-play moves. Shallow on purpose: a strong engine
// playing itself draws, and a drawn game contains no mates.
const PLAY_DEPTH = Number(arg('play-depth', 4));
// Search depth for the "is there a forced win here" question.
const PROBE_DEPTH = Number(arg('probe-depth', 12));
// Shortest forced win worth taking. 2 = mate in two.
const MIN_MATE = Number(arg('min-mate', 2));
// Longest, so a puzzle stays solvable by a person.
const MAX_MATE = Number(arg('max-mate', 4));
// Don't probe before this ply.
const MIN_PLY = 10;
// How many times to perturb a promising-but-ambiguous position before giving up.
const MAX_PERTURBATIONS = Number(arg('perturb', 8));
/*
 * The depth mix to aim for, as shares. Mirrors DEPTH_SHARE in
 * server/daily-puzzle.js: the scheduler enforces the mix on the ROTATION, this
 * steers what gets BUILT so the scheduler has the right things to choose from.
 * Mate-in-one is absent deliberately - mining real games already produces those
 * in quantity, and the point of simulating is to add the longer ones.
 */
const DEPTH_TARGET = { 2: 0.55, 3: 0.30, 4: 0.15 };

const T = (v) => v === true || v === 1 || v === '1';
const MAX_BOARD_ASPECT = 1.5;
const MIN_PIECE_TYPES = 3;

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
  } catch (_) { /* fall through */ }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'chessusnode',
    label: `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'chessusnode'}`,
  };
}

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

const TITLE_FOR_MATE = {
  2: 'Mate in two',
  3: 'Mate in three',
  4: 'Mate in four',
};

(async () => {
  const { label, ...conn } = dsn;
  console.log(`[simulate] ${label}${WRITE ? '  (WRITING)' : '  (dry run)'}`);
  console.log(`[simulate] ${GAMES_PER_TYPE} self-play game(s) per type, mate in ${MIN_MATE}-${MAX_MATE}\n`);

  const db = await mysql.createConnection({ ...conn, connectTimeout: 20000 });
  const [games] = await db.query('SELECT * FROM game_types');
  const [placements] = await db.query('SELECT * FROM game_type_pieces');
  const [pieceRows] = await db.query('SELECT * FROM pieces');

  const pieceById = new Map(pieceRows.map((p) => [p.id, p]));
  const placeByGame = new Map();
  for (const pl of placements) {
    if (!placeByGame.has(pl.game_type_id)) placeByGame.set(pl.game_type_id, []);
    placeByGame.get(pl.game_type_id).push(pl);
  }

  /*
   * The target list: pool games with no usable puzzle yet. That is the whole
   * point - games that already have one do not need simulating.
   */
  const [poolRows] = await db.query(
    `SELECT pp.game_type_id
     FROM puzzle_pool pp
     WHERE pp.status IN ('auto_included', 'included')
       AND NOT EXISTS (
         SELECT 1 FROM puzzles p
         WHERE p.game_type_id = pp.game_type_id
           AND p.is_draft = 0 AND p.validation_status = 'valid'
       )`
  ).catch(() => [[]]);
  let targetIds = new Set(poolRows.map((r) => r.game_type_id));

  if (!targetIds.size) {
    // No pool table (or nothing missing): fall back to the same requirements.
    for (const g of games) {
      if (T(g.is_draft)) continue;
      const mine = placeByGame.get(g.id) || [];
      if (!mine.length) continue;
      const defs = [...new Set(mine.map((p) => p.piece_id))].map((i) => pieceById.get(i)).filter(Boolean);
      if (compat.checkCompatibility(g, defs, mine).reasons.some((r) => !r.safeToIgnore)) continue;
      if (T(g.mate_condition_requires_all)) continue;
      const w = Number(g.board_width), h = Number(g.board_height);
      if (!w || !h || Math.max(w, h) / Math.min(w, h) > MAX_BOARD_ASPECT) continue;
      const kinds = (rows) => new Set(rows.map((x) => x.piece_id).filter(Boolean)).size;
      const per = [1, 2].map((s) => kinds(mine.filter((x) => Number(x.player_number) === s)));
      if (kinds(mine) < MIN_PIECE_TYPES || per.some((n) => n < MIN_PIECE_TYPES)) continue;
      targetIds.add(g.id);
    }
  }

  const [[owner]] = await db.query("SELECT id FROM users WHERE username = 'GridGrove' LIMIT 1");
  if (WRITE && !owner) {
    console.error('[simulate] No GridGrove account. Run migrations first.');
    process.exit(1);
  }

  const { validatePuzzle, buildGameState, applyPly } =
    require(path.join(ROOT, 'server/puzzle-validation'));
  const { getAllLegalMovesForPlayer } = require(path.join(ROOT, 'server/game-socket'));

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

  const engine = await createEngine();
  const found = [];
  const failed = [];
  // What has been built so far, so the depth mix can be steered.
  const builtByDepth = { 2: 0, 3: 0, 4: 0 };

  /** Is this depth still wanted, given what has been built already? */
  const depthWanted = (depth) => {
    const total = Object.values(builtByDepth).reduce((a, n) => a + n, 0);
    if (total < 4) return true;            // too early to shape anything
    const share = (builtByDepth[depth] || 0) / total;
    return share < (DEPTH_TARGET[depth] || 0) * 1.35;
  };

  /**
   * Does exactly ONE first move force a win here?
   *
   * The site's legal moves are the candidate list - it is the authority on what
   * a solver could actually play - and each is handed to the engine to evaluate.
   * After the move it is the DEFENDER to move, so a negative mate score (or zero,
   * meaning already mated) says that alternative wins too.
   *
   * @returns {{unique: boolean, winners: number}}
   */
  const firstMoveIsUnique = async (position, side, setupMove, intended, game, charMap, initialPieces) => {
    const legal = getAllLegalMovesForPlayer(
      buildGameState({
        position: JSON.parse(JSON.stringify(position)),
        initial_pieces: initialPieces, side_to_move: side,
        setup_move: setupMove, game_type_id: game.id,
      }, game),
      side
    ) || [];

    const sameSquare = (a, b) =>
      a.from.x === b.from.x && a.from.y === b.from.y && a.to.x === b.to.x && a.to.y === b.to.y;

    let winners = 0;
    for (const m of legal) {
      if (sameSquare(m, intended)) continue;
      const st = buildGameState({
        position: JSON.parse(JSON.stringify(position)),
        initial_pieces: initialPieces, side_to_move: side,
        setup_move: setupMove, game_type_id: game.id,
      }, game);
      st.currentTurn = side;
      // eslint-disable-next-line no-await-in-loop
      const applied = await applyPly(st, m, { autoPromote: true });
      if (!applied.ok) continue;

      const defender = side === 1 ? 2 : 1;
      let f;
      try {
        f = translator.buildFEN(
          st.pieces, Number(game.board_width), Number(game.board_height),
          defender, 0, 0, [], charMap
        );
      } catch (_) { continue; }
      // eslint-disable-next-line no-await-in-loop
      const r = await engine.search({ fen: f, depth: PROBE_DEPTH, timeoutMs: 15000 });
      // Defender to move: a mate score of 0 or below means they are lost.
      if (r.mate != null && r.mate <= 0) {
        winners++;
        break;   // one alternative is enough to disqualify it
      }
    }
    return { unique: winners === 0, winners };
  };

  /**
   * Take one of the attacker's spare pieces off the board.
   *
   * Spare means: not royal, and not the piece that plays the intended move.
   * Removing attacking material is what collapses duplicate mates; removing a
   * DEFENDER would usually create more of them.
   *
   * @returns a new position, or null when there is nothing safe to remove.
   */
  const perturb = (position, side, intended) => {
    const spare = position.filter((p) =>
      Number(p.player_id) === Number(side)
      && !p.ends_game_on_checkmate
      && !p.ends_game_on_capture
      && !(Number(p.x) === Number(intended.from.x) && Number(p.y) === Number(intended.from.y)));
    if (!spare.length) return null;
    const victim = spare[Math.floor(Math.random() * spare.length)];
    return position.filter((p) => p !== victim);
  };

  const targets = games
    .filter((g) => targetIds.has(g.id))
    .filter((g) => (ONLY_GAME ? g.id === ONLY_GAME : true))
    .sort((a, b) => a.id - b.id);
  console.log(`[simulate] ${targets.length} game(s) with no puzzle yet\n`);

  for (const game of targets) {
    const started = Date.now();
    const mine = placeByGame.get(game.id) || [];
    const junctionBySide = new Map();
    const junctionByPiece = new Map();
    for (const r of mine) {
      junctionBySide.set(`${r.piece_id}:${r.player_number}`, r);
      if (!junctionByPiece.has(r.piece_id)) junctionByPiece.set(r.piece_id, r);
    }

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
    const name = String(game.game_name).slice(0, 28).padEnd(29);
    if (!openingList.length) {
      failed.push({ id: game.id, name: game.game_name, why: 'no starting position' });
      console.log(`  #${String(game.id).padStart(3)} ${name} skip   no starting position`);
      continue;
    }

    const initialPieces = openingList.map((pl) =>
      buildPiece(pl, junctionBySide, junctionByPiece, startingSquares));
    const defs = [...new Set(mine.map((p) => p.piece_id))].map((i) => pieceById.get(i)).filter(Boolean);

    // Teach the engine this game.
    let charMap;
    let variantName;
    try {
      charMap = translator.buildCharMap(defs, mine);
      const built = translator.buildVariantINI(game, defs, mine, charMap);
      await engine.setVariant(built.ini, built.variantName);
      variantName = built.variantName;
    } catch (err) {
      failed.push({ id: game.id, name: game.game_name, why: `cannot translate: ${err.message}` });
      console.log(`  #${String(game.id).padStart(3)} ${name} skip   cannot translate (${err.message})`);
      continue;
    }

    let hit = null;
    let probes = 0;
    // How many times a position had to be simplified to get a single answer.
    let perturbations = 0;
    // How often the site engine refused the engine's move - a rough measure of
    // how well the variant translation models this game.
    let divergences = 0;

    for (let g = 0; g < GAMES_PER_TYPE && !hit; g++) {
      const state = buildGameState({
        position: JSON.parse(JSON.stringify(initialPieces)),
        initial_pieces: initialPieces,
        side_to_move: 1,
        game_type_id: game.id,
      }, game);
      let setupMove = null;

      for (let ply = 0; ply < MAX_PLY && !hit; ply++) {
        const side = ply % 2 === 0 ? 1 : 2;
        state.currentTurn = side;

        let fen;
        try {
          fen = translator.buildFEN(
            state.pieces, Number(game.board_width), Number(game.board_height),
            side, 0, ply, [], charMap
          );
        } catch (_) { break; }

        /*
         * Is there a forced win here? Asked before the move is played, because
         * the position a solver is handed is the one they have to find it in.
         */
        if (ply >= MIN_PLY && setupMove) {
          probes++;
          // eslint-disable-next-line no-await-in-loop
          const probe = await engine.search({ fen, depth: PROBE_DEPTH, timeoutMs: 20000 });
          const mateIn = probe.mate;
          if (mateIn != null && mateIn >= MIN_MATE && mateIn <= MAX_MATE
              && probe.pv.length >= 2 && depthWanted(mateIn)) {
            /*
             * A promising position. It is accepted only if exactly one first
             * move wins; when several do, the position is perturbed - a spare
             * attacking piece removed - and the whole question asked again of
             * the smaller position. Each attempt is a fresh candidate.
             */
            let attemptPosition = JSON.parse(JSON.stringify(state.pieces));
            let attemptFen = fen;
            let attemptMate = mateIn;
            let attemptPv = probe.pv;

            for (let attempt = 0; attempt <= MAX_PERTURBATIONS && !hit; attempt++) {
              /*
               * The engine's principal variation IS the forced sequence: the
               * solver's moves at the even indices, the defence at the odd ones.
               * Translated back into site moves and replayed through the site's
               * engine, because the engine finding it is not the same as the
               * site agreeing it is legal.
               */
              const line = [];
              const replay = buildGameState({
                position: JSON.parse(JSON.stringify(attemptPosition)),
                initial_pieces: initialPieces,
                side_to_move: side,
                setup_move: { from: setupMove.from, to: setupMove.to },
                game_type_id: game.id,
              }, game);

              let translated = true;
              for (let i = 0; i < attemptPv.length && i < (attemptMate * 2 - 1); i++) {
                const mover = i % 2 === 0 ? side : (side === 1 ? 2 : 1);
                replay.currentTurn = mover;
                let move;
                try {
                  move = translator.uciMoveToGameMove(
                    attemptPv[i], replay.pieces, Number(game.board_height)
                  );
                } catch (_) { translated = false; break; }
                if (!move) { translated = false; break; }
                // eslint-disable-next-line no-await-in-loop
                const res = await applyPly(replay, move, { autoPromote: true });
                if (!res.ok) { translated = false; break; }
                line.push({ ...move, ...(res.promotedTo || {}) });
              }

              if (translated && line.length >= 2) {
                // eslint-disable-next-line no-await-in-loop
                const uniq = await firstMoveIsUnique(
                  attemptPosition, side, { from: setupMove.from, to: setupMove.to },
                  line[0], game, charMap, initialPieces
                );

                if (uniq.unique) {
                  const candidate = {
                    position: attemptPosition.map(toPlacement),
                    initial_pieces: initialPieces,
                    side_to_move: side,
                    setup_move: { from: setupMove.from, to: setupMove.to },
                    game_type_id: game.id,
                    goal: 'checkmate_in_1',
                    solution_line: line,
                  };
                  /*
                   * The site's own last word: every move legal from the position
                   * the one before it leaves behind. Forcedness came from the
                   * engine, uniqueness from the sweep above, legality from here.
                   */
                  // eslint-disable-next-line no-await-in-loop
                  const verdict = await validatePuzzle(
                    { ...candidate, position: JSON.parse(JSON.stringify(attemptPosition)) },
                    game
                  );
                  if (verdict.intendedWorks) {
                    hit = {
                      position: candidate.position,
                      side_to_move: side,
                      setup_move: candidate.setup_move,
                      solution_line: line,
                      mateIn: attemptMate,
                      ply,
                      perturbations: attempt,
                      detail: `Fairy-Stockfish proved a forced mate in ${attemptMate} and no `
                        + `other first move wins; the site engine confirmed every move is legal.`
                        + (attempt ? ` Position simplified ${attempt} time(s) to make the answer unique.` : ''),
                    };
                    break;
                  }
                }
              }

              // Not unique (or not replayable). Simplify and ask again.
              if (attempt === MAX_PERTURBATIONS) break;
              const intendedMove = line[0] || (() => {
                try {
                  return translator.uciMoveToGameMove(
                    attemptPv[0], attemptPosition, Number(game.board_height)
                  );
                } catch (_) { return null; }
              })();
              if (!intendedMove) break;

              const smaller = perturb(attemptPosition, side, intendedMove);
              if (!smaller) break;
              attemptPosition = smaller;
              perturbations++;

              try {
                attemptFen = translator.buildFEN(
                  attemptPosition, Number(game.board_width), Number(game.board_height),
                  side, 0, ply, [], charMap
                );
              } catch (_) { break; }
              // eslint-disable-next-line no-await-in-loop
              const reprobe = await engine.search({
                fen: attemptFen, depth: PROBE_DEPTH, timeoutMs: 20000,
              });
              if (reprobe.mate == null || reprobe.mate < MIN_MATE || reprobe.mate > MAX_MATE
                  || reprobe.pv.length < 2) {
                break;   // simplifying broke the mate; this position is spent
              }
              attemptMate = reprobe.mate;
              attemptPv = reprobe.pv;
            }
            if (hit) break;
          }
        }

        // Play on, shallowly - a strong engine playing itself just draws.
        // eslint-disable-next-line no-await-in-loop
        const played = await engine.search({ fen, depth: PLAY_DEPTH, timeoutMs: 10000 });

        /*
         * The engine's move is a SUGGESTION, not an instruction.
         *
         * The variant INI is an approximation of the game - close enough to
         * search in, not always exact - so the site's engine sometimes refuses
         * the move Fairy-Stockfish picked. Treating that as fatal ended the
         * self-play at ply zero for most games and made the whole script look
         * broken; falling back to any legal move keeps the game going, and the
         * engine still gets asked about every position it reaches.
         *
         * Nothing is lost by this: a candidate is only ever accepted after the
         * site's own engine has replayed the whole forced line.
         */
        let move = null;
        if (played.best) {
          try {
            move = translator.uciMoveToGameMove(played.best, state.pieces, Number(game.board_height));
          } catch (_) { move = null; }
        }
        // eslint-disable-next-line no-await-in-loop
        let res = move ? await applyPly(state, move, { autoPromote: true }) : { ok: false };
        if (!res.ok) {
          const legal = getAllLegalMovesForPlayer(state, side) || [];
          if (!legal.length) break;
          move = legal[Math.floor(Math.random() * legal.length)];
          // eslint-disable-next-line no-await-in-loop
          res = await applyPly(state, move, { autoPromote: true });
          if (!res.ok) break;
          divergences++;
        }
        setupMove = move;
      }
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (hit) {
      found.push({
        game_type_id: game.id,
        game_name: game.game_name,
        title: TITLE_FOR_MATE[hit.mateIn] || `Mate in ${hit.mateIn}`,
        description: null,
        position: hit.position,
        side_to_move: hit.side_to_move,
        setup_move: hit.setup_move,
        goal: 'checkmate_in_1',
        goal_description: null,
        solution_line: hit.solution_line,
        solution_depth: Math.ceil(hit.solution_line.length / 2),
        validation_detail: hit.detail,
      });
      builtByDepth[hit.mateIn] = (builtByDepth[hit.mateIn] || 0) + 1;
      console.log(`  #${String(game.id).padStart(3)} ${name} FOUND  mate in ${hit.mateIn}  ply ${hit.ply}  ${probes} probe(s), ${perturbations} simplification(s)  ${secs}s`);
    } else {
      failed.push({
        id: game.id, name: game.game_name,
        why: `no unique forced win in ${probes} probes `
          + `(${divergences} divergence(s), ${perturbations} simplification(s))`,
      });
      console.log(`  #${String(game.id).padStart(3)} ${name} none   ${probes} probe(s), ${perturbations} simplification(s)  ${secs}s`);
    }
  }

  /*
   * The engine is shut down AFTER the results are safely written, not before.
   * See the note on quit() in server/ai/fairy-stockfish-node.js: shutting the
   * engine down used to end the process outright, so a run could find twenty
   * puzzles, print all twenty, exit zero, and save none of them.
   */
  console.log(`\nfound: ${found.length}   none: ${failed.length}`);

  if (!WRITE || !found.length) {
    if (!WRITE) console.log('\nDry run - nothing inserted. Re-run with --write to publish.');
    engine.quit();
    await db.end();
    return;
  }

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
  }
  await db.end();
  console.log(`\nPublished ${found.length} puzzle(s) as GridGrove.`);
  console.log('Then refresh the seed file:  node scripts/export-pool-puzzles.js --local');
})().catch((e) => { console.error(e.stack); process.exit(1); });
