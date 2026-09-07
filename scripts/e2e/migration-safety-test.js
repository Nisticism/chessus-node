/*
 * Migrations must not eat user data.
 *
 * The bug this exists to catch: a data migration zeroed a piece's movement
 * whenever its `*_movement_style` gate flag was 0. That was correct when the
 * flags were gates. The wizard later moved to a value-only model and stopped
 * setting them, so every piece saved afterwards matched the migration's WHERE
 * clause - and because it ran on EVERY startup, each deploy silently wiped the
 * movement of every piece created or edited since the last one.
 *
 * Nothing caught it because each half looked fine on its own: saving a piece
 * worked, and the migration did what it said. The failure only appears when you
 * do both, in order, which is what this does.
 *
 *   node scripts/e2e/migration-safety-test.js
 *
 * Writes and then deletes its own rows; it touches nothing else.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db = require('../../configs/db');
const { runMigrations } = require('../../server/migrations');

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const DIRS = ['up_left', 'up', 'up_right', 'right', 'down_right', 'down', 'down_left', 'left'];

/*
 * Insert directly rather than through the HTTP route: this is about what
 * migrations do to a row that is already in the table, and going through the
 * API would need a running server and two uploaded images to say the same
 * thing. The shape is what matters - movement set, style flags 0, which is
 * exactly what the current wizard produces.
 */
async function insertPiece(name, columns) {
  const cols = Object.keys(columns);
  const [res] = await db.query(
    `INSERT INTO pieces (piece_name, creator_id, ${cols.join(', ')})
     VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
    [name, null, ...cols.map((c) => columns[c])]
  );
  return res.insertId;
}

const readPiece = async (id) => (await db.query('SELECT * FROM pieces WHERE id = ?', [id]))[0][0];

async function main() {
  const made = [];
  try {
    // 1. A piece as the current wizard saves one: movement, no style flags.
    const directional = await insertPiece('MIGRATION SAFETY directional', {
      directional_movement_style: 0,
      up_movement: 99, down_movement: 99, left_movement: 99, right_movement: 99,
    });
    made.push(directional);

    // 2. Same for the other two movement kinds.
    const ratio = await insertPiece('MIGRATION SAFETY ratio', {
      ratio_movement_style: 0, ratio_one_movement: 1, ratio_two_movement: 2,
    });
    made.push(ratio);

    const step = await insertPiece('MIGRATION SAFETY step', {
      step_by_step_movement_style: 0, step_by_step_movement_value: 3,
    });
    made.push(step);

    // 3. A deploy.
    await runMigrations();

    const afterDir = await readPiece(directional);
    const dirsum = DIRS.reduce((s, d) => s + (afterDir[`${d}_movement`] || 0), 0);
    check('directional movement survives a deploy', dirsum === 396,
      `expected 4x99=396, got ${dirsum} (${DIRS.map((d) => `${d}=${afterDir[`${d}_movement`]}`).join(' ')})`);

    const afterRatio = await readPiece(ratio);
    check('ratio movement survives a deploy',
      afterRatio.ratio_one_movement === 1 && afterRatio.ratio_two_movement === 2,
      `got ${afterRatio.ratio_one_movement}/${afterRatio.ratio_two_movement}`);

    const afterStep = await readPiece(step);
    check('step-by-step movement survives a deploy',
      afterStep.step_by_step_movement_value === 3,
      `got ${afterStep.step_by_step_movement_value}`);

    // 4. Running them twice must be no different from once. A data migration
    //    that is not idempotent is the whole failure mode here.
    await runMigrations();
    const twice = await readPiece(directional);
    const dirsum2 = DIRS.reduce((s, d) => s + (twice[`${d}_movement`] || 0), 0);
    check('and survives a second deploy', dirsum2 === 396, `got ${dirsum2}`);

    // 5. The ledger stops one-time data fixes from running again.
    const [[ledger]] = await db.query(
      `SELECT COUNT(*) AS n FROM applied_data_migrations WHERE migration_key = 'null-legacy-available-for-moves'`);
    check('one-time data migrations are recorded so they cannot repeat', ledger.n === 1, `${ledger.n} ledger row(s)`);
  } finally {
    for (const id of made) await db.query('DELETE FROM pieces WHERE id = ?', [id]);
  }

  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail || ''}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  await db.end();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (e) => { console.error(e); try { await db.end(); } catch (_) {} process.exit(1); });
