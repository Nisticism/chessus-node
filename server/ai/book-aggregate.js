/**
 * Aggregate `book.jsonl` -> `book.json` in pure JS.
 *
 * Mirrors `aggregate_book` in ai-engine-rs/src/book.rs so that uploaded
 * artifacts get a valid book.json without requiring the Rust binary to
 * be present. Output format is identical:
 *
 *   {
 *     "format": "squarestrat-book-v1",
 *     "ply_limit": 20,
 *     "positions": {
 *       "<sig>": { "moves": [{mv, w, l, d}], "total": N }
 *     }
 *   }
 *
 * (Rust uses BTreeMap so its JSON keys are sorted; we emit insertion
 * order. Both are valid JSON and the JS reader doesn't care about key
 * order — `mergeBooks` keys-by-string anyway.)
 */
const fs = require('fs');
const path = require('path');

const FORMAT = 'squarestrat-book-v1';
const PLY_LIMIT = 20;

/**
 * Read a book.jsonl path and return the aggregated BookDoc object.
 * Throws on I/O errors; silently skips malformed lines (matching Rust).
 */
function aggregateBookJsonlFile(jsonlPath) {
  const text = fs.readFileSync(jsonlPath, 'utf8');
  return aggregateBookJsonlText(text);
}

function aggregateBookJsonlText(text) {
  // by_pos[sig] = Map<mv, {mv,w,l,d}>
  const byPos = new Map();
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); }
    catch { continue; }
    const sig = typeof rec.s === 'string' ? rec.s : '';
    const mv = typeof rec.m === 'string' ? rec.m : '';
    const r = typeof rec.r === 'string' ? rec.r : 'D';
    if (!sig || !mv) continue;
    let posEntry = byPos.get(sig);
    if (!posEntry) {
      posEntry = new Map();
      byPos.set(sig, posEntry);
    }
    let stats = posEntry.get(mv);
    if (!stats) {
      stats = { mv, w: 0, l: 0, d: 0 };
      posEntry.set(mv, stats);
    }
    if (r === 'W') stats.w++;
    else if (r === 'L') stats.l++;
    else stats.d++;
  }
  const positions = {};
  for (const [sig, moveMap] of byPos.entries()) {
    const moves = [...moveMap.values()];
    const total = moves.reduce((s, m) => s + m.w + m.l + m.d, 0);
    positions[sig] = { moves, total };
  }
  return { format: FORMAT, ply_limit: PLY_LIMIT, positions };
}

/**
 * Re-aggregate book.jsonl -> book.json inside a single job directory.
 * No-op (returns null) if book.jsonl doesn't exist.
 */
function rebuildBookJsonForJob(jobDir) {
  const jsonl = path.join(jobDir, 'book.jsonl');
  if (!fs.existsSync(jsonl)) return null;
  const doc = aggregateBookJsonlFile(jsonl);
  const out = path.join(jobDir, 'book.json');
  fs.writeFileSync(out, JSON.stringify(doc));
  return out;
}

module.exports = {
  aggregateBookJsonlFile,
  aggregateBookJsonlText,
  rebuildBookJsonForJob,
  FORMAT,
  PLY_LIMIT,
};
