/*
 * Sweep the game types and decide which ones the daily puzzle may draw from.
 *
 *   node scripts/puzzle-pool-sweep.js              # report only, changes nothing
 *   node scripts/puzzle-pool-sweep.js --write      # write the puzzle_pool table
 *   node scripts/puzzle-pool-sweep.js --local      # use the local DB
 *
 * Against production, start the tunnel first (node scripts/dev-db/tunnel.js);
 * the script reads scripts/dev-db/.db-tunnel.env when it is present and falls
 * back to the ordinary DB_* environment variables otherwise.
 *
 * A game is in the pool when all of these hold:
 *
 *   1. Fairy-Stockfish can play it. Not because the engine is needed to SOLVE a
 *      puzzle - the site's own move engine does that - but because it is a good
 *      proxy for "a game whose rules a puzzle can express", and because it is
 *      the one filter already written and already enforced at the lobby.
 *   2. It does not use mate_condition_requires_all, which the puzzle validator
 *      cannot yet judge. Excluded deliberately, to be revisited.
 *   3. Its board is no further from square than 3:2, so the daily puzzle can be
 *      drawn on the home page without the section changing shape around it.
 *   4. It has at least three different piece types, on each side. A king and a
 *      row of pawns has no "find the move" in it.
 *   5. It is not a near-duplicate of a game already in the pool. A daily puzzle
 *      that rotates through four builds of the same chess is not a rotation.
 *   6. It is not in MANUAL_EXCLUSIONS above.
 *
 * ON DUPLICATES. Two games sharing the standard chess layout is NOT evidence
 * they are the same game - Antichess, Fog of War and Veto Chess all start from
 * it. So the comparison looks at the board AND the rules, and reports which
 * rules differ. Only a pair that matches on the board and differs in nothing
 * substantive is collapsed automatically; anything less certain is left as
 * `review` for a person to decide.
 *
 * HUMAN DECISIONS ARE NEVER OVERWRITTEN. A row whose status is `included` or
 * `excluded` was set by a person, and re-running this only refreshes the
 * auto_* and review rows around it.
 */
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const compat = require(path.join(ROOT, 'server/ai/fairy-stockfish-compat'));
const translator = require(path.join(ROOT, 'server/ai/fairy-stockfish-translator'));

const WRITE = process.argv.includes('--write');
// Force the ordinary DB_* environment even when the tunnel config is present.
const FORCE_LOCAL = process.argv.includes('--local');

// Widest the board may be relative to its height (or the other way round) and
// still sit comfortably in half the home page. 3:2.
/*
 * Fairy-Stockfish's hard board limits, measured rather than assumed: feeding
 * the engine the same variant at descending sizes, 12x10 loads and 12x12 does
 * not. They are compile-time constants in the WASM build, so no INI can get
 * around them and no puzzle can be generated for a bigger board.
 */
const FS_MAX_FILES = 12;
const FS_MAX_RANKS = 10;

const MAX_BOARD_ASPECT = 1.5;

// Distinct piece types a game needs, overall AND for each player.
const MIN_PIECE_TYPES = 3;

/*
 * Decisions taken by hand, kept here rather than typed into the database as
 * one-off SQL so they survive a rebuild and can be read alongside the rules that
 * produced them. The sweep writes these as `excluded` - the human status - so a
 * later run never quietly undoes them.
 */
const MANUAL_EXCLUSIONS = {
  2:   'Test fixture, not a real game (two pieces).',
  348: 'Duplicate of #17 Chess; differs only in draw dials.',
  490: 'Third build of Veto Chess; #481 and #483 already cover reactive and preemptive.',
  205: 'Chess with Different Armies: keeping #201 only.',
  215: 'Chess with Different Armies: keeping #201 only.',
  216: 'Chess with Different Armies: keeping #201 only.',
  219: 'Chess with Different Armies: keeping #201 only.',
  221: 'Chess with Different Armies: keeping #201 only.',
};

/*
 * Connection details: the dev tunnel config when it exists (that is how this is
 * run against production), otherwise the ordinary server environment.
 */
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
  } catch (_) { /* no tunnel config - fall through to the environment */ }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'chessusnode',
    label: `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'chessusnode'}`,
  };
}

const T = v => v === true || v === 1 || v === '1';

