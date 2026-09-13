#!/usr/bin/env node
/*
 * Give every published puzzle a frozen copy of the rules it was built under.
 *
 * Puzzles written before snapshots existed still point at a live game_types
 * row, so a creator editing that game silently changes what those puzzles mean.
 * This closes that window for the puzzles already out there.
 *
 * WHAT IT CAN AND CANNOT DO
 *
 * It freezes the game as it stands NOW, which is the best available answer and
 * not the true one: if a game was already edited since its puzzle was made, the
 * snapshot captures the edited version. So each puzzle is re-validated against
 * what is about to be frozen, and one that no longer works is reported rather
 * than quietly sealed in a state where it can never be right.
 *
 * From here on new puzzles snapshot at publish and this is only needed for the
 * one-off backfill.
 *
 * Usage:
 *   node scripts/backfill-puzzle-snapshots.js              # report only
 *   node scripts/backfill-puzzle-snapshots.js --write
 *   node scripts/backfill-puzzle-snapshots.js --write --force   # include ones
 *                                                               # that fail
 */

require('dotenv').config();

const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const { ensureSnapshot, readLive } = require(path.join(ROOT, 'server/puzzle-snapshot'));
/*
 * The SAME hydration the routes use, not a copy of it.
 *
 * A simplified copy was written here first and immediately declared 20 good
 * puzzles broken, because it skipped the engine field renames and the
 * null-means-not-overridden rule for junction columns. Sharing the definition
 * is the only way a backfill's verdict means the same thing as a solver's.
 */
const { hydratePosition } = require(path.join(ROOT, 'server/puzzle-hydrate'));

const WRITE = process.argv.includes('--write');
// Snapshot even a puzzle that no longer validates. Off by default: sealing a
// broken puzzle makes it permanently broken instead of merely currently broken.
const FORCE = process.argv.includes('--force');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'chessusnode',
    connectTimeout: 20000,
  });

  console.log(`[backfill] ${WRITE ? 'WRITING' : 'dry run'}${FORCE ? '  (--force)' : ''}\n`);

  const [puzzles] = await db.query(
    `SELECT p.id, p.game_type_id, p.title, p.position, p.side_to_move, p.setup_move,
            p.solution_line, p.goal, g.game_name
     FROM puzzles p
     LEFT JOIN game_types g ON g.id = p.game_type_id
     WHERE p.is_draft = 0 AND p.rule_snapshot IS NULL
     ORDER BY p.id`
  );

  if (!puzzles.length) {
    console.log('[backfill] Every published puzzle already has a snapshot.');
    await db.end();
    return;
  }

  const { validatePuzzle } = require(path.join(ROOT, 'server/puzzle-validation'));

  const safeParse = (v, fallback = null) => {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (_) { return fallback; }
  };

  const ok = [];
  const broken = [];
  const noGame = [];

  for (const p of puzzles) {
    if (!p.game_type_id) { noGame.push(p); continue; }
    const rules = await readLive(db, p.game_type_id);
    if (!rules) { noGame.push(p); continue; }

    let works = false;
    let detail = '';
    try {
      const verdict = await validatePuzzle({
        position: await hydratePosition(rules, safeParse(p.position, [])),
        side_to_move: p.side_to_move,
        setup_move: safeParse(p.setup_move),
        solution_line: safeParse(p.solution_line, []),
        goal: p.goal,
        game_type_id: p.game_type_id,
      }, rules.game);
      works = !!verdict.intendedWorks;
      detail = verdict.detail || '';
    } catch (err) {
      detail = err.message;
    }

    (works ? ok : broken).push({ ...p, detail });
  }

  const label = (p) => `#${String(p.id).padStart(4)} ${String(p.title || '(untitled)').slice(0, 28).padEnd(30)} ${String(p.game_name || '?').slice(0, 22)}`;

  console.log(`${ok.length} still valid against their game as it stands now.`);
  if (broken.length) {
    console.log(`\n${broken.length} NO LONGER VALID - the game has changed under them:`);
    for (const p of broken) console.log(`  ${label(p)}  ${String(p.detail).slice(0, 60)}`);
    console.log('\n  These are NOT snapshotted without --force. Freezing a puzzle that');
    console.log('  already fails would make it permanently wrong instead of fixable.');
  }
  if (noGame.length) {
    console.log(`\n${noGame.length} have no game to snapshot (deleted, or never here):`);
    for (const p of noGame) console.log(`  ${label(p)}`);
  }

  if (!WRITE) {
    console.log('\nDry run - nothing written. Re-run with --write.');
    await db.end();
    return;
  }

  const toWrite = FORCE ? ok.concat(broken) : ok;
  let written = 0;
  for (const p of toWrite) {
    const fingerprint = await ensureSnapshot(db, p.game_type_id);
    if (!fingerprint) continue;
    await db.query(
      'UPDATE puzzles SET rule_snapshot = ?, rules_diverged_at = ? WHERE id = ?',
      [fingerprint, broken.includes(p) ? new Date() : null, p.id]
    );
    written++;
  }

  const [[snaps]] = await db.query('SELECT COUNT(*) AS n FROM puzzle_rule_snapshots');
  console.log(`\n[backfill] Snapshotted ${written} puzzle(s) into ${snaps.n} distinct rule set(s).`);
  if (!FORCE && broken.length) {
    console.log(`[backfill] Left ${broken.length} broken puzzle(s) alone.`);
  }

  await db.end();
})().catch((err) => {
  console.error('[backfill]', err.message);
  process.exit(1);
});
