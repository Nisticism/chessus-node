#!/usr/bin/env node
/*
 * Write db/seeds/puzzle-pool-decisions.json from the hand-picked pool rulings
 * in this database.
 *
 * WHY THIS EXISTS
 *
 * The sweep reproduces every auto_* row from the game data, anywhere, every
 * time. What it cannot reproduce is a person's judgement - "keep this one",
 * "this is #201 under another name" - and those rulings were made in the admin
 * panel against whichever database the person was looking at.
 *
 * Pushing them to production over a tunnel works but is the wrong shape: it is
 * a manual step, done from one machine, that leaves no record of what changed
 * or when. The puzzles themselves already solved this - they are exported to
 * db/seeds/daily-pool-puzzles.json, committed, and installed by a migration on
 * deploy. Curatorial decisions are the same kind of thing, so they travel the
 * same way.
 *
 * So: decide in the admin panel, run this, commit the file. The next deploy
 * applies it. No tunnel, no production credentials, and `git log` says who
 * changed the pool and when.
 *
 * Usage:
 *   node scripts/export-pool-decisions.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'db', 'seeds', 'puzzle-pool-decisions.json');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'chessusnode',
    connectTimeout: 20000,
  });

  /*
   * Only the human rulings. An auto_* row is the sweep's output and would be
   * noise in a file meant to record decisions - worse, a stale one committed
   * here could contradict a sweep run later against different data.
   */
  const [rows] = await db.query(
    `SELECT pp.game_type_id, pp.status, pp.exclusion_reason, pp.duplicate_of,
            pp.similarity_score, pp.similarity_kind, pp.note,
            g.game_name
     FROM puzzle_pool pp
     LEFT JOIN game_types g ON g.id = pp.game_type_id
     WHERE pp.status IN ('included','excluded')
     ORDER BY pp.game_type_id`
  );

  const decisions = rows.map((r) => ({
    game_type_id: Number(r.game_type_id),
    /*
     * Carried for the reader, never matched on. Games get renamed, and a rename
     * must not orphan a decision - the id is the identity.
     */
    game_name: r.game_name || null,
    status: r.status,
    exclusion_reason: r.exclusion_reason || null,
    duplicate_of: r.duplicate_of != null ? Number(r.duplicate_of) : null,
    similarity_score: r.similarity_score != null ? Number(r.similarity_score) : null,
    similarity_kind: r.similarity_kind || null,
    note: r.note || null,
  }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(decisions, null, 2)}\n`);

  const included = decisions.filter((d) => d.status === 'included').length;
  console.log(`[pool-decisions] Wrote ${decisions.length} decision(s) to ${path.relative(ROOT, OUT)}`);
  console.log(`[pool-decisions]   ${included} kept in the pool, ${decisions.length - included} kept out.`);
  console.log('[pool-decisions] Commit the file; the next deploy applies it.');

  await db.end();
})().catch((err) => {
  console.error('[pool-decisions]', err.message);
  process.exit(1);
});