// Behaviour columns lifted from the uniqueness endpoint in server/index.js so the
// two agree on what "the same piece" means.
const PIECE_COLS = ['repeating_movement', 'max_directional_movement_iterations', 'min_directional_movement_iterations', 'up_left_movement', 'up_movement', 'up_right_movement', 'right_movement', 'down_right_movement', 'down_movement', 'down_left_movement', 'left_movement', 'ratio_one_movement', 'ratio_two_movement', 'repeating_ratio', 'max_ratio_iterations', 'min_ratio_iterations', 'step_by_step_movement_value', 'can_hop_over_allies', 'can_hop_over_enemies', 'hop_stop_at_occupied', 'can_capture_enemy_via_range', 'can_capture_ally_via_range', 'can_capture_enemy_on_move', 'can_capture_ally_on_range', 'can_attack_on_iteration', 'up_left_attack_range', 'up_attack_range', 'up_right_attack_range', 'right_attack_range', 'down_right_attack_range', 'down_attack_range', 'down_left_attack_range', 'left_attack_range', 'ratio_one_attack_range', 'ratio_two_attack_range', 'step_by_step_attack_style', 'step_by_step_attack_value', 'special_scenario_moves', 'special_scenario_captures', 'has_checkmate_rule', 'has_check_rule', 'has_lose_on_capture_rule', 'can_castle', 'can_promote', 'piece_width', 'piece_height', 'can_en_passant', 'can_capture_allies', 'cannot_be_captured', 'promotion_pieces_ids', 'up_left_capture', 'up_capture', 'up_right_capture', 'right_capture', 'down_right_capture', 'down_capture', 'down_left_capture', 'left_capture', 'custom_movement_squares', 'custom_attack_squares'];
const JUNC_COLS = ['ends_game_on_checkmate', 'ends_game_on_capture', 'castling_distance', 'can_control_squares', 'hit_points', 'attack_damage', 'cannot_be_captured', 'trample', 'ghostwalk', 'die_on_capture', 'attack_radius', 'cannot_move_outside_zone', 'is_neutral', 'disable_promotion', 'promotion_pieces_override'];

/*
 * Two games sharing the standard chess layout is NOT evidence they are the same
 * game - Antichess, Fog of War and Veto Chess all start from it. What separates
 * them is the rule set, so the comparison reports WHICH rules differ and weighs
 * substantive differences (the ones a player would name when describing the
 * game) apart from dials nobody would.
 *
 * STARTING POSITION IS NOT ONE OF THE SUBSTANTIVE ONES. Two games that differ
 * only in where the pieces begin are the same game to a puzzle: a puzzle is a
 * mid-game position, and the same position can be reached from either. Treating
 * the opening as a difference kept several pairs apart that a solver could not
 * tell apart once the pieces had moved.
 */
const RULE_SUBSTANTIVE = ['mate_condition', 'capture_condition', 'value_condition', 'squares_condition', 'hill_condition', 'piece_count_condition', 'points_to_win', 'no_moves_condition', 'lose_all_pieces_condition', 'stalemate_win_condition', 'forced_capture_condition', 'promotion_condition', 'optional_condition', 'capture_condition_requires_all', 'actions_per_turn', 'simultaneous_turns', 'fog_of_war', 'permanent_fog_reveal', 'hide_enemy_pieces', 'veto_enabled', 'veto_style', 'start_repositions', 'board_width', 'board_height', 'player_count', 'promotion_squares_string', 'special_squares_string', 'range_squares_string', 'control_squares_string'];
const RULE_MINOR = ['default_starting_mode', 'randomized_starting_positions', 'stalemate_draw_condition', 'draw_move_limit', 'repetition_draw_count', 'illegal_move_limit', 'veto_per_turn_limit', 'veto_per_game_limit', 'veto_disallow_placement', 'veto_disallow_promotion', 'draw_equal_points_at_turn', 'draw_equal_points_consecutive', 'starting_points_p1', 'starting_points_p2'];
const RULE_COLS = [...RULE_SUBSTANTIVE, ...RULE_MINOR];

