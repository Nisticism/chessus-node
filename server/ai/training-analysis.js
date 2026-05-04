/**
 * AI training analysis: aggregates per-game outcomes from every training
 * job's `log.ndjson` for a game type into a single summary that highlights
 * balance issues (e.g. "side 1 wins 80%"), draw-type breakdown, and
 * sample size.
 *
 * Also persists the result to `ai_training_analyses` and exposes
 * visibility-aware getters for the public-facing analysis page.
 *
 * Storage shape (summary_json column):
 *   {
 *     totalGames, perSide: { 1: { wins, lossRate }, 2: { wins, lossRate } },
 *     decisive: <count>, draws: <count>,
 *     drawBreakdown: { stalemate, move_limit, move_cap_rollout,
 *                      rollout_cap, no_move, royal_capture, unknown },
 *     decisiveBy: { checkmate, royal_capture, other },
 *     avgMoves, minMoves, maxMoves,
 *     avgElapsedMs,
 *     jobCount, jobs: [ { id, source, games, ... } ],
 *     balance: { winShare1, winShare2, drawShare, imbalance, severity, note },
 *     generatedAt
 *   }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db_pool = require('../../configs/db');
const { trainingDirFor } = require('./export-game-rules');
const trainerClient = require('./trainer-client');

function listJobLogs(gameTypeId) {
  const root = path.join(trainingDirFor(gameTypeId), 'jobs');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((name) => ({ jobId: Number(name), dir: path.join(root, name) }))
    .filter((j) => Number.isFinite(j.jobId) && fs.statSync(j.dir).isDirectory())
    .map((j) => ({ ...j, logPath: path.join(j.dir, 'log.ndjson') }))
    .filter((j) => fs.existsSync(j.logPath));
}

function readGameEvents(logPath) {
  const out = [];
  let text;
  try { text = fs.readFileSync(logPath, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && ev.type === 'game_complete') out.push(ev);
    } catch (_) { /* skip malformed lines */ }
  }
  return out;
}

/**
 * Synthesize game-complete events from a book.jsonl file.
 *
 * Used for uploaded jobs that have no log.ndjson (only book.jsonl).
 * At ply 1 the mover is always player 1, so `r` encodes the game result
 * from player 1's perspective: "W" = P1 won, "L" = P2 won, "D" = draw.
 *
 * The synthetic events carry `end_reason: "unknown"` (a non-empty string)
 * so they pass the filterLegacy check without inflating the
 * "legacy excluded" counter.  Move counts and elapsed time will be 0.
 */
function readEventsFromBook(bookPath) {
  const out = [];
  let text;
  try { text = fs.readFileSync(bookPath, 'utf8'); } catch { return out; }
  let index = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    // p=0 records represent the FIRST ply of each game (ply counting starts
    // at 0, not 1). At ply 0 the mover is always player 1, so:
    //   r="W" → player 1 won, r="L" → player 2 won, r="D" → draw.
    if (rec.p !== 0 && rec.p !== '0') continue;
    index++;
    let winner = null;
    if (rec.r === 'W') winner = 1;       // player 1 won
    else if (rec.r === 'L') winner = 2;  // player 2 won
    // 'D' → winner stays null (draw)
    out.push({
      type: 'game_complete',
      index,
      moves: 0,
      winner,
      end_reason: 'unknown',
      elapsed_ms: 0,
    });
  }
  return out;
}

const DRAW_REASONS = [
  'stalemate', 'move_limit', 'move_cap_rollout',
  'rollout_cap', 'no_move', 'repetition', 'insufficient_material',
  // lose_all_pieces can be a draw if both sides reach 0 simultaneously
  'lose_all_pieces',
];

/**
 * Pure aggregator. Takes a list of game_complete events (possibly merged
 * from many jobs) and produces a summary object.
 *
 * Options:
 *   - filterLegacy (default true): drop events without an `end_reason`
 *     field. Those come from trainer runs that pre-date the draw-reason
 *     instrumentation and produce a meaningless `winner: null` for every
 *     non-checkmate, which poisons the balance/draw numbers. We still
 *     report how many were excluded via `legacyExcluded`.
 */
