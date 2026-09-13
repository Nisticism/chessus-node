/*
 * Repair solution lines whose pieceId no longer matches any piece on the board.
 *
 *   node scripts/repair-puzzle-piece-ids.js --local
 *   node scripts/repair-puzzle-piece-ids.js --local --write
 *
 * THE BUG
 *
 * A move is applied by finding `pieces.find(p => p.id === move.pieceId)`, so the
 * id has to match. A puzzle stores its position WITHOUT ids, and hydratePosition
 * derives one from where each piece currently stands: `<piece_id>_<y>_<x>`.
 *
 * A solution mined from a real game, though, carries the id that piece had in
 * THAT game - derived from where it started, not where it now is. A queen that
 * began on (3,0) and ended up on (7,5) is `120_0_3` in the recorded move and
 * `120_5_7` on the puzzle board. Nothing matches, the move cannot be applied,
 * and the puzzle rejects its own answer: every solver is told they are wrong,
 * including when they play the only move that works.
 *
 * THE REPAIR
 *
 * Walk each line from the puzzle's own starting position and rewrite every ply's
 * pieceId to the id of whatever piece is actually standing on its from-square.
 * That is the piece the move always meant; only the label was stale.
 *
 * Generators are fixed separately so new puzzles carry ids that survive storage.
 */
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const FORCE_LOCAL = process.argv.includes('--local');

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

