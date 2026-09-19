/*
 * Is each puzzle's answer the only one, and the fastest?
 *
 *   node scripts/audit-puzzle-uniqueness.js --pool        # the daily pool
 *   node scripts/audit-puzzle-uniqueness.js --depth 2     # only mate-in-1 and -in-2
 *   node scripts/audit-puzzle-uniqueness.js --id 34
 *   node scripts/audit-puzzle-uniqueness.js --local
 *
 * Runs server/puzzle-uniqueness.js - the same analysis the site offers a creator
 * - over many puzzles at once, so the pool can be swept rather than checked one
 * at a time.
 *
 * Read-only.
 */
require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');
const FORCE_LOCAL = process.argv.includes('--local');
const POOL_ONLY = process.argv.includes('--pool');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const ONLY_ID = arg('id', null);
const MAX_DEPTH = arg('depth', 3);
const BUDGET = arg('budget', 400000);

if (!FORCE_LOCAL) {
  try {
    const { loadEnv } = require(path.join(ROOT, 'scripts/dev-db/_config'));
    const cfg = loadEnv();
    if (cfg.RDS_HOST && cfg.RDS_PASSWORD) {
      process.env.DB_HOST = cfg.TUNNEL_HOST;
      process.env.DB_PORT = String(cfg.TUNNEL_PORT);
      process.env.DB_USER = cfg.RDS_USER;
      process.env.DB_PASSWORD = cfg.RDS_PASSWORD;
      process.env.DB_NAME = cfg.RDS_DB;
      console.log('[uniqueness] production via tunnel\n');
    }
  } catch (_) { /* environment */ }
}

const db_pool = require(path.join(ROOT, 'configs/db'));
const { rulesForPuzzle } = require(path.join(ROOT, 'server/puzzle-snapshot'));
const { hydratePosition } = require(path.join(ROOT, 'server/puzzle-hydrate'));
const { analyseUniqueness, describeUniqueness } = require(path.join(ROOT, 'server/puzzle-uniqueness'));

const parse = (v, fb) => {
  if (v == null) return fb;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return fb; }
};

const startingRoster = async (rules) => {
  const parsed = parse(rules?.game?.pieces_string, null);
  if (!parsed || typeof parsed !== 'object') return [];
  return hydratePosition(rules, Object.entries(parsed).map(([k, v]) => {
    const [y, x] = String(k).split(',').map(Number);
    return { ...v, x: v.x ?? x, y: v.y ?? y };
  }));
};

(async () => {
  let where = 'p.solution_line IS NOT NULL AND p.is_draft = 0';
  if (POOL_ONLY) where += ' AND p.allow_daily = 1';
  if (ONLY_ID) where = `p.id = ${Number(ONLY_ID)}`;
  if (!ONLY_ID && MAX_DEPTH) where += ` AND p.solution_depth <= ${Number(MAX_DEPTH)}`;

  const [puzzles] = await db_pool.query(
    `SELECT p.*, gt.game_name FROM puzzles p JOIN game_types gt ON gt.id = p.game_type_id
      WHERE ${where} ORDER BY p.solution_depth, p.id`
  );
  console.log(`${puzzles.length} puzzle(s), searching to depth ${MAX_DEPTH},`
    + ` budget ${BUDGET.toLocaleString()} engine calls each\n`);

  const tally = {};
  for (const puzzle of puzzles) {
    let rules;
    try { rules = await rulesForPuzzle(db_pool, puzzle); } catch (_) { rules = null; }
    if (!rules) { console.log(`#${puzzle.id} rules would not load - skipped`); continue; }

    const hydrated = {
      position: await hydratePosition(rules, parse(puzzle.position, [])),
      initial_pieces: await startingRoster(rules),
      side_to_move: puzzle.side_to_move,
      setup_move: parse(puzzle.setup_move, null),
      game_type_id: puzzle.game_type_id,
      goal: puzzle.goal,
    };

    const result = await analyseUniqueness(rules, hydrated, { maxDepth: MAX_DEPTH, budget: BUDGET });
    tally[result.verdict] = (tally[result.verdict] || 0) + 1;

    const head = `#${String(puzzle.id).padStart(4)} d${puzzle.solution_depth || '?'}`
      + ` ${String(puzzle.title || '').slice(0, 22).padEnd(23)}`
      + ` ${String(puzzle.game_name).slice(0, 22).padEnd(23)}`;
    console.log(`${head} ${result.verdict.toUpperCase().padEnd(17)}`
      + ` ${result.engineCalls.toLocaleString().padStart(9)} calls`);
    const line = describeUniqueness(result, puzzle.solution_depth);
    if (result.verdict !== 'unique') console.log(`        ${line}`);
    if (result.solutionCount > 1) {
      console.log(`        solutions: ${result.solutions.slice(0, 6).join('  ')}`
        + `${result.solutions.length > 6 ? ` … +${result.solutions.length - 6}` : ''}`);
    }
  }

  console.log('\nsummary:');
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
