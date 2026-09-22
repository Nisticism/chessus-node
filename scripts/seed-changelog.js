/*
 * Move the changelog out of the frontend bundle and into the database.
 *
 *   node scripts/seed-changelog.js            # production via tunnel, dry run
 *   node scripts/seed-changelog.js --write
 *   node scripts/seed-changelog.js --local --write
 *
 * WHY
 *
 * The changelog was a hardcoded array in Changelog.js: 115 entries, ~294KB of
 * text shipped to every visitor, and editable only by rebuilding and deploying
 * the whole frontend. It also had no time of day and no timezone, so an entry
 * written in the evening could read as tomorrow's news to anyone east of here.
 *
 * WHAT CHANGES IN THE MOVE
 *
 * One row per DAY. The old array had 115 entries across 71 dates - eleven dates
 * carried more than one - and which of them came first was decided by position
 * in a source file. A day is now one row with a UNIQUE key on its date, so
 * there can never again be two entries for the same day, and the several titled
 * blocks a busy day had become SECTIONS inside it. Nothing is lost: every title
 * and every bullet survives, in order.
 *
 * Each row also carries an instant, published_at, stored in UTC. A DATE alone
 * cannot be shown in somebody's local time because it does not describe a
 * moment. The imported entries had no time of day, so they are given 12:00 UTC
 * - midday is the choice that lands on the same calendar date for almost every
 * timezone on earth, which a midnight would not.
 *
 * Read-only without --write.
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');

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
      console.log('[changelog] production via tunnel\n');
    }
  } catch (_) { /* local */ }
}

const db_pool = require(path.join(ROOT, 'configs/db'));

const SOURCE = path.join(ROOT, 'chessus-frontend/src/containers/changelog/Changelog.js');

/*
 * Read the entries out of the source file by PARSING it, not by evaluating it.
 * The file is a React module and importing it would drag in JSX and stylesheets
 * that have no business running in a migration script.
 */
function readEntriesFromSource() {
  const babel = require(path.join(ROOT, 'chessus-frontend/node_modules/@babel/parser'));
  const ast = babel.parse(fs.readFileSync(SOURCE, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });

  let arr = null;
  for (const node of ast.program.body) {
    if (node.type !== 'VariableDeclaration') continue;
    // Named `changelogData` before the move, `fallbackChangelogData` after it.
    for (const d of node.declarations) {
      if (d.id.name === 'changelogData' || d.id.name === 'fallbackChangelogData') arr = d.init;
    }
  }
  if (!arr) throw new Error('No changelog array found in ' + SOURCE);

  const str = (n) => (n && n.type === 'StringLiteral' ? n.value : null);
  return arr.elements.map((el) => {
    const out = { date: null, title: null, items: [] };
    for (const prop of el.properties) {
      const key = prop.key.name || prop.key.value;
      if (key === 'date') out.date = str(prop.value);
      else if (key === 'title') out.title = str(prop.value);
      else if (key === 'items') out.items = prop.value.elements.map(str).filter(Boolean);
    }
    return out;
  });
}

/** "September 19, 2026" -> "2026-09-19". Returns null for anything else. */
const MONTHS = ['january','february','march','april','may','june','july',
                'august','september','october','november','december'];
function toIsoDate(human) {
  const m = String(human || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/*
 * Midday UTC for a past day - the hour that lands on the same calendar date
 * almost everywhere - but no later than now for a day that has already
 * arrived, so an entry written this morning is not withheld until noon.
 * Matches changelogDefaultInstant in server/index.js.
 */
function publishInstant(iso) {
  const midday = Date.parse(`${iso}T12:00:00Z`);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const when = iso <= todayUtc ? Math.min(midday, Date.now()) : midday;
  return new Date(when).toISOString().slice(0, 19).replace('T', ' ');
}

(async () => {
  const entries = readEntriesFromSource();
  console.log(`read ${entries.length} entries from the source file`);

  /*
   * Fold into days, KEEPING THE ORDER the file had. The array is newest first
   * and a day's several blocks appear in the order they were written, so the
   * first one encountered for a date leads that day.
   */
  const byDate = new Map();
  const unparsed = [];
  for (const e of entries) {
    const iso = toIsoDate(e.date);
    if (!iso) { unparsed.push(e.date); continue; }
    if (!byDate.has(iso)) byDate.set(iso, []);
    byDate.get(iso).push({ title: e.title || null, items: e.items });
  }
  if (unparsed.length) {
    console.log(`\n!! ${unparsed.length} entries have a date this script cannot read:`);
    for (const d of unparsed.slice(0, 10)) console.log(`     ${JSON.stringify(d)}`);
    console.log('   They would be LOST. Fix them in the source file first.');
    process.exit(1);
  }

  const days = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const merged = days.filter(([, secs]) => secs.length > 1);
  const items = days.reduce((n, [, secs]) => n + secs.reduce((m, s) => m + s.items.length, 0), 0);

  console.log(`\n${days.length} days, ${items} bullet items`);
  console.log(`${merged.length} day(s) had more than one entry and become sections of one day:`);
  for (const [d, secs] of merged) console.log(`     ${d}  ${secs.length} sections  (${secs.map(s => s.items.length).join(' + ')} items)`);

  // Nothing may be dropped on the way in.
  const sourceItems = entries.reduce((n, e) => n + e.items.length, 0);
  if (items !== sourceItems) {
    console.error(`\n!! item count changed: ${sourceItems} in the file, ${items} after folding. Refusing to write.`);
    process.exit(1);
  }
  console.log(`\nitem count matches the source exactly (${items})`);

  if (!WRITE) {
    console.log('\nDRY RUN - pass --write to insert.');
    process.exit(0);
  }

  const [[{ n: existing }]] = await db_pool.query('SELECT COUNT(*) AS n FROM changelog_entries');
  if (existing > 0) {
    console.log(`\nchangelog_entries already has ${existing} row(s); leaving them alone.`);
    console.log('Empty the table first if you mean to re-import.');
    process.exit(0);
  }

  let written = 0;
  for (const [iso, sections] of days) {
    await db_pool.query(
      `INSERT INTO changelog_entries (entry_date, published_at, sections)
       VALUES (?, ?, ?)`,
      [iso, publishInstant(iso), JSON.stringify(sections)]
    );
    written++;
  }
  console.log(`\nwrote ${written} day(s).`);
  process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