function summarize(events, jobMeta, { filterLegacy = true } = {}) {
  const eligible = filterLegacy
    ? events.filter((ev) => typeof ev.end_reason === 'string' && ev.end_reason.length > 0)
    : events;
  const legacyExcluded = events.length - eligible.length;
  const total = eligible.length;
  let wins1 = 0, wins2 = 0, draws = 0;
  let totalMoves = 0, totalElapsed = 0;
  let minMoves = Infinity, maxMoves = 0;
  const drawBreakdown = { stalemate: 0, move_limit: 0, move_cap_rollout: 0,
    rollout_cap: 0, no_move: 0, royal_capture: 0,
    repetition: 0, insufficient_material: 0,
    lose_all_pieces: 0, unknown: 0 };
  const decisiveBy = {
    checkmate: 0,
    lose_all_pieces: 0,
    stalemate_win: 0,
    no_moves_loss: 0,
    capture_condition: 0,
    squares_condition: 0,
    royal_capture: 0,
    promotion: 0,
    other: 0,
  };

  for (const ev of eligible) {
    const moves = Number(ev.moves) || 0;
    totalMoves += moves;
    if (moves > 0) {
      if (moves < minMoves) minMoves = moves;
      if (moves > maxMoves) maxMoves = moves;
    }
    totalElapsed += Number(ev.elapsed_ms) || 0;

    if (ev.winner === 1) wins1++;
    else if (ev.winner === 2) wins2++;
    else {
      draws++;
      const r = ev.end_reason || 'unknown';
      if (DRAW_REASONS.includes(r)) drawBreakdown[r]++;
      else if (r === 'royal_capture') drawBreakdown.royal_capture++;
      else drawBreakdown.unknown++;
    }

    if (ev.winner === 1 || ev.winner === 2) {
      const r = ev.end_reason;
      if (r === 'checkmate') decisiveBy.checkmate++;
      else if (r === 'lose_all_pieces') decisiveBy.lose_all_pieces++;
      else if (r === 'stalemate_win') decisiveBy.stalemate_win++;
      else if (r === 'no_moves_loss') decisiveBy.no_moves_loss++;
      else if (r === 'capture_condition') decisiveBy.capture_condition++;
      else if (r === 'squares_condition') decisiveBy.squares_condition++;
      else if (r === 'royal_capture') decisiveBy.royal_capture++;
      else if (r === 'promotion') decisiveBy.promotion++;
      else decisiveBy.other++;
    }
  }

  const decisive = wins1 + wins2;
  const winShare1 = total ? wins1 / total : 0;
  const winShare2 = total ? wins2 / total : 0;
  const drawShare = total ? draws / total : 0;

  // Imbalance: |P1share - P2share| over (P1share + P2share). 0 = perfectly
  // balanced amongst decisive games; 1 = one side wins everything.
  const denom = winShare1 + winShare2;
  const imbalance = denom > 0 ? Math.abs(winShare1 - winShare2) / denom : 0;
  let severity = 'balanced';
  if (imbalance >= 0.5) severity = 'severe';
  else if (imbalance >= 0.25) severity = 'notable';
  else if (imbalance >= 0.1) severity = 'mild';

  let note = null;
  if (total < 50) {
    note = `Only ${total} game${total === 1 ? '' : 's'} in the dataset — run more training before drawing conclusions.`;
  } else if (severity === 'severe') {
    const heavy = wins1 > wins2 ? 1 : 2;
    note = `Player ${heavy} wins ${(Math.max(winShare1, winShare2) * 100).toFixed(1)}% of decisive games — the matchup may be heavily favored. Consider mirroring the starting position or rebalancing pieces.`;
  } else if (severity === 'notable') {
    const heavy = wins1 > wins2 ? 1 : 2;
    note = `Player ${heavy} has a meaningful edge (${(Math.max(winShare1, winShare2) * 100).toFixed(1)}% of decisive games).`;
  } else if (drawShare >= 0.5) {
    note = `${(drawShare * 100).toFixed(1)}% of games drew — the rules may make decisive results hard to reach.`;
  }

  return {
    totalGames: total,
    totalGamesRaw: events.length,
    legacyExcluded,
    filteredLegacy: filterLegacy,
    decisive,
    draws,
    perSide: {
      1: { wins: wins1, winRate: total ? wins1 / total : 0 },
      2: { wins: wins2, winRate: total ? wins2 / total : 0 },
    },
    drawBreakdown,
    decisiveBy,
    avgMoves: total ? totalMoves / total : 0,
    minMoves: minMoves === Infinity ? 0 : minMoves,
    maxMoves,
    avgElapsedMs: total ? totalElapsed / total : 0,
    jobCount: jobMeta.length,
    jobs: jobMeta,
    balance: { winShare1, winShare2, drawShare, imbalance, severity, note },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compute a fresh summary from disk for a given game type.
 *
 * Log files are the source of truth for whether a job has data — a job
 * whose process was killed before its exit handler ran will have
 * games_played = 0 in the DB even though its log.ndjson contains valid
 * game_complete events.  Filtering by games_played > 0 would silently
 * exclude all such jobs and produce a bogus 0-game summary.
 *
 * The "Clear Data" action deletes the log file on disk, so cleared jobs
 * naturally disappear from the scan below and are never counted.
 *
 * Uploaded jobs (source='uploaded') may only have book.jsonl and no
 * log.ndjson (e.g. when a bare book.jsonl was imported without a zip that
 * included the log).  For those, we synthesise game-complete events from
 * the book's ply-1 records so their win/loss/draw counts still appear in
 * the balance report.  Move-count and elapsed-time stats will be 0 for
 * those synthetic events, but the balance numbers are accurate.
 */
async function computeAnalysis(gameTypeId, opts = {}) {
  const root = path.join(trainingDirFor(gameTypeId), 'jobs');
  const diskJobIds = new Set();
  const allEvents = [];
  const jobMeta = [];

  if (fs.existsSync(root)) {
    const jobDirs = fs.readdirSync(root)
      .map((name) => ({ jobId: Number(name), dir: path.join(root, name) }))
      .filter((j) => {
        if (!Number.isFinite(j.jobId) || j.jobId <= 0) return false;
        try { return fs.statSync(j.dir).isDirectory(); } catch { return false; }
      });

    for (const j of jobDirs) {
      const logPath  = path.join(j.dir, 'log.ndjson');
      const bookPath = path.join(j.dir, 'book.jsonl');

      if (fs.existsSync(logPath)) {
        // Primary: real game_complete events from the progress log.
        const evs = readGameEvents(logPath);
        if (evs.length === 0) continue; // log exists but no events (crashed immediately)
        allEvents.push(...evs);
        jobMeta.push({ jobId: j.jobId, games: evs.length, source: 'log' });
        diskJobIds.add(j.jobId);
      } else if (fs.existsSync(bookPath)) {
        // Fallback: uploaded job without log.ndjson — synthesise from book.
        const evs = readEventsFromBook(bookPath);
        if (evs.length === 0) continue;
        allEvents.push(...evs);
        jobMeta.push({ jobId: j.jobId, games: evs.length, source: 'book' });
        diskJobIds.add(j.jobId);
      }
      // No data files at all — skip.
    }
  }

  // DB fallback: jobs the DB knows about but whose disk data is missing
  // (e.g. the trainer-service was redeployed and ai-training/ was not
  // retained, or the job ran on a different machine). We cannot reconstruct
  // win/loss/draw outcomes, but we can count the games from games_played
  // and surface them as context so the analysis doesn't silently show 0.
  let dbOnlyGames = 0;
  let dbOnlyJobCount = 0;
  try {
    const [rows] = await db_pool.query(
      `SELECT id, games_played FROM ai_training_jobs
       WHERE game_type_id = ? AND games_played > 0 AND status != 'failed'`,
      [gameTypeId],
    );
    for (const r of rows) {
      if (!diskJobIds.has(r.id)) {
        const gp = r.games_played || 0;
        dbOnlyGames += gp;
        dbOnlyJobCount++;
        // Include in jobMeta so jobCount reflects reality.
        jobMeta.push({ jobId: r.id, games: gp, source: 'db_only' });
      }
    }
  } catch (_) {
    // DB unavailable — skip fallback silently.
  }

  const summary = summarize(allEvents, jobMeta, opts);
  if (dbOnlyGames > 0) {
    summary.dbOnlyGames = dbOnlyGames;
    summary.dbOnlyJobCount = dbOnlyJobCount;
  }
  return summary;
}

/**
 * REMOTE_MODE-aware: in remote mode, ask the trainer-service which has
 * filesystem access; otherwise compute locally.
 */
async function computeAnalysisAuto(gameTypeId, opts = {}) {
  if (trainerClient.isEnabled()) {
    const r = await trainerClient.fetchAnalysis(gameTypeId, opts);
    return r && r.summary ? r.summary : computeAnalysis(gameTypeId, opts);
  }
  return computeAnalysis(gameTypeId, opts);
}

function makeSlug() {
  return crypto.randomBytes(9).toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase();
}

/**
 * Recompute and upsert the analysis row. Preserves the existing
 * visibility/slug if a row already exists; otherwise stores as `private`.
 */
async function regenerateAndStore(gameTypeId, userId, opts = {}) {
  const summary = await computeAnalysisAuto(gameTypeId, opts);

  // Bake relevant game-type rule flags into the summary so display layers can
  // filter out inapplicable draw/win types without a separate DB fetch.
  try {
    const [[gt]] = await db_pool.query(
      `SELECT stalemate_draw_condition, stalemate_win_condition
       FROM game_types WHERE id = ? LIMIT 1`,
      [gameTypeId],
    );
    if (gt) {
      summary.stalemate_draw_condition = gt.stalemate_draw_condition !== 0 && gt.stalemate_draw_condition !== false;
      summary.stalemate_win_condition  = !!gt.stalemate_win_condition;
    }
  } catch (_) {
    // Non-fatal — callers should treat missing flags as "enabled" (safe default).
  }

  const summaryJson = JSON.stringify(summary);
  const [existing] = await db_pool.query(
    `SELECT id, visibility, slug FROM ai_training_analyses WHERE game_type_id = ? LIMIT 1`,
    [gameTypeId],
  );
  if (existing.length === 0) {
    await db_pool.query(
      `INSERT INTO ai_training_analyses (game_type_id, summary_json, visibility, generated_by_user_id)
       VALUES (?, ?, 'private', ?)`,
      [gameTypeId, summaryJson, userId || null],
    );
  } else {
    await db_pool.query(
      `UPDATE ai_training_analyses
         SET summary_json = ?, generated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE game_type_id = ?`,
      [summaryJson, userId || null, gameTypeId],
    );
  }
  return getStoredAnalysis(gameTypeId);
}

/**
 * Update visibility (and slug if going public). Does NOT recompute.
 */
async function setVisibility(gameTypeId, visibility) {
  if (!['private', 'creator', 'public'].includes(visibility)) {
    throw new Error('Invalid visibility');
  }
  const [existing] = await db_pool.query(
    `SELECT slug FROM ai_training_analyses WHERE game_type_id = ? LIMIT 1`,
    [gameTypeId],
  );
  if (existing.length === 0) {
    throw new Error('Analysis does not exist yet — generate it first');
  }
  let slug = existing[0].slug;
  if (visibility === 'public' && !slug) {
    // Try a few times in case of slug collision (very unlikely).
    for (let i = 0; i < 5; i++) {
      const candidate = makeSlug();
      const [conflict] = await db_pool.query(
        `SELECT id FROM ai_training_analyses WHERE slug = ? LIMIT 1`,
        [candidate],
      );
      if (conflict.length === 0) { slug = candidate; break; }
    }
  }
  await db_pool.query(
    `UPDATE ai_training_analyses SET visibility = ?, slug = ? WHERE game_type_id = ?`,
    [visibility, slug, gameTypeId],
  );
  return getStoredAnalysis(gameTypeId);
}

async function getStoredAnalysis(gameTypeId) {
  const [rows] = await db_pool.query(
    `SELECT id, game_type_id, summary_json, visibility, slug,
            generated_by_user_id, generated_at, updated_at
     FROM ai_training_analyses WHERE game_type_id = ? LIMIT 1`,
    [gameTypeId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  let summary;
  try { summary = JSON.parse(row.summary_json); } catch { summary = null; }
  return {
    id: row.id,
    gameTypeId: row.game_type_id,
    visibility: row.visibility,
    slug: row.slug,
    generatedByUserId: row.generated_by_user_id,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    summary,
  };
}

async function getAnalysisBySlug(slug) {
  const [rows] = await db_pool.query(
    `SELECT id, game_type_id, summary_json, visibility, slug,
            generated_by_user_id, generated_at, updated_at
     FROM ai_training_analyses WHERE slug = ? LIMIT 1`,
    [slug],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.visibility !== 'public') return null;
  let summary;
  try { summary = JSON.parse(row.summary_json); } catch { summary = null; }
  return {
    id: row.id,
    gameTypeId: row.game_type_id,
    visibility: row.visibility,
    slug: row.slug,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    summary,
  };
}

// Cheap existence + visibility check that avoids reading the (potentially
// large) summary_json LONGTEXT column. Used by the game detail page to
// decide whether to show the "View AI analysis" link without paying the
// cost of fetching/parsing the full snapshot on every page load.
async function getAnalysisExistence(gameTypeId) {
  const [rows] = await db_pool.query(
    `SELECT visibility, slug FROM ai_training_analyses
       WHERE game_type_id = ? LIMIT 1`,
    [gameTypeId],
  );
  if (rows.length === 0) return null;
  return { visibility: rows[0].visibility, slug: rows[0].slug };
}

/**
 * Delete the cached analysis row for a game type. Used after every job
 * for the game type has been deleted/cleared so we don't surface a
 * stale (and possibly schema-mismatched) summary to the admin UI.
 */
async function deleteAnalysis(gameTypeId) {
  await db_pool.query(
    `DELETE FROM ai_training_analyses WHERE game_type_id = ?`,
    [gameTypeId],
  );
}

module.exports = {
  computeAnalysis,
  computeAnalysisAuto,
  summarize,
  regenerateAndStore,
  setVisibility,
  getStoredAnalysis,
  getAnalysisBySlug,
  getAnalysisExistence,
  deleteAnalysis,
};
