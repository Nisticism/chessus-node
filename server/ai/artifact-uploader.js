/**
 * Importer for externally-trained AI artifacts.
 *
 * Accepts either:
 *   - a .stratbook file (the recommended single-file format produced by the
 *     downloadable trainer). Contains book.jsonl records followed by a final
 *     JSON line with `"type":"job_summary"` carrying mcts_iters, win/draw
 *     breakdown, and other training stats.
 *   - a raw book.jsonl file (legacy; the only required artifact; the bot's
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
 * Parse a .stratbook buffer. Returns
 * `{ bookJsonl: Buffer, summary: Object|null, gamesLog: Buffer|null }`.
 *
 * Format (each section is optional):
 *   1. book.jsonl lines
 *   2. `{"type":"job_summary", ...}` — aggregate stats (final book line)
 *   3. `{"type":"games_log_start"}` … `{"type":"games_log_end"}` — raw
 *      games.txt content embedded so board replay works on uploaded jobs.
 *
 * If no summary line is present (e.g. user uploaded a renamed .jsonl), we
 * still accept it. If no games_log section is present, gamesLog is null.
 */
function parseStratbook(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  // Strip trailing blank lines.
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return { bookJsonl: buffer, summary: null, gamesLog: null };

  // --- Extract embedded games_log section (between marker lines) if present ---
  let gamesLog = null;
  const _isMarker = (line, typeName) => {
    const t = line.trim();
    if (!t.startsWith('{')) return false;
    try { return JSON.parse(t)?.type === typeName; } catch { return false; }
  };
  const startIdx = lines.findIndex((l) => _isMarker(l, 'games_log_start'));
  if (startIdx !== -1) {
    const endIdx = lines.findIndex((l, i) => i > startIdx && _isMarker(l, 'games_log_end'));
    if (endIdx !== -1) {
      const logLines = lines.slice(startIdx + 1, endIdx);
      gamesLog = Buffer.from(logLines.join('\n') + (logLines.length > 0 ? '\n' : ''), 'utf8');
      // Remove the marker + content lines from the main array.
      lines.splice(startIdx, endIdx - startIdx + 1);
      // Re-strip trailing blank lines after removal.
      while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    }
  }

  // --- Extract job_summary line (must be last remaining line) ---
  let summary = null;
  const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
  if (lastLine.startsWith('{')) {
    try {
      const obj = JSON.parse(lastLine);
      if (obj && obj.type === 'job_summary') {
        summary = obj;
        lines.pop(); // Remove summary line from book content.
      }
    } catch (_) { /* not a summary line — treat as normal book record */ }
  }

  const bookText = lines.join('\n') + (lines.length > 0 ? '\n' : '');
  return { bookJsonl: Buffer.from(bookText, 'utf8'), summary, gamesLog };
}

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
  let stratbookSummary = null;
  let stratbookGamesLog = null;
  if (payload.kind === 'stratbook') {
    const parsed = parseStratbook(payload.buffer);
    bookJsonl = parsed.bookJsonl;
    stratbookSummary = parsed.summary;
    stratbookGamesLog = parsed.gamesLog;
  } else if (payload.kind === 'jsonl') {
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
  // Prefer stats from the .stratbook summary if available; fall back to
  // counting ply-1 records from book.jsonl.
  const games = stratbookSummary?.total_games ?? validation.gamesEstimate;
  const mctsIters = (() => {
    // Prefer explicit caller-supplied value, then .stratbook summary, then 0.
    if (Number.isFinite(opts.mctsIters) && opts.mctsIters > 0) return Math.round(opts.mctsIters);
    if (stratbookSummary?.mcts_iters > 0) return Math.round(stratbookSummary.mcts_iters);
    return 0;
  })();
  const hasGameLog = !!(stratbookGamesLog && stratbookGamesLog.length > 0);
  const [result] = await db_pool.query(
    `INSERT INTO ai_training_jobs
       (game_type_id, status, games_target, games_played, mcts_iters,
        max_rss_mb, checkpoint_every, seed, rules_path,
        created_by_user_id, started_at, ended_at, source, has_game_log)
     VALUES (?, 'completed', ?, ?, ?, 0, 0, 0, '',
             ?, NOW(), NOW(), 'uploaded', ?)`,
    [gtid, games, games, mctsIters, opts.userId || null, hasGameLog ? 1 : 0],
  );
  const jobId = result.insertId;

  // Write the artifacts to the matching job dir.
  const jobDir = path.join(trainingDirFor(gtid), 'jobs', String(jobId));
  _ensureDir(jobDir);
  fs.writeFileSync(path.join(jobDir, 'book.jsonl'), bookJsonl);
  for (const e of extras) {
    fs.writeFileSync(path.join(jobDir, e.name), e.buffer);
  }

  // If the stratbook contained an embedded games log, write it to games.txt
  // so the board replay analysis endpoint can serve it to the admin UI.
  if (stratbookGamesLog && stratbookGamesLog.length > 0) {
    try {
      fs.writeFileSync(path.join(jobDir, 'games.txt'), stratbookGamesLog);
    } catch (e) {
      console.warn(`[upload] failed to write games.txt for job ${jobId}: ${e.message}`);
    }
  }

  // Build log.ndjson from the embedded games log if available (most accurate
  // — it has per-game move counts and exact end reasons). Fall back to
  // synthesising from the aggregate job summary if games.txt is absent.
  let logNdjsonWritten = false;
  if (stratbookGamesLog && stratbookGamesLog.length > 0 && stratbookSummary) {
    try {
      const logLines = _buildLogFromGamesText(stratbookGamesLog.toString('utf8'), stratbookSummary);
      if (logLines.length > 2) { // started + at least one game_complete + finished
        fs.writeFileSync(path.join(jobDir, 'log.ndjson'), logLines.join('\n') + '\n');
        logNdjsonWritten = true;
      }
    } catch (e) {
      console.warn(`[upload] failed to build log.ndjson from games.txt for job ${jobId}: ${e.message}`);
    }
  }
  if (!logNdjsonWritten && stratbookSummary && stratbookSummary.total_games > 0) {
    try {
      const logLines = _synthesizeLogFromSummary(stratbookSummary);
      fs.writeFileSync(path.join(jobDir, 'log.ndjson'), logLines.join('\n') + '\n');
    } catch (e) {
      console.warn(`[upload] failed to synthesize log.ndjson for job ${jobId}: ${e.message}`);
    }
  }
  // Store the raw summary for later reference (used by auto-repair in training-analysis).
  if (stratbookSummary) {
    try {
      fs.writeFileSync(path.join(jobDir, 'job_summary.json'), JSON.stringify(stratbookSummary, null, 2));
    } catch (_) { /* non-fatal */ }
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
    hasGameLog: !!(stratbookGamesLog && stratbookGamesLog.length > 0),
  };
}

