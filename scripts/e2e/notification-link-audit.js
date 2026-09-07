/*
 * Notification link audit.
 *
 * A notification's action_url is written once and frozen in the row, so a link
 * that was wrong when it was created stays wrong for ever. This walks every
 * distinct link in the table and asks two questions:
 *
 *   1. does the path match a route the app actually has?
 *   2. does the thing it points at still exist?
 *
 * (2) has two very different answers. A link to a game or piece that has since
 * been DELETED is expected - the notification outlived its subject, and there
 * is nothing to fix. A malformed link, or one to a route that does not exist,
 * is a bug in whatever wrote it.
 *
 *   node scripts/e2e/notification-link-audit.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const db = require('../../configs/db');

/** Route patterns the app serves, read from App.js so this cannot drift. */
function appRoutes() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'chessus-frontend', 'src', 'App.js'), 'utf8');
  return [...src.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => r && r !== '*');
}

/** Does `pathname` match a react-router path pattern with :params? */
function matchesRoute(pathname, pattern) {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === a[i]);
}

// What each link shape points at, so "does it still exist" can be asked.
const TARGETS = [
  { re: /^\/play\/(\d+)$/, table: 'games', label: 'game' },
  { re: /^\/match\/(\d+)$/, table: 'games', label: 'game' },
  { re: /^\/games\/(\d+)$/, table: 'game_types', label: 'game type' },
  { re: /^\/pieces\/(\d+)$/, table: 'pieces', label: 'piece' },
  // Forum threads are `articles` (the forums are article-backed).
  { re: /^\/forums\/(\d+)$/, table: 'articles', label: 'forum thread' },
  { re: /^\/announcements\/(\d+)$/, table: 'announcements', label: 'announcement' },
  { re: /^\/profile\/id\/(\d+)$/, table: 'users', label: 'user' },
];

/* A local database may not carry every feature's tables; skip those rather
   than failing the whole audit. */
const tableCache = new Map();
async function tableExists(table) {
  if (tableCache.has(table)) return tableCache.get(table);
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [process.env.DB_NAME || 'chessusnode', table]
  );
  const exists = rows[0].n > 0;
  if (!exists) console.log(`  (no '${table}' table here - links to it are not checked)`);
  tableCache.set(table, exists);
  return exists;
}

async function main() {
  const routes = appRoutes();
  const [rows] = await db.query(
    `SELECT action_url, COUNT(*) AS n, GROUP_CONCAT(DISTINCT type) AS types
     FROM notifications WHERE action_url IS NOT NULL
     GROUP BY action_url ORDER BY n DESC`
  );

  const malformed = [];
  const unrouted = [];
  const missing = [];
  let ok = 0;

  for (const row of rows) {
    const url = row.action_url;
    const pathname = url.split('?')[0];

    if (/\/(undefined|null|NaN)(\/|$)/.test(pathname)) {
      malformed.push({ url, ...row });
      continue;
    }

    if (!routes.some((r) => matchesRoute(pathname, r))) {
      unrouted.push({ url, ...row });
      continue;
    }

    const target = TARGETS.find((t) => t.re.test(pathname));
    if (target && await tableExists(target.table)) {
      const id = pathname.match(target.re)[1];
      // eslint-disable-next-line no-await-in-loop
      const [[found]] = await db.query(
        `SELECT COUNT(*) AS n FROM ${target.table} WHERE id = ?`, [id]);
      if (!found.n) { missing.push({ url, label: target.label, ...row }); continue; }
    }
    ok += row.n;
  }

  const report = (title, list, note) => {
    console.log(`\n${title}: ${list.length} distinct link(s)`);
    if (note) console.log(`  ${note}`);
    for (const item of list.slice(0, 15)) {
      console.log(`  ${item.url}  (${item.n} notification(s), type ${item.types})`);
    }
    if (list.length > 15) console.log(`  ...and ${list.length - 15} more`);
  };

  console.log(`Checked ${rows.length} distinct links across ${rows.reduce((s, r) => s + r.n, 0)} notifications.`);
  console.log(`${ok} notifications point at something that exists.`);

  report('BROKEN - malformed link', malformed,
    'Built from an undefined value. These lead nowhere and are a bug in whatever created them.');
  report('BROKEN - no such route', unrouted,
    'The app has no page at this path, so the notification cannot open.');
  report('STALE - target has since been deleted', missing,
    'Expected: the notification outlived its subject. Not a bug, but the page should say so.');

  await db.end();
  // Only the first two are failures worth acting on.
  process.exit(malformed.length + unrouted.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
