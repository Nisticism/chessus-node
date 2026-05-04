/**
 * Importer for externally-trained AI artifacts.
 *
 * Accepts either:
 *   - a raw book.jsonl file (the only required artifact; the bot's
 *     opening book derives entirely from this)
 *   - a .zip of an entire job directory (book.jsonl required inside;
 *     log.ndjson + model-NNNNNN.bin optional, kept for auditability)
 *
 * For each accepted upload we:
 *   1. validate the book.jsonl structure (so a corrupted file can't
 *      poison the merged book the adaptive bot reads)
 *   2. create a new ai_training_jobs row with status='completed',
 *      source='uploaded', and games_played derived from the file
 *   3. write the artifacts into ai-training/<gtid>/jobs/<newJobId>/
 *   4. re-run aggregation so book.json is generated alongside book.jsonl
 *
 * Idempotency note: each upload becomes a new job row, so re-uploading
 * the same file WILL double-count. The admin UI surfaces uploaded jobs
 * (badge + delete button) so the operator can clean up duplicates.
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const db_pool = require('../../configs/db');
const { trainingDirFor } = require('./export-game-rules');

const JSONL_BYTE_LIMIT = 200 * 1024 * 1024; // 200 MB sanity ceiling
const ZIP_ENTRY_BYTE_LIMIT = 200 * 1024 * 1024; // per-file cap inside zip
const ZIP_TOTAL_BYTE_LIMIT = 500 * 1024 * 1024;

function _ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/**
 * Validate a buffer of book.jsonl content. Returns { valid, recordCount,
 * gamesEstimate, error }. We require every line to be JSON with at least
 * `s`, `m`, and `r` fields and `r` ∈ {W,L,D}.
 */
function validateBookJsonl(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 0) return { valid: false, error: 'book.jsonl is empty' };
  if (buffer.length > JSONL_BYTE_LIMIT) {
    return { valid: false, error: `book.jsonl exceeds ${JSONL_BYTE_LIMIT} bytes` };
  }
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  let recordCount = 0;
  // Estimate distinct games: every game contributes one record at ply=1.
  let gamesEstimate = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); }
    catch { return { valid: false, error: `Line ${i + 1}: invalid JSON` }; }
    if (typeof rec.s !== 'string' || typeof rec.m !== 'string' || typeof rec.r !== 'string') {
      return { valid: false, error: `Line ${i + 1}: missing s/m/r fields` };
    }
    if (rec.r !== 'W' && rec.r !== 'L' && rec.r !== 'D') {
      return { valid: false, error: `Line ${i + 1}: invalid r="${rec.r}" (expected W/L/D)` };
    }
    recordCount++;
    if (rec.p === 1 || rec.p === '1') gamesEstimate++;
  }
  if (recordCount === 0) {
    return { valid: false, error: 'book.jsonl contains no records' };
  }
  // If no ply==1 records exist (unusual — possible if recording started
  // partway through), fall back to dividing total records by half the
  // book ply limit as a rough guess.
  if (gamesEstimate === 0) {
    gamesEstimate = Math.max(1, Math.round(recordCount / 10));
  }
  return { valid: true, recordCount, gamesEstimate };
}

/**
 * Extract a zipped job directory into memory and locate book.jsonl
 * (and optionally log.ndjson + model-*.bin). Returns
 * `{ bookJsonl: Buffer, extras: [{name, buffer}] }` or throws.
 */
function unpackJobZip(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer)) throw new Error('zip payload must be a Buffer');
  if (zipBuffer.length > ZIP_TOTAL_BYTE_LIMIT) {
    throw new Error(`Zip exceeds ${ZIP_TOTAL_BYTE_LIMIT} bytes`);
  }
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error('Zip is empty');

  let bookJsonl = null;
  const extras = [];
  let totalUncompressed = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = path.basename(entry.entryName);
    // Reject suspicious paths (zip-slip). We only ever read into memory
    // and rewrite by name, but defense in depth.
    if (entry.entryName.includes('..') || path.isAbsolute(entry.entryName)) {
      throw new Error(`Zip contains unsafe path: ${entry.entryName}`);
    }
    const data = entry.getData();
    totalUncompressed += data.length;
    if (data.length > ZIP_ENTRY_BYTE_LIMIT) {
      throw new Error(`Zip entry ${name} exceeds size limit`);
    }
    if (totalUncompressed > ZIP_TOTAL_BYTE_LIMIT) {
      throw new Error(`Zip uncompressed size exceeds limit`);
    }
    if (name === 'book.jsonl') {
      bookJsonl = data;
    } else if (name === 'log.ndjson' || /^model-\d+\.bin$/.test(name)) {
      extras.push({ name, buffer: data });
    }
    // Silently ignore other files (e.g. rules.json) — we don't need them.
  }

  if (!bookJsonl) throw new Error('Zip does not contain book.jsonl');
  return { bookJsonl, extras };
}