/**
 * Maps the human-readable labels emitted by end_reason_label() in the Rust
 * trainer (stored in job_summary.end_reason_counts) to the serde snake_case
 * keys emitted in log.ndjson game_complete events. These must match the
 * strings expected by training-analysis.js.
 */
const REASON_LABEL_TO_SERDE = {
  'checkmate':            'checkmate',
  'stalemate':            'stalemate',
  'stalemate win':        'stalemate_win',
  'no moves':             'no_moves_loss',
  'no move':              'no_move',
  'capture':              'capture_condition',
  'lost all pieces':      'lose_all_pieces',
  'squares held':         'squares_condition',
  'move limit':           'move_limit',
  'move cap':             'move_cap_rollout',
  'rollout cap':          'rollout_cap',
  'royal capture':        'royal_capture',
  'repetition':           'repetition',
  'insuf. material':      'insufficient_material',
  'promotion':            'promotion',
  'simul capture draw':   'simultaneous_capture_draw',
  'simul checkmate draw': 'simultaneous_checkmate_draw',
  'cancellation draw':    'cancellation_draw',
  'points win':           'points_win',
  'points draw':          'points_draw',
  'burn kill':            'burn_kill',
};

// Serde-key reasons that represent draws (not decisive outcomes).
const DRAW_REASON_KEYS = new Set([
  'stalemate', 'move_limit', 'move_cap_rollout', 'rollout_cap', 'no_move',
  'repetition', 'insufficient_material', 'simultaneous_capture_draw',
  'simultaneous_checkmate_draw', 'cancellation_draw', 'points_draw',
]);

/**
 * Parse the embedded games.txt (plain-text game transcripts written by the
 * Rust trainer) and produce log.ndjson-compatible game_complete event lines.
 *
 * games.txt header format (from the Rust trainer):
 *   \n=== Game #N \u2014 <outcome> (<reason>) \u2014 M moves ===
 *
 * <outcome>: "Player 1 wins" | "Player 2 wins" | "Draw"
 * <reason>:  serde EndReason snake_case with underscores replaced by spaces,
 *            e.g. "checkmate", "no moves loss", "move limit"
 *
 * Reversing the underscore-to-space substitution gives the exact serde key
 * expected by training-analysis.js.
 */