const RENAMES = {
  ratio_one_movement: 'ratio_movement_1', ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1', ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};
const OVERRIDES = [
  'ends_game_on_checkmate', 'ends_game_on_capture', 'manual_castling_partners',
  'castling_partner_left_key', 'castling_partner_right_key', 'castling_distance',
  'can_control_squares', 'can_en_passant', 'can_fire_over_allies',
  'can_fire_over_enemies', 'promotion_pieces_override', 'disable_promotion',
  'can_promote_to_checkmate', 'limit_promote_checkmate_to_original',
  'can_promote_to_capture', 'limit_promote_capture_to_original',
  'capture_points_gain', 'capture_points_loss', 'cannot_move_outside_zone',
  'cannot_be_captured', 'is_neutral', 'hit_points', 'attack_damage', 'hp_regen',
  'burn_damage', 'burn_duration', 'trample', 'trample_radius', 'ghostwalk',
  'die_on_capture', 'die_on_capture_grants_win', 'attack_radius',
];

const parse = (v, fb) => {
  if (v == null) return fb;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
};

(async () => {
  const { label, ...conn } = dsn;
  console.log(`[repair] ${label}${WRITE ? '  (WRITING)' : '  (dry run)'}\n`);
  const db = await mysql.createConnection({ ...conn, connectTimeout: 20000 });

  const [puzzles] = await db.query(
    'SELECT * FROM puzzles WHERE solution_line IS NOT NULL ORDER BY id'
  );
  const [allPlacements] = await db.query('SELECT * FROM game_type_pieces');
  const [allPieces] = await db.query('SELECT * FROM pieces');
  const [games] = await db.query('SELECT * FROM game_types');

  const pieceById = new Map(allPieces.map((p) => [Number(p.id), p]));
  const gameById = new Map(games.map((g) => [Number(g.id), g]));
  const placeByGame = new Map();
  for (const pl of allPlacements) {
    if (!placeByGame.has(pl.game_type_id)) placeByGame.set(pl.game_type_id, []);
    placeByGame.get(pl.game_type_id).push(pl);
  }

  const { buildGameState, applyPly, validatePuzzle } =
    require(path.join(ROOT, 'server/puzzle-validation'));

  const hydrate = (gameTypeId, list) => {
    const mine = placeByGame.get(gameTypeId) || [];
    const bySide = new Map();
    const byPiece = new Map();
    for (const r of mine) {
      bySide.set(`${r.piece_id}:${r.player_number}`, r);
      if (!byPiece.has(r.piece_id)) byPiece.set(r.piece_id, r);
    }
    const game = gameById.get(gameTypeId);
    const starting = new Set();
    for (const [k, v] of Object.entries(parse(game?.pieces_string, {}) || {})) {
      const [ky, kx] = String(k).split(',').map(Number);
      starting.add(`${Number(v.piece_id)}:${Number(v.player_id ?? 1)}:${v.y ?? ky},${v.x ?? kx}`);
    }
    return list.map((p) => {
      const pid = Number(p.piece_id);
      const player = Number(p.player_id ?? p.team ?? 1);
      const def = { ...(pieceById.get(pid) || {}) };
      for (const [from, to] of Object.entries(RENAMES)) {
        if (def[from] !== undefined) def[to] = def[from];
      }
      const j = bySide.get(`${pid}:${player}`) || byPiece.get(pid) || {};
      const home = starting.has(`${pid}:${player}:${Number(p.y)},${Number(p.x)}`);
      const out = {
        ...def,
        id: p.id || `${pid}_${p.y}_${p.x}`,
        piece_id: pid, x: Number(p.x), y: Number(p.y),
        player_id: player, team: player, player_number: player,
        hasMoved: p.hasMoved !== undefined ? !!p.hasMoved : !home,
        moveCount: p.moveCount !== undefined ? Number(p.moveCount) : (home ? 0 : 1),
      };
      for (const c of OVERRIDES) if (j[c] != null) out[c] = j[c];
      return out;
    });
  };

  let broken = 0;
  let repaired = 0;
  let stillBroken = 0;
  const fixes = [];

  for (const p of puzzles) {
    const game = gameById.get(Number(p.game_type_id));
    if (!game) continue;
    const position = hydrate(p.game_type_id, parse(p.position, []));
    const roster = hydrate(
      p.game_type_id,
      Object.entries(parse(game.pieces_string, {}) || {}).map(([k, v]) => {
        const [ky, kx] = String(k).split(',').map(Number);
        return { ...v, x: v.x ?? kx, y: v.y ?? ky, player_id: v.player_id ?? 1 };
      })
    );
    const line = parse(p.solution_line, []);
    if (!Array.isArray(line) || !line.length) continue;

    const base = {
      position, initial_pieces: roster,
      side_to_move: p.side_to_move,
      setup_move: parse(p.setup_move, null),
      game_type_id: p.game_type_id,
      goal: p.goal,
    };

    // Does the first ply's pieceId actually exist on the board?
    const ids = new Set(position.map((x) => x.id));
    const stale = line.some((ply) => ply.pieceId && !ids.has(ply.pieceId));
    if (!stale) continue;
    broken++;

    // Walk the line, naming each ply by whatever is on its from-square.
    const state = buildGameState({ ...base, position: JSON.parse(JSON.stringify(position)) }, game);
    const other = Number(p.side_to_move) === 1 ? 2 : 1;
    const fixed = [];
    let ok = true;
    for (let i = 0; i < line.length; i++) {
      state.currentTurn = i % 2 === 0 ? Number(p.side_to_move) : other;
      const ply = line[i];
      const mover = state.pieces.find(
        (x) => Number(x.x) === Number(ply.from.x) && Number(x.y) === Number(ply.from.y)
      );
      if (!mover) { ok = false; break; }
      const next = { ...ply, pieceId: mover.id };
      // eslint-disable-next-line no-await-in-loop
      const res = await applyPly(state, next, { autoPromote: true });
      if (!res.ok) { ok = false; break; }
      fixed.push(next);
    }

    if (!ok) {
      stillBroken++;
      console.log(`  #${String(p.id).padStart(4)} ${String(game.game_name).slice(0, 26).padEnd(27)} COULD NOT REPAIR`);
      continue;
    }

    // Confirm the repaired line validates.
    // eslint-disable-next-line no-await-in-loop
    const verdict = await validatePuzzle({ ...base, solution_line: fixed }, game);
    const good = verdict.status === 'valid' || verdict.intendedWorks;
    if (!good) {
      stillBroken++;
      console.log(`  #${String(p.id).padStart(4)} ${String(game.game_name).slice(0, 26).padEnd(27)} repaired but ${verdict.status}`);
      continue;
    }
    repaired++;
    fixes.push({ id: p.id, line: fixed, status: verdict.status, detail: verdict.detail });
    console.log(`  #${String(p.id).padStart(4)} ${String(game.game_name).slice(0, 26).padEnd(27)} ${verdict.status}`);
  }

  console.log(`\nchecked ${puzzles.length} | stale ids: ${broken} | repaired: ${repaired} | still broken: ${stillBroken}`);

  if (!WRITE) {
    console.log('\nDry run - nothing written. Re-run with --write to apply.');
    await db.end();
    return;
  }
  for (const f of fixes) {
    await db.query(
      `UPDATE puzzles
       SET solution_line = ?, validation_status = ?, validation_detail = ?, validated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(f.line), f.status, f.detail || null, f.id]
    );
  }
  await db.end();
  console.log(`\nRepaired ${fixes.length} puzzle(s).`);
})().catch((e) => { console.error(e.stack); process.exit(1); });
