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

const DRAW_REASONS = [
  'stalemate', 'move_limit', 'move_cap_rollout',
  'rollout_cap', 'no_move',
];

/**
 * Pure aggregator. Takes a list of game_complete events (possibly merged
 * from many jobs) and produces a summary object.
 */
function summarize(events, jobMeta) {
  const total = events.length;
  let wins1 = 0, wins2 = 0, draws = 0;
  let totalMoves = 0, totalElapsed = 0;
  let minMoves = Infinity, maxMoves = 0;
  const drawBreakdown = { stalemate: 0, move_limit: 0, move_cap_rollout: 0,
    rollout_cap: 0, no_move: 0, royal_capture: 0, unknown: 0 };
  const decisiveBy = { checkmate: 0, royal_capture: 0, other: 0 };

  for (const ev of events) {
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
      else if (r === 'royal_capture') decisiveBy.royal_capture++;
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
    note = `Side ${heavy} wins ${(Math.max(winShare1, winShare2) * 100).toFixed(1)}% of decisive games — the matchup may be heavily favored. Consider mirroring the starting position or rebalancing pieces.`;
  } else if (severity === 'notable') {
    const heavy = wins1 > wins2 ? 1 : 2;
    note = `Side ${heavy} has a meaningful edge (${(Math.max(winShare1, winShare2) * 100).toFixed(1)}% of decisive games).`;
  } else if (drawShare >= 0.5) {
    note = `${(drawShare * 100).toFixed(1)}% of games drew — the rules may make decisive results hard to reach.`;
  }

  return {
    totalGames: total,
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
 */
function computeAnalysis(gameTypeId) {
  const jobs = listJobLogs(gameTypeId);
  const allEvents = [];
  const jobMeta = [];
  for (const j of jobs) {
    const evs = readGameEvents(j.logPath);
    allEvents.push(...evs);
    jobMeta.push({ jobId: j.jobId, games: evs.length });
  }
  return summarize(allEvents, jobMeta);
}

/**
 * REMOTE_MODE-aware: in remote mode, ask the trainer-service which has
 * filesystem access; otherwise compute locally.
 */
async function computeAnalysisAuto(gameTypeId) {
  if (trainerClient.isEnabled()) {
    const r = await trainerClient.fetchAnalysis(gameTypeId);
    return r && r.summary ? r.summary : computeAnalysis(gameTypeId);
  }
  return computeAnalysis(gameTypeId);
}

function makeSlug() {
  return crypto.randomBytes(9).toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase();
}

/**
 * Recompute and upsert the analysis row. Preserves the existing
 * visibility/slug if a row already exists; otherwise stores as `private`.
 */
async function regenerateAndStore(gameTypeId, userId) {
  const summary = await computeAnalysisAuto(gameTypeId);
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

module.exports = {
  computeAnalysis,
  computeAnalysisAuto,
  summarize,
  regenerateAndStore,
  setVisibility,
  getStoredAnalysis,
  getAnalysisBySlug,
};