function _buildLogFromGamesText(gamesText, summary) {
  const total = summary?.total_games || 0;
  const totalElapsedMs = summary?.total_elapsed_ms || 0;
  const lines = [];
  lines.push(JSON.stringify({ type: 'started', games_target: total, seed: 0 }));

  // em-dash is U+2014 (—)
  const headerRe = /^=== Game #(\d+) \u2014 (Player 1 wins|Player 2 wins|Draw) \(([^)]+)\) \u2014 (\d+) moves ===/;
  const gameEvents = [];
  for (const line of gamesText.split(/\r?\n/)) {
    const m = headerRe.exec(line);
    if (!m) continue;
    const index   = parseInt(m[1], 10);
    const outcome = m[2];
    const reason  = m[3]; // spaces instead of underscores
    const moves   = parseInt(m[4], 10);
    let winner = null;
    if (outcome === 'Player 1 wins') winner = 1;
    else if (outcome === 'Player 2 wins') winner = 2;
    // The Rust trainer replaces '_' with ' ' in the reason string.
    // Reverse it to recover the serde snake_case key.
    const end_reason = reason.replace(/ /g, '_');
    gameEvents.push({ index, winner, end_reason, moves });
  }

  gameEvents.sort((a, b) => a.index - b.index);
  const count = gameEvents.length;
  const avgElapsedMs = count > 0 ? Math.round(totalElapsedMs / count) : 0;

  for (const g of gameEvents) {
    lines.push(JSON.stringify({
      type: 'game_complete',
      index: g.index,
      moves: g.moves,
      winner: g.winner,
      end_reason: g.end_reason,
      elapsed_ms: avgElapsedMs,
    }));
  }

  lines.push(JSON.stringify({
    type: 'finished',
    games_played: count || total,
    elapsed_ms: totalElapsedMs,
  }));
  return lines;
}

/**
 * Build synthetic game_complete log.ndjson lines from a job_summary object.
 * Distributes wins/draws/losses proportionally. Uses avg_moves_per_game
 * and avg_elapsed_ms if available; otherwise uses 0.
 *
 * We emit a Started event first, then individual GameComplete events,
 * then a Finished event — matching the real log format so training-analysis
 * reads them correctly.
 *
 * Only used as a fallback when games.txt is not available in the stratbook.
 */
function _synthesizeLogFromSummary(summary) {
  const total = summary.total_games || 0;
  if (total === 0) return [];

  const p1Wins = summary.p1_wins || 0;
  const p2Wins = summary.p2_wins || 0;
  const draws = summary.draws || 0;
  const mctsIters = summary.mcts_iters || 0;
  const totalElapsedMs = summary.total_elapsed_ms || 0;
  const avgElapsedMs = total > 0 ? Math.round(totalElapsedMs / total) : 0;

  // Convert human-label reason keys (from end_reason_label() in the Rust
  // trainer) to serde snake_case keys expected by training-analysis.js.
  const reasonCounts = summary.end_reason_counts || {};
  const serdeReasonCounts = {};
  for (const [label, count] of Object.entries(reasonCounts)) {
    const key = REASON_LABEL_TO_SERDE[label] || label;
    serdeReasonCounts[key] = (serdeReasonCounts[key] || 0) + count;
  }
  // Pick the most common decisive (non-draw) reason.
  const decisiveReason = Object.entries(serdeReasonCounts)
    .filter(([k]) => !DRAW_REASON_KEYS.has(k))
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'capture_condition';
  // Pick the most common draw reason.
  const drawReason = Object.entries(serdeReasonCounts)
    .filter(([k]) => DRAW_REASON_KEYS.has(k))
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'move_limit';

  const lines = [];
  lines.push(JSON.stringify({ type: 'started', games_target: total, seed: 0 }));

  // Emit outcomes in order: p1 wins, p2 wins, draws.
  let idx = 0;
  for (let i = 0; i < p1Wins; i++) {
    idx++;
    lines.push(JSON.stringify({ type: 'game_complete', index: idx, moves: 0, winner: 1, end_reason: decisiveReason, elapsed_ms: avgElapsedMs }));
  }
  for (let i = 0; i < p2Wins; i++) {
    idx++;
    lines.push(JSON.stringify({ type: 'game_complete', index: idx, moves: 0, winner: 2, end_reason: decisiveReason, elapsed_ms: avgElapsedMs }));
  }
  for (let i = 0; i < draws; i++) {
    idx++;
    lines.push(JSON.stringify({ type: 'game_complete', index: idx, moves: 0, winner: null, end_reason: drawReason, elapsed_ms: avgElapsedMs }));
  }

  lines.push(JSON.stringify({ type: 'finished', games_played: total, elapsed_ms: totalElapsedMs }));
  return lines;
}

module.exports = {
  importUpload,
  validateBookJsonl,
  unpackJobZip,
  parseStratbook,
  _buildLogFromGamesText,
};
