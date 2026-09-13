/*
 * Write db/seeds/daily-pool-puzzles.json from the puzzles GridGrove owns here.
 *
 *   node scripts/export-pool-puzzles.js --local
 *
 * Separate from the generator on purpose. The generator only ever knows about
 * the puzzles IT just found, so writing the seed file from its own results
 * overwrote everything found on previous runs - which is exactly what happened:
 * a second run replaced a 29-puzzle seed with the 4 new ones.
 *
 * Exporting from the database instead makes the seed a faithful snapshot of what
 * is actually published here, whatever order it was built in, and makes the file
 * safe to regenerate at any time.
 *
 * Each entry carries the FINGERPRINT of the game it was verified in, which the
 * installer in server/migrations.js recomputes before attaching the puzzle to
 * anything - see server/game-fingerprint.js.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const { fingerprintGame } = require(path.join(ROOT, 'server/game-fingerprint'));

const FORCE_LOCAL = process.argv.includes('--local');
const OUT = path.join(ROOT, 'db', 'seeds', 'daily-pool-puzzles.json');

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
  } catch (_) { /* fall through to the environment */ }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'chessusnode',
    label: `${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'chessusnode'}`,
  };
}

const parse = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
};

(async () => {
  const { label, ...dsn } = connectionConfig();
  console.log(`[export] ${label}`);
  const db = await mysql.createConnection({ ...dsn, connectTimeout: 20000 });

  const [[owner]] = await db.query("SELECT id FROM users WHERE username = 'GridGrove' LIMIT 1");
  if (!owner) {
    console.error('[export] No GridGrove account here; nothing to export.');
    process.exit(1);
  }

  const [rows] = await db.query(
    `SELECT p.*, gt.game_name
     FROM puzzles p
     JOIN game_types gt ON gt.id = p.game_type_id
     WHERE p.creator_id = ?
     ORDER BY p.game_type_id`,
    [owner.id]
  );

  // Fingerprints need every game's placements and pieces; fetch once.
  const [placements] = await db.query('SELECT * FROM game_type_pieces');
  const [pieces] = await db.query('SELECT * FROM pieces');
  const [games] = await db.query('SELECT * FROM game_types');
  await db.end();

  const pieceById = new Map(pieces.map(p => [Number(p.id), p]));
  const gameById = new Map(games.map(g => [Number(g.id), g]));
  const placeByGame = new Map();
  for (const pl of placements) {
    if (!placeByGame.has(pl.game_type_id)) placeByGame.set(pl.game_type_id, []);
    placeByGame.get(pl.game_type_id).push(pl);
  }

  const puzzles = [];
  let skipped = 0;
  for (const r of rows) {
    const game = gameById.get(Number(r.game_type_id));
    if (!game) { skipped++; continue; }
    puzzles.push({
      game_type_id: r.game_type_id,
      game_name: r.game_name,
      game_fingerprint: fingerprintGame(game, placeByGame.get(r.game_type_id) || [], pieceById),
      title: r.title,
      description: r.description,
      position: parse(r.position, []),   // ids included; see toPlacement in the generators
      side_to_move: r.side_to_move,
      setup_move: parse(r.setup_move, null),
      goal: r.goal,
      goal_description: r.goal_description,
      solution_line: parse(r.solution_line, []),
      solution_depth: r.solution_depth,
      validation_detail: r.validation_detail,
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    note: 'Snapshot of the puzzles GridGrove owns, exported by '
      + 'scripts/export-pool-puzzles.js. Installed by the seedDailyPoolPuzzles '
      + 'step in server/migrations.js, which verifies game_fingerprint first.',
    puzzles,
  }, null, 1));

  const goals = {};
  for (const p of puzzles) goals[p.goal] = (goals[p.goal] || 0) + 1;
  console.log(`[export] ${puzzles.length} puzzle(s) across ${new Set(puzzles.map(p => p.game_type_id)).size} game(s)`);
  console.log(`[export] goals: ${Object.entries(goals).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (skipped) console.log(`[export] skipped ${skipped} whose game type is missing`);
  console.log(`[export] wrote ${path.relative(ROOT, OUT)}`);
})().catch(e => { console.error(e.stack); process.exit(1); });
