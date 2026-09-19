/*
 * Fill in piece definitions missing from a frozen rule snapshot.
 *
 *   node scripts/repair-rule-snapshots.js
 *   node scripts/repair-rule-snapshots.js --write
 *   node scripts/repair-rule-snapshots.js --local
 *
 * WHY
 *
 * A snapshot freezes the rules a published puzzle plays under. Before the
 * promotion-closure fix in server/puzzle-snapshot.js, readLive did not know
 * about promotion targets configured in game_type_pieces.promotion_pieces_override
 * or pieces.promotion_pieces_ids - so any snapshot taken then is missing those
 * piece rows entirely, and a piece hydrated from a missing row gets `{}`: board
 * identity with no movement and no capture.
 *
 * Re-running ensureSnapshot does NOT heal this. The fingerprint is computed from
 * the game's rule columns and one cell per PLACEMENT, and a promotion-only piece
 * has no placement - so the digest is unchanged, the row already exists, and the
 * upsert only touches game_type_id.
 *
 * ADDITIVE ONLY, deliberately. This adds piece rows the frozen copy lacks and
 * never alters one it already has. A snapshot exists to keep a puzzle playing
 * under the rules it was made with; rewriting a definition it already froze
 * would change a live puzzle's rules under it, which is the opposite of the
 * point. A missing definition is not a frozen rule - it is an absence, and an
 * absence is never what the author meant.
 */
require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const FORCE_LOCAL = process.argv.includes('--local');

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
      console.log(`[snapshots] production via tunnel${WRITE ? '  (WRITING)' : '  (dry run)'}\n`);
    }
  } catch (_) { /* fall through to the environment */ }
}

const db_pool = require(path.join(ROOT, 'configs/db'));
const { readLive } = require(path.join(ROOT, 'server/puzzle-snapshot'));

(async () => {
  const [snaps] = await db_pool.query(
    'SELECT fingerprint, game_type_id, payload FROM puzzle_rule_snapshots'
  );
  console.log(`snapshots: ${snaps.length}`);

  let repaired = 0;
  for (const s of snaps) {
    let payload;
    try {
      payload = typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload;
    } catch (_) {
      console.log(`  ${s.fingerprint.slice(0, 12)} payload is not readable - skipped`);
      continue;
    }
    if (!payload?.game) continue;

    const live = await readLive(db_pool, s.game_type_id);
    if (!live) continue;

    const frozen = new Map((payload.pieces || []).map((p) => [Number(p.id), p]));
    const adding = (live.pieces || []).filter((p) => !frozen.has(Number(p.id)));
    if (!adding.length) continue;

    const [[used]] = await db_pool.query(
      'SELECT COUNT(*) AS n FROM puzzles WHERE rule_snapshot = ?', [s.fingerprint]
    );
    console.log(`  ${s.fingerprint.slice(0, 12)} game ${s.game_type_id}:`
      + ` adding ${adding.map((p) => `#${p.id} ${p.piece_name}`).join(', ')}`
      + ` (${used.n} puzzle(s) pinned)`);

    if (WRITE) {
      payload.pieces = [...(payload.pieces || []), ...adding];
      await db_pool.query(
        'UPDATE puzzle_rule_snapshots SET payload = ? WHERE fingerprint = ?',
        [JSON.stringify(payload), s.fingerprint]
      );
    }
    repaired++;
  }

  console.log(`\n${repaired} snapshot(s) ${WRITE ? 'repaired' : 'would be repaired'}`);
  if (!WRITE && repaired) console.log('Re-run with --write to apply.');
  process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