const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const normName = (s) => String(s || '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\b(v?\d+(\.\d+)?|test|copy|new|old|final|remake|remix|edition|ed)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const normPiece = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/*
 * Rule values arrive in several spellings of the same thing: '' / null / '{}'
 * for "not set", and {"allowedModes":["none"]} for the same no-randomisation
 * that an empty column means. Compared raw, those spellings invent differences
 * between games that play identically, which is exactly the noise this pass is
 * meant to remove.
 */
const canon = (v) => {
  if (v == null) return '';
  const s = String(v).trim();
  if (s === '' || s === 'null' || s === '{}' || s === '[]' || s === '0') return '';
  if (s === '1') return '1';
  if (s[0] !== '{' && s[0] !== '[') return s;
  let parsed;
  try { parsed = JSON.parse(s); } catch (_) { return s; }
  const sortDeep = (x) => {
    if (Array.isArray(x)) return x.map(sortDeep);
    if (x && typeof x === 'object') {
      const out = {};
      for (const k of Object.keys(x).sort()) {
        // "applies to everyone" and "unspecified" are the same rule.
        if (k === 'appliesToPlayer' && (x[k] === 'all' || x[k] == null)) continue;
        out[k] = sortDeep(x[k]);
      }
      return out;
    }
    return x;
  };
  const c = sortDeep(parsed);
  // {"allowedModes":["none"]} is how the wizard writes "no randomisation".
  if (c && c.allowedModes && Array.isArray(c.allowedModes)
      && c.allowedModes.length === 1 && c.allowedModes[0] === 'none') return '';
  const out = JSON.stringify(c);
  return out === '{}' || out === '[]' ? '' : out;
};

(async () => {
  // `label` is ours, for the banner below; mysql2 warns about options it does
  // not recognise, so it is split off rather than passed through.
  const { label, ...dsn } = connectionConfig();
  console.log(`[pool-sweep] ${label}${WRITE ? '  (WRITING)' : '  (dry run)'}\n`);
  const conn = await mysql.createConnection({ ...dsn, connectTimeout: 20000 });
  const [games] = await conn.query('SELECT * FROM game_types');
  const [placements] = await conn.query('SELECT * FROM game_type_pieces');
  const [pieces] = await conn.query('SELECT * FROM pieces');
  const [plays] = await conn.query('SELECT game_type_id, COUNT(*) n FROM games GROUP BY game_type_id');
  let votes = [];
  try { [votes] = await conn.query('SELECT game_type_id, COUNT(*) n FROM game_type_upvotes GROUP BY game_type_id'); } catch (_) { votes = []; }
  await conn.end();

  const playBy = new Map(plays.map(r => [r.game_type_id, r.n]));
  const voteBy = new Map(votes.map(r => [r.game_type_id, r.n]));
  const pieceById = new Map(pieces.map(p => [p.id, p]));
  const placeBy = new Map();
  for (const pl of placements) {
    if (!placeBy.has(pl.game_type_id)) placeBy.set(pl.game_type_id, []);
    placeBy.get(pl.game_type_id).push(pl);
  }

  // ---- stage 1: the eligible set -------------------------------------------
  const eligible = [];
  const excluded = [];   // { id, name, reason }
  for (const g of games) {
    const pls = placeBy.get(g.id) || [];
    if (T(g.is_draft)) { excluded.push({ id: g.id, name: g.game_name, reason: 'draft' }); continue; }
    if (!pls.length) { excluded.push({ id: g.id, name: g.game_name, reason: 'no_placements' }); continue; }

    const defs = [...new Set(pls.map(p => p.piece_id).filter(v => v != null))].map(id => pieceById.get(id)).filter(Boolean);
    const r = compat.checkCompatibility(g, defs, pls);
    if (r.reasons.some(x => !x.safeToIgnore)) {
      excluded.push({ id: g.id, name: g.game_name, reason: 'fairy_stockfish' });
      continue;
    }

    /*
     * checkCompatibility is a heuristic over the rule columns. It is fast and it
     * is usually right, but it does not TRY the translation - so a game whose
     * rules are all fine can still contain one piece with no Betza equivalent,
     * pass the check, sit in the pool, and never be generatable.
     *
     * Three such games were doing exactly that, showing up in the "no puzzle
     * yet" list forever:
     *
     *   #173  12x12, past what the engine can represent at all
     *   #412  AltKing - "the king that never moves", so no moves to express
     *   #480  Power Knight - a capture ratio with no movement ratio
     *
     * So the translation is actually attempted here. It costs one call per game
     * and turns "we think this will work" into "this does".
     */
    const bw = Number(g.board_width) || 0;
    const bh = Number(g.board_height) || 0;
    if (bw > FS_MAX_FILES || bh > FS_MAX_RANKS) {
      excluded.push({
        id: g.id, name: g.game_name, reason: 'board_too_big_for_engine',
        note: `${bw}x${bh} exceeds Fairy-Stockfish's ${FS_MAX_FILES}x${FS_MAX_RANKS} limit`,
      });
      continue;
    }

    const charMap = translator.buildCharMap(defs, pls);
    const built = charMap ? translator.buildVariantINI(g, defs, pls, charMap) : null;
    if (!built) {
      /*
       * Name the piece that did it. "Untranslatable" on its own sends whoever
       * reads this back to the database to work out which of six pieces was the
       * problem, and the answer is already here.
       */
      const blockers = defs
        .filter((d) => {
          try { return !translator.pieceToBetza(d); } catch (_) { return true; }
        })
        .map((d) => d.piece_name)
        .filter(Boolean);
      excluded.push({
        id: g.id, name: g.game_name, reason: 'fairy_stockfish_untranslatable',
        note: blockers.length
          ? `no Betza equivalent for: ${blockers.join(', ')}`
          : 'the variant definition could not be built',
      });
      continue;
    }
    // Excluded for now: the validator cannot yet judge "every royal must be
    // mated", so a mate puzzle in one of these would be scored wrongly.
    if (T(g.mate_condition_requires_all)) {
      excluded.push({ id: g.id, name: g.game_name, reason: 'mate_requires_all' });
      continue;
    }
    /*
     * The daily puzzle is drawn on the home page next to a block of text, and a
     * board far from square either shrinks to nothing to fit the column or
     * forces the whole section to a shape the rest of the page does not use.
     * Anything past 3:2 in either direction is left out rather than made to fit
     * badly - it can still carry puzzles of its own, it just is not the one to
     * meet somebody with.
     */
    const w = Number(g.board_width) || 0;
    const h = Number(g.board_height) || 0;
    if (!w || !h || Math.max(w, h) / Math.min(w, h) > MAX_BOARD_ASPECT) {
      excluded.push({ id: g.id, name: g.game_name, reason: 'board_aspect' });
      continue;
    }
    /*
     * A game needs enough DIFFERENT pieces for a puzzle to be interesting.
     *
     * With a king and a pawn there is no "find the move" to find - the position
     * either works or it does not, and there is nothing to spot. Requiring the
     * variety on EACH SIDE as well as overall is the part that matters: a game
     * where one player has five piece types and the other has a single king is
     * not a puzzle game either, it is a study.
     *
     * This is a proxy, not a truth. It is cheap, it is right far more often than
     * it is wrong, and a game it excludes can still be hand-included.
     */
    const kinds = (rows) => new Set(rows.map(x => x.piece_id).filter(v => v != null)).size;
    const perSide = [1, 2].map(side => kinds(pls.filter(x => Number(x.player_number) === side)));
    if (kinds(pls) < MIN_PIECE_TYPES || perSide.some(n => n < MIN_PIECE_TYPES)) {
      excluded.push({
        id: g.id, name: g.game_name, reason: 'too_few_piece_types',
        detail: `${kinds(pls)} types (p1 ${perSide[0]}, p2 ${perSide[1]})`,
      });
      continue;
    }
    eligible.push({ g, pls });
  }

  // ---- stage 2: signatures --------------------------------------------------
  const rows = eligible.map(({ g, pls }) => {
    const cells = pls.map((pl) => {
      const d = pieceById.get(pl.piece_id) || {};
      const behave = PIECE_COLS.map(c => String(d[c] ?? '')).join('|')
        + '#' + JUNC_COLS.map(c => String(pl[c] ?? '')).join('|');
      return {
        key: `${pl.player_number}:${pl.x},${pl.y}`,
        name: normPiece(d.piece_name),
        behave: h(behave),
      };
    }).sort((a, b) => (a.key < b.key ? -1 : 1));

    const roster = {};
    for (const c of cells) roster[c.name] = (roster[c.name] || 0) + 1;

    return {
      id: g.id,
      name: g.game_name,
      nameNorm: normName(g.game_name),
      board: `${g.board_width}x${g.board_height}`,
      pieces: pls.length,
      plays: playBy.get(g.id) || 0,
      votes: voteBy.get(g.id) || 0,
      created: g.created_at,
      layoutSig: h(cells.map(c => `${c.key}=${c.name}`).join(';')),
      behaveSig: h(cells.map(c => `${c.key}=${c.behave}`).join(';')),
      rosterSig: h(Object.keys(roster).sort().map(k => `${k}x${roster[k]}`).join(';')),
      rosterKeys: Object.keys(roster).sort(),
      ruleSig: h(RULE_COLS.map(c => canon(g[c])).join('|')),
      rules: Object.fromEntries(RULE_COLS.map(c => [c, canon(g[c])])),
    };
  });

  // ---- stage 3: pairwise matches -------------------------------------------
  const jaccard = (a, b) => {
    const A = new Set(a), B = new Set(b);
    let inter = 0;
    for (const k of A) if (B.has(k)) inter++;
    return inter / (A.size + B.size - inter || 1);
  };

  const edges = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.board !== b.board) continue;

      const bigDelta = RULE_SUBSTANTIVE.filter(c => a.rules[c] !== b.rules[c]);
      const smallDelta = RULE_MINOR.filter(c => a.rules[c] !== b.rules[c]);
      const samePieces = a.behaveSig === b.behaveSig;   // identical behaviour, square for square
      const sameNames = a.layoutSig === b.layoutSig;    // identical names, square for square
      const sameName = a.nameNorm && a.nameNorm === b.nameNorm;
      const jr = jaccard(a.rosterKeys, b.rosterKeys);

      let kind = null, confidence = 0;
      if (samePieces || sameNames) {
        // The board is the same. Everything now turns on the rules.
        const how = samePieces ? 'pieces' : 'names';
        if (!bigDelta.length && !smallDelta.length) {
          kind = `identical (${how} + rules)`; confidence = 100;
        } else if (!bigDelta.length) {
          // Differs only in dials nobody would name when describing the game.
          kind = `same game, minor dials (${how})`; confidence = 90;
        } else if (bigDelta.length === 1) {
          kind = `same board, 1 rule differs (${how})`; confidence = 55;
        } else if (bigDelta.length <= 3) {
          kind = `same board, ${bigDelta.length} rules differ (${how})`; confidence = 35;
        }
        // 4+ substantive differences: a genuinely different game. Not an edge.
      } else if (sameName && jr >= 0.6) {
        kind = 'same name, similar roster'; confidence = 75;
      } else if (a.rosterSig === b.rosterSig && !bigDelta.length) {
        kind = 'same roster, different setup'; confidence = 60;
      } else if (sameName) {
        kind = 'same name only'; confidence = 40;
      } else if (jr >= 0.85 && !bigDelta.length && a.pieces === b.pieces) {
        kind = 'near-identical roster'; confidence = 50;
      }

      if (kind) edges.push({ a: a.id, b: b.id, kind, confidence, bigDelta, smallDelta });
    }
  }

  // ---- stage 4: cluster on high-confidence edges only ----------------------
  const AUTO = 90;
  const parent = new Map(rows.map(r => [r.id, r.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent.set(a, b); };
  const edgeKind = new Map();
  for (const e of edges) {
    if (e.confidence < AUTO) continue;
    union(e.a, e.b);
    edgeKind.set(`${e.a}|${e.b}`, e.kind);
    edgeKind.set(`${e.b}|${e.a}`, e.kind);
  }

  const byId = new Map(rows.map(r => [r.id, r]));
  const clusters = new Map();
  for (const r of rows) {
    const root = find(r.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(r);
  }

  // Survivor: most played, then most upvoted, then the original (earliest).
  const pick = (members) => [...members].sort((x, y) =>
    y.plays - x.plays || y.votes - x.votes || new Date(x.created) - new Date(y.created) || x.id - y.id)[0];

  const pool = [], autoDropped = [];
  for (const members of clusters.values()) {
    const keep = pick(members);
    pool.push(keep);
    for (const m of members) {
      if (m.id === keep.id) continue;
      autoDropped.push({
        ...m,
        supersededBy: keep.id,
        supersededByName: keep.name,
        why: edgeKind.get(`${m.id}|${keep.id}`) || 'transitive',
      });
    }
  }

  const inPool = new Set(pool.filter(r => !MANUAL_EXCLUSIONS[r.id]).map(r => r.id));
  const review = edges
    .filter(e => e.confidence < AUTO && inPool.has(e.a) && inPool.has(e.b))
    .sort((x, y) => y.confidence - x.confidence)
    .map(e => ({
      ...e,
      aName: byId.get(e.a).name, bName: byId.get(e.b).name,
      aPlays: byId.get(e.a).plays, bPlays: byId.get(e.b).plays,
      aPieces: byId.get(e.a).pieces, bPieces: byId.get(e.b).pieces,
      board: byId.get(e.a).board,
    }));

  pool.sort((a, b) => b.plays - a.plays || a.id - b.id);
  // ---- stage 5: report ------------------------------------------------------
  const byReason = {};
  for (const e of excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;

  console.log(`game types:                 ${String(games.length).padStart(4)}`);
  for (const [k, v] of Object.entries(byReason)) {
    console.log(`  excluded, ${k.padEnd(18)} ${String(v).padStart(4)}`);
  }
  console.log(`  eligible before dedupe:   ${String(rows.length).padStart(4)}`);
  console.log(`  dropped as duplicates:    ${String(autoDropped.length).padStart(4)}`);
  const manualCount = pool.filter(r => MANUAL_EXCLUSIONS[r.id]).length;
  console.log(`  excluded by hand:         ${String(manualCount).padStart(4)}`);
  console.log(`CURATED POOL:               ${String(pool.length - manualCount).padStart(4)}`);
  console.log(`awaiting a human decision:  ${String(review.length).padStart(4)} pair(s)\n`);

  if (autoDropped.length) {
    console.log('--- dropped as duplicates ---');
    for (const d of autoDropped) {
      console.log(`  #${String(d.id).padStart(3)} ${String(d.name).slice(0, 32).padEnd(33)} ${String(d.plays).padStart(3)} plays  ->  kept #${d.supersededBy} ${d.supersededByName}   [${d.why}]`);
    }
    console.log('');
  }

  if (review.length) {
    console.log('--- too close to call: decide these by hand ---');
    for (const r of review) {
      console.log(`  ${String(r.confidence).padStart(3)}%  ${r.kind}`);
      console.log(`        #${r.a} ${String(r.aName).slice(0, 36)} (${r.aPieces} pieces, ${r.aPlays} plays)`);
      console.log(`        #${r.b} ${String(r.bName).slice(0, 36)} (${r.bPieces} pieces, ${r.bPlays} plays)   [${r.board}]`);
      if (r.bigDelta && r.bigDelta.length) console.log(`        differs in: ${r.bigDelta.join(', ')}`);
      else if (r.smallDelta && r.smallDelta.length) console.log(`        differs only in: ${r.smallDelta.join(', ')}`);
    }
    console.log('');
  }

  const manualInPool = pool.filter(r => MANUAL_EXCLUSIONS[r.id]);
  if (manualInPool.length) {
    console.log('--- excluded by hand (see MANUAL_EXCLUSIONS) ---');
    for (const r of manualInPool) {
      console.log(`  #${String(r.id).padStart(3)} ${String(r.name).slice(0, 36).padEnd(37)} ${MANUAL_EXCLUSIONS[r.id]}`);
    }
    console.log('');
  }

  if (!WRITE) {
    console.log('Dry run - nothing written. Re-run with --write to update puzzle_pool.');
    console.log('To settle a pair by hand afterwards:');
    console.log("  UPDATE puzzle_pool SET status='excluded', exclusion_reason='duplicate', duplicate_of=<id>, note='...' WHERE game_type_id=<id>;");
    console.log("  UPDATE puzzle_pool SET status='included', note='...' WHERE game_type_id=<id>;");
    return;
  }

  // ---- stage 6: write ------------------------------------------------------
  /*
   * Human decisions win. Only the rows this sweep owns - auto_included,
   * auto_excluded, review, and games with no row yet - are rewritten, so a
   * hand-picked include or exclude survives every future run.
   */
  const write = await mysql.createConnection({ ...dsn, connectTimeout: 20000 });
  const [existing] = await write.query('SELECT game_type_id, status FROM puzzle_pool');
  const humanDecided = new Set(
    existing.filter(r => r.status === 'included' || r.status === 'excluded').map(r => r.game_type_id)
  );

  const reviewIds = new Set();
  for (const r of review) { reviewIds.add(r.a); reviewIds.add(r.b); }

  /*
   * Only games that exist HERE. The manual list and the sweep are both keyed on
   * production ids, and a local database is a partial pull - writing a pool row
   * for a game type that is not present trips the foreign key and takes the
   * whole run down with it.
   */
  const known = new Set(games.map(g => g.id));

  const upserts = [];
  const add = (gameTypeId, status, extra = {}) => {
    if (!known.has(gameTypeId)) return;
    if (humanDecided.has(gameTypeId)) return;
    if (MANUAL_EXCLUSIONS[gameTypeId]) return;   // written separately, below
    upserts.push([
      gameTypeId, status,
      extra.exclusion_reason ?? null,
      extra.duplicate_of ?? null,
      extra.similarity_score ?? null,
      extra.similarity_kind ?? null,
      /*
       * Only the auto rows reach here - add() has already returned for anything
       * a human ruled on - so writing the note cannot clobber somebody's
       * reasoning. VARCHAR(500), so a game with a lot of odd pieces is trimmed
       * rather than throwing.
       */
      extra.note ? String(extra.note).slice(0, 500) : null,
    ]);
  };

  for (const e of excluded) add(e.id, 'auto_excluded', { exclusion_reason: e.reason, note: e.note });
  for (const d of autoDropped) {
    add(d.id, 'auto_excluded', {
      exclusion_reason: 'duplicate',
      duplicate_of: d.supersededBy,
      similarity_score: 100,
      similarity_kind: d.why,
    });
  }
  for (const r of pool) {
    /*
     * A game caught in an unresolved pair waits out of the rotation until
     * somebody rules on it. A smaller pool is a better daily puzzle than one
     * that shows the same game twice in a week under two names.
     */
    if (reviewIds.has(r.id) && !MANUAL_EXCLUSIONS[r.id]) {
      const pair = review.find(x => x.a === r.id || x.b === r.id);
      add(r.id, 'review', {
        similarity_score: pair?.confidence ?? null,
        similarity_kind: pair?.kind ?? null,
        duplicate_of: pair ? (pair.a === r.id ? pair.b : pair.a) : null,
      });
    } else {
      add(r.id, 'auto_included');
    }
  }

  if (upserts.length) {
    await write.query(
      `INSERT INTO puzzle_pool
         (game_type_id, status, exclusion_reason, duplicate_of, similarity_score, similarity_kind, note, swept_at)
       VALUES ${upserts.map(() => '(?,?,?,?,?,?,?,NOW())').join(',')}
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         exclusion_reason = VALUES(exclusion_reason),
         duplicate_of = VALUES(duplicate_of),
         similarity_score = VALUES(similarity_score),
         similarity_kind = VALUES(similarity_kind),
         note = VALUES(note),
         swept_at = NOW()`,
      upserts.flat()
    );
  }

  /*
   * The hand-picked exclusions. Written as `excluded` rather than
   * `auto_excluded` precisely so the next sweep treats them as somebody's
   * decision and leaves them alone.
   */
  const manual = Object.entries(MANUAL_EXCLUSIONS).filter(([id]) => known.has(Number(id)));
  if (manual.length) {
    await write.query(
      `INSERT INTO puzzle_pool (game_type_id, status, exclusion_reason, note, decided_at, swept_at)
       VALUES ${manual.map(() => "(?,'excluded','manual',?,NOW(),NOW())").join(',')}
       ON DUPLICATE KEY UPDATE
         status = 'excluded',
         exclusion_reason = 'manual',
         note = VALUES(note),
         decided_at = COALESCE(decided_at, NOW()),
         swept_at = NOW()`,
      manual.flatMap(([id, note]) => [Number(id), note])
    );
  }

  const [[counts]] = await write.query(
    `SELECT
       COUNT(CASE WHEN status IN ('auto_included','included') THEN 1 END) AS in_pool,
       COUNT(CASE WHEN status = 'review' THEN 1 END) AS awaiting,
       COUNT(CASE WHEN status IN ('auto_excluded','excluded') THEN 1 END) AS excluded_count
     FROM puzzle_pool`
  );
  await write.end();
  console.log(`Written. puzzle_pool now: ${counts.in_pool} in the pool, ${counts.awaiting} awaiting a decision, ${counts.excluded_count} out.`);
  console.log(`(${humanDecided.size} hand-picked row(s) left untouched.)`);
})().catch(e => { console.error(e.stack); process.exit(1); });