/**
 * Import an upload for a given game type. `payload` is one of:
 *   { kind: 'jsonl', buffer: Buffer }
 *   { kind: 'zip',   buffer: Buffer }
 *
 * Returns { jobId, gamesEstimate, recordCount }.
 */
async function importUpload(gameTypeId, payload, opts = {}) {
  const gtid = parseInt(gameTypeId, 10);
  if (!Number.isFinite(gtid) || gtid <= 0) {
    throw new Error('Invalid gameTypeId');
  }
  if (!payload || !payload.kind) throw new Error('Missing payload');

  let bookJsonl = null;
  let extras = [];
  if (payload.kind === 'jsonl') {
    bookJsonl = payload.buffer;
  } else if (payload.kind === 'zip') {
    const unpacked = unpackJobZip(payload.buffer);
    bookJsonl = unpacked.bookJsonl;
    extras = unpacked.extras;
  } else {
    throw new Error(`Unknown payload kind: ${payload.kind}`);
  }

  const validation = validateBookJsonl(bookJsonl);
  if (!validation.valid) {
    throw new Error(`book.jsonl validation failed: ${validation.error}`);
  }

  // Sanity-check the game type exists so we don't silently dump
  // artifacts for a deleted game.
  const [[gameType]] = await db_pool.query(
    `SELECT id FROM game_types WHERE id = ? LIMIT 1`,
    [gtid],
  );
  if (!gameType) throw new Error(`Game type ${gtid} not found`);

  // Create the job row. games_target = games_played so the UI shows 100%.
  const games = validation.gamesEstimate;
  const mctsIters = Number.isFinite(opts.mctsIters) && opts.mctsIters > 0 ? Math.round(opts.mctsIters) : 0;
  const [result] = await db_pool.query(
    `INSERT INTO ai_training_jobs
       (game_type_id, status, games_target, games_played, mcts_iters,
        max_rss_mb, checkpoint_every, seed, rules_path,
        created_by_user_id, started_at, ended_at, source)
     VALUES (?, 'completed', ?, ?, ?, 0, 0, 0, '',
             ?, NOW(), NOW(), 'uploaded')`,
    [gtid, games, games, mctsIters, opts.userId || null],
  );
  const jobId = result.insertId;

  // Write the artifacts to the matching job dir.
  const jobDir = path.join(trainingDirFor(gtid), 'jobs', String(jobId));
  _ensureDir(jobDir);
  fs.writeFileSync(path.join(jobDir, 'book.jsonl'), bookJsonl);
  for (const e of extras) {
    fs.writeFileSync(path.join(jobDir, e.name), e.buffer);
  }

  // Re-aggregate to produce book.json for this job. Lazy-require to
  // avoid pulling the opening-book module at trainer-service load time.
  const { rebuildBookJsonForJob } = require('./book-aggregate');
  try {
    rebuildBookJsonForJob(jobDir);
  } catch (e) {
    console.warn(`[upload] aggregation failed for job ${jobId}: ${e.message}`);
  }

  // Bust the bot's in-memory book cache so the next request sees the
  // new data immediately.
  try {
    require('./opening-book')._clearCache();
  } catch (_) { /* not loaded — fine */ }

  return {
    jobId,
    gameTypeId: gtid,
    gamesEstimate: games,
    recordCount: validation.recordCount,
    extrasImported: extras.map((e) => e.name),
  };
}

module.exports = {
  importUpload,
  validateBookJsonl,
  unpackJobZip,
};
