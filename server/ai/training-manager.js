/**
 * Spawn, monitor, and resource-cap the Rust ai-engine training process.
 *
 * Design constraints:
 *   - At most ONE concurrent training job (configurable).
 *   - Process is spawned at low OS priority so it can never starve the
 *     game server even if it pegs a core.
 *   - 1 GB RAM + 1 core defaults; tunable via job request.
 *   - Job state is persisted in `ai_training_jobs` so the admin UI can
 *     reconnect after a refresh and see status.
 *   - Server restart marks any "running" job as "interrupted" (handled by
 *     `markInterruptedJobs()` called from server startup).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db_pool = require('../../configs/db');
const { exportGameRules, rulesPathFor, trainingDirFor } = require('./export-game-rules');
const trainerClient = require('./trainer-client');

const REMOTE_MODE = trainerClient.isEnabled();

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUST_BIN_DIR = path.join(REPO_ROOT, 'ai-engine-rs', 'target', 'release');
const RUST_BIN = path.join(
  RUST_BIN_DIR,
  process.platform === 'win32' ? 'ai-engine.exe' : 'ai-engine',
);

const MAX_CONCURRENT_JOBS = 1;

/**
 * If true, `startJob` and `resumeJob` reject new requests with a clear
 * error. Used by the CloudWatch low-CPU-credit auto-pause hook so we
 * stop accepting new training work when the EC2 instance is throttling.
 * Existing in-flight jobs are NOT killed — they continue with whatever
 * CPU is available.
 */
let _newJobsPaused = false;
let _newJobsPausedReason = null;

function pauseNewJobs(reason) {
  _newJobsPaused = true;
  _newJobsPausedReason = reason || 'paused by admin';
}
function resumeNewJobs() {
  _newJobsPaused = false;
  _newJobsPausedReason = null;
}
function isNewJobsPaused() {
  return { paused: _newJobsPaused, reason: _newJobsPausedReason };
}

/** In-memory live processes, keyed by jobId. Only used while the process
 * is alive; persistent state lives in the DB. */
const liveJobs = new Map(); // jobId -> { child, log: { gamesPlayed, lastEvent } }

function isRustBuilt() {
  // In remote mode, treat the binary as "available" if the trainer
  // service has it. We don't synchronously hit the network on every
  // call; the dashboard `getTrainerInfo` endpoint pings the service.
  if (REMOTE_MODE) return true;
  return fs.existsSync(RUST_BIN);
}

async function isRustBuiltRemote() {
  if (!REMOTE_MODE) return isRustBuilt();
  try { return await trainerClient.isRustBuilt(); } catch { return false; }
}

function jobsDirFor(gameTypeId, jobId) {
  return path.join(trainingDirFor(gameTypeId), 'jobs', String(jobId));
}

async function listJobs(limit = 50) {
  const [rows] = await db_pool.query(
    `SELECT id, game_type_id, status, games_target, games_played, mcts_iters,
            max_rss_mb, started_at, ended_at, error_message, created_by_user_id,
            source
     FROM ai_training_jobs
     ORDER BY id DESC
     LIMIT ?`,
    [Number(limit)],
  );
  // For jobs still in flight we only persist `games_played` to the DB on
  // exit, so the live row would otherwise read 0/N forever. Reconcile from
  // the log file (cheap — one tail per running job) before returning.
  for (const row of rows) {
    if (row.status !== 'running' && row.status !== 'queued') continue;
    try {
      const events = await tailLog(row.id, 5000);
      let played = row.games_played || 0;
      for (const ev of events) {
        if (ev && typeof ev.index === 'number') {
          if (ev.index > played) played = ev.index;
        }
      }
      row.games_played = played;
    } catch (_) { /* non-fatal */ }
  }
  return rows;
}

async function getJob(jobId) {
  const [rows] = await db_pool.query(
    `SELECT * FROM ai_training_jobs WHERE id = ? LIMIT 1`,
    [jobId],
  );
  return rows[0] || null;
}

async function tailLog(jobId, maxLines = 200) {
  if (REMOTE_MODE) {
    try { return await trainerClient.tailLog(jobId, maxLines); }
    catch (e) { console.warn('Remote tailLog failed:', e.message); return []; }
  }
  const job = await getJob(jobId);
  if (!job) return [];
  const logPath = path.join(jobsDirFor(job.game_type_id, jobId), 'log.ndjson');
  if (!fs.existsSync(logPath)) return [];

  // Real tail: read at most TAIL_BYTES from the end of the file instead of
  // slurping the whole thing into memory. Each game_complete event is ~300
  // bytes, so 64 KiB comfortably covers the default 50–200 line tails the
  // admin UI requests, and a 1 MiB cap covers the 5 000-line poll path
  // used by listJobs() for in-flight reconciliation. This avoids gigabytes
  // of disk reads per minute when admin polling hits long-running jobs
  // (the previous implementation `readFileSync(entire file)` was the main
  // source of EBS IOPS spikes on the trainer instance).
  const TAIL_BYTES = Math.min(
    Math.max(maxLines * 1024, 64 * 1024), // ~1 KiB headroom per line, min 64 KiB
    1 * 1024 * 1024,                      // hard cap 1 MiB
  );

  let fd;
  try {
    fd = fs.openSync(logPath, 'r');
    const { size } = fs.fstatSync(fd);
    const readLen = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, size - readLen);
    let text = buf.toString('utf8');
    // If we sliced into the middle of a line, drop the (likely truncated)
    // first partial line so JSON.parse below doesn't fail on it.
    if (size > readLen) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).map((l) => {
      try { return JSON.parse(l); } catch { return { type: 'raw', line: l }; }
    });
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

async function activeJobCount() {
  const [rows] = await db_pool.query(
    `SELECT COUNT(*) AS c FROM ai_training_jobs WHERE status IN ('queued','running')`,
  );
  return rows[0].c;
}

/**
 * Mark any jobs left in `running` from a previous server lifetime as
 * `interrupted`. Call once on startup.
 */
async function markInterruptedJobs() {
  // In remote mode the trainer service owns the lifecycle of running
  // processes — backend restarts must not invalidate them. The trainer
  // service performs its own markInterruptedJobs() on its startup.
  if (REMOTE_MODE) return;
  try {
    // Collect the jobs that are about to be interrupted so we can inspect
    // their logs afterward and restore the correct status if needed.
    const [toInterrupt] = await db_pool.query(
      `SELECT id, game_type_id FROM ai_training_jobs WHERE status IN ('running','queued')`,
    );

    await db_pool.query(
      `UPDATE ai_training_jobs
         SET status = 'interrupted', ended_at = NOW(),
             error_message = COALESCE(error_message, 'Server restarted while training was running')
       WHERE status IN ('running','queued')`,
    );

    // If the Rust process exited with OOM (code 2) and wrote an Aborted
    // event to the log before Node had a chance to persist the status, the
    // job would land here as 'interrupted' even though it was really
    // 'aborted_oom'. Correct the status now so the next resume will apply
    // the memory bump automatically.
    for (const row of toInterrupt) {
      try {
        const events = await tailLog(row.id, 20);
        const hadOom = events.some(
          (ev) => ev && ev.type === 'Aborted' &&
            typeof ev.reason === 'string' && ev.reason.includes('memory'),
        );
        if (hadOom) {
          await db_pool.query(
            `UPDATE ai_training_jobs
               SET status = 'aborted_oom',
                   error_message = 'Memory limit exceeded (status corrected from log on server restart)'
             WHERE id = ?`,
            [row.id],
          );
        }
      } catch (_) { /* non-fatal: log may not exist yet */ }
    }
  } catch (e) {
    // Table may not exist yet on the first run before migrations apply on
    // a fresh install; non-fatal.
    console.warn('markInterruptedJobs skipped:', e.message);
  }
}

/**
 * Spawn the Rust trainer for an existing job row. Used by both `startJob`
 * (fresh run) and `resumeJob` (continuation of a previously stopped run).
 *
 * The trainer appends to log.ndjson, so resuming just emits more events
 * after the existing ones. To keep `index` monotonic across the combined
 * log, the caller passes `startIndex` — the trainer adds it to its
 * internal counter before emitting GameComplete events.
 */
function spawnTrainer({
  jobId,
  gameTypeId,
  outDir,
  remainingGames,
  startIndex,
  mctsIters,
  checkpointEvery,
  maxRssMb,
  seed,
}) {
  const args = [
    'train',
    '--rules', rulesPathFor(gameTypeId),
    '--out', outDir,
    '--games', String(remainingGames),
    '--mcts-iters', String(mctsIters),
    '--checkpoint-every', String(checkpointEvery),
    '--max-rss-mb', String(maxRssMb),
    '--seed', String(seed),
    '--start-index', String(startIndex),
  ];

  // Single-thread the trainer so it consumes at most one core.
  const env = {
    ...process.env,
    RAYON_NUM_THREADS: '1',
    RUST_BACKTRACE: '0',
  };

  const child = spawn(RUST_BIN, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Lower scheduling priority. Best-effort; ignore failures.
  try {
    if (typeof os.setPriority === 'function') {
      const pri = process.platform === 'win32' ? 16 : 19;
      os.setPriority(child.pid, pri);
    }
  } catch (_) { /* non-fatal */ }

  const stderrPath = path.join(outDir, 'stderr.log');
  const stderrStream = fs.createWriteStream(stderrPath, { flags: 'a' });
  child.stderr.on('data', (chunk) => stderrStream.write(chunk));
  child.stdout.on('data', () => {});

  child.on('exit', async (code, signal) => {
    stderrStream.end();
    liveJobs.delete(jobId);
    let status = 'completed';
    let err = null;
    let played = 0;
    let logHadOom = false;
    try {
      const events = await tailLog(jobId, 100000);
      for (const ev of events) {
        if (ev && typeof ev.index === 'number') played = Math.max(played, ev.index);
        if (ev && ev.type === 'Aborted' && typeof ev.reason === 'string' &&
            ev.reason.includes('memory')) {
          logHadOom = true;
        }
      }
    } catch (_) { /* ignore */ }
    if (signal === 'SIGTERM' || signal === 'SIGINT' || signal === 'SIGKILL') {
      status = 'stopped';
    } else if (code !== 0) {
      // Exit code 2 alone is ambiguous — Rust's clap also uses code 2 for
      // argument-parse failures. Only treat it as OOM when the trainer
      // actually emitted an Aborted{reason: "...memory..."} event into the
      // log. Otherwise it's a regular failure (and the next resume should
      // NOT bump max_rss_mb).
      if (logHadOom) {
        status = 'aborted_oom';
      } else {
        status = 'failed';
      }
      err = `Exited with code ${code}${signal ? ` (signal ${signal})` : ''}`;
    }
    try {
      await db_pool.query(
        `UPDATE ai_training_jobs
           SET status = ?, ended_at = NOW(), games_played = ?, error_message = ?
         WHERE id = ?`,
        [status, played, err, jobId],
      );
    } catch (_) { /* ignore */ }
    try {
      const [[row]] = await db_pool.query(
        'SELECT game_type_id FROM ai_training_jobs WHERE id = ?', [jobId]);
      if (row) _invalidateModelMetaCache(row.game_type_id);
    } catch (_) { /* ignore */ }
  });

  child.on('error', async (e) => {
    liveJobs.delete(jobId);
    try {
      await db_pool.query(
        `UPDATE ai_training_jobs
           SET status = 'failed', ended_at = NOW(), error_message = ?
         WHERE id = ?`,
        [String(e && e.message || e), jobId],
      );
    } catch (_) { /* ignore */ }
  });

  liveJobs.set(jobId, { child });
  return child;
}

/**
 * Start a new training job. Returns the persisted row.
 *
 * Throws if:
 *   - The Rust binary isn't built.
 *   - Concurrent-job cap reached.
 *   - The game type has no starting positions.
 */
async function startJob({
  gameTypeId,
  games = 200,
  mctsIters = 200,
  maxRssMb = 2048,
  checkpointEvery = 25,
  seed = 0,
  userId = null,
}) {
  if (REMOTE_MODE) {
    // The trainer service performs the rules dump + DB insert + spawn.
    // Both backend and trainer-service share the same MySQL, so the new
    // row is immediately visible to admin UI polling against the backend.
    return await trainerClient.startJob({
      gameTypeId, games, mctsIters, maxRssMb, checkpointEvery, seed, userId,
    });
  }
  if (_newJobsPaused) {
    throw new Error(`Training is currently paused: ${_newJobsPausedReason || 'no reason given'}`);
  }
  if (!isRustBuilt()) {
    throw new Error(
      `Rust binary not built. Run: cd ai-engine-rs && cargo build --release  (expected at ${RUST_BIN})`,
    );
  }
  if ((await activeJobCount()) >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Already ${MAX_CONCURRENT_JOBS} training job(s) running. Stop them first.`);
  }

  // Dump rules to disk so the Rust binary can read them.
  const exportInfo = await exportGameRules(gameTypeId);
  if (exportInfo.positionCount === 0) {
    throw new Error(`Game type ${gameTypeId} has no starting pieces; cannot train.`);
  }

  const [insertRes] = await db_pool.query(
    `INSERT INTO ai_training_jobs
       (game_type_id, status, games_target, games_played, mcts_iters,
        max_rss_mb, checkpoint_every, seed, started_at, created_by_user_id, rules_path)
     VALUES (?, 'running', ?, 0, ?, ?, ?, ?, NOW(), ?, ?)`,
    [
      gameTypeId,
      games,
      mctsIters,
      maxRssMb,
      checkpointEvery,
      seed,
      userId,
      rulesPathFor(gameTypeId),
    ],
  );
  const jobId = insertRes.insertId;
  const outDir = jobsDirFor(gameTypeId, jobId);
  fs.mkdirSync(outDir, { recursive: true });

  spawnTrainer({
    jobId,
    gameTypeId,
    outDir,
    remainingGames: games,
    startIndex: 0,
    mctsIters,
    checkpointEvery,
    maxRssMb,
    seed,
  });

  _invalidateModelMetaCache(gameTypeId);
  return await getJob(jobId);
}

/**
 * Resume a previously stopped / interrupted / aborted_oom / failed job.
 * Spawns a new Rust process that runs the remaining `games_target -
 * games_played` games and appends to the same log.ndjson.
 *
 * Safe because each self-play game is independent — resuming just adds more
 * games' worth of data to the same training run. If the rules.json no
 * longer exists (or the game type was deleted), throws.
 */
async function resumeJob(jobId) {
  if (REMOTE_MODE) {
    // In remote mode, the trainer service owns the process lifecycle, but
    // our shared MySQL is the source of truth for job configuration.
    // Apply the OOM memory bump HERE (before delegating) so that when the
    // remote trainer reads the job row it already has the higher cap.
    // Without this the trainer would read the same max_rss_mb that caused
    // the original abort and OOM again on every resume.
    try {
      const jobForBump = await getJob(jobId);
      if (jobForBump && jobForBump.status === 'aborted_oom') {
        let maxRssMb = jobForBump.max_rss_mb || 1024;
        const bumped = Math.ceil((maxRssMb * 1.5) / 256) * 256;
        maxRssMb = Math.max(bumped, maxRssMb + 256); // at least +256 MiB
        await db_pool.query(
          'UPDATE ai_training_jobs SET max_rss_mb = ? WHERE id = ?',
          [maxRssMb, jobId],
        );
      } else if (jobForBump && jobForBump.status === 'interrupted') {
        // The job may have OOM'd and then been clobbered to 'interrupted'
        // by a server restart before the exit handler could persist the
        // status. Check the log tail for an Aborted event.
        try {
          const events = await trainerClient.tailLog(jobId, 20);
          const logHadOom = events.some(
            (ev) => ev && ev.type === 'Aborted' &&
              typeof ev.reason === 'string' && ev.reason.includes('memory'),
          );
          if (logHadOom) {
            let maxRssMb = jobForBump.max_rss_mb || 1024;
            const bumped = Math.ceil((maxRssMb * 1.5) / 256) * 256;
            maxRssMb = Math.max(bumped, maxRssMb + 256);
            await db_pool.query(
              'UPDATE ai_training_jobs SET max_rss_mb = ? WHERE id = ?',
              [maxRssMb, jobId],
            );
          }
        } catch (_) { /* non-fatal: log fetch may fail */ }
      }
    } catch (bumpErr) {
      // Non-fatal — the remote service will still attempt the resume
      console.warn(`[resumeJob] OOM bump for job ${jobId} failed:`, bumpErr.message);
    }
    return await trainerClient.resumeJob(jobId);
  }
  if (_newJobsPaused) {
    throw new Error(`Training is currently paused: ${_newJobsPausedReason || 'no reason given'}`);
  }
  if (!isRustBuilt()) {
    throw new Error(`Rust binary not built (expected at ${RUST_BIN})`);
  }
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === 'running' || job.status === 'queued') {
    throw new Error(`Job ${jobId} is already ${job.status}`);
  }
  if (job.status === 'completed') {
    throw new Error(`Job ${jobId} already completed (${job.games_played}/${job.games_target}); start a new job to train more`);
  }
  if (liveJobs.has(jobId)) {
    throw new Error(`Job ${jobId} is already running on this server`);
  }
  if ((await activeJobCount()) >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Already ${MAX_CONCURRENT_JOBS} training job(s) running. Stop them first.`);
  }

  // Reconcile games_played from the log in case the DB row lagged behind
  // (we update games_played on exit, but if the process was killed without
  // an exit handler running — e.g. server crash — the row may be 0).
  const events = await tailLog(jobId, 100000);
  let actualPlayed = job.games_played || 0;
  for (const ev of events) {
    if (ev && typeof ev.index === 'number') {
      if (ev.index > actualPlayed) actualPlayed = ev.index;
    }
  }
  const remaining = (job.games_target || 0) - actualPlayed;
  if (remaining <= 0) {
    throw new Error(`Nothing to resume — ${actualPlayed}/${job.games_target} games already played`);
  }

  // Refresh the rules dump so any rule edits since the original run apply.
  const exportInfo = await exportGameRules(job.game_type_id);
  if (exportInfo.positionCount === 0) {
    throw new Error(`Game type ${job.game_type_id} has no starting pieces; cannot resume.`);
  }

  const outDir = jobsDirFor(job.game_type_id, jobId);
  fs.mkdirSync(outDir, { recursive: true });

  // Detect OOM either from the stored status or from an Aborted event in
  // the log. The latter catches the case where the server restarted before
  // the exit handler persisted 'aborted_oom', leaving the job as
  // 'interrupted' even though Rust exited with code 2.
  const logHadOom = events.some(
    (ev) => ev && ev.type === 'Aborted' &&
      typeof ev.reason === 'string' && ev.reason.includes('memory'),
  );

  // If the previous run was killed by the RAM guard, bump the limit so the
  // resumed run has headroom. Round up to the nearest 256 MiB boundary.
  let maxRssMb = job.max_rss_mb || 1024;
  if (job.status === 'aborted_oom' || logHadOom) {
    const bumped = Math.ceil((maxRssMb * 1.5) / 256) * 256;
    maxRssMb = Math.max(bumped, maxRssMb + 256); // at least +256 MiB
    // Persist the raised cap so future resumes (if any) also start higher.
    await db_pool.query(
      `UPDATE ai_training_jobs SET max_rss_mb = ? WHERE id = ?`,
      [maxRssMb, jobId],
    );
  }

  await db_pool.query(
    `UPDATE ai_training_jobs
       SET status = 'running', ended_at = NULL, error_message = NULL,
           games_played = ?
     WHERE id = ?`,
    [actualPlayed, jobId],
  );
  _invalidateModelMetaCache(job.game_type_id);

  // Pick a fresh sub-seed so resumed runs aren't a deterministic replay of
  // the killed run. We mix the original seed with the current resume point.
  // IMPORTANT: mask to 64 bits — clap parses --seed as u64 and rejects
  // (exit code 2) if the value exceeds u64::MAX. Without the mask the XOR
  // of seed * golden-ratio constant overflows u64 for actualPlayed >= 2,
  // and Rust's clap exits with code 2 — which our exit handler then
  // mis-reports as 'aborted_oom'. That's why every resume after a few
  // games immediately flipped to aborted_oom status.
  const U64_MASK = 0xFFFFFFFFFFFFFFFFn;
  const resumeSeed =
    ((BigInt(job.seed || 0) ^ (BigInt(actualPlayed) * 0x9E3779B97F4A7C15n)) & U64_MASK)
      .toString();

  spawnTrainer({
    jobId,
    gameTypeId: job.game_type_id,
    outDir,
    remainingGames: remaining,
    startIndex: actualPlayed,
    mctsIters: job.mcts_iters,
    checkpointEvery: job.checkpoint_every,
    maxRssMb,
    seed: resumeSeed,
  });

  return await getJob(jobId);
}

/**
 * Look up the latest training metadata for a game type. Used by the
 * "Adaptive" bot difficulty to scale its strength based on how much
 * training data exists for the specific game variant.
 *
 * Aggregates across all jobs for the game type:
 *   - totalGamesPlayed: sum of `games_played` across non-failed jobs
 *   - latestJobId / latestJobStatus / latestJobAt
 *   - latestCheckpointPath: newest model-*.bin file across all jobs (if any)
 *
 * Returns null if no jobs exist.
 */
async function getModelMetaForGameType(gameTypeId) {
  const gid = parseInt(gameTypeId, 10);
  if (!Number.isFinite(gid)) return null;

  // Cache the result for a short TTL. The Play page hits this endpoint
  // every time a user picks a game type, and the underlying answer only
  // changes when a training job runs to completion. Without the cache,
  // every page interaction triggers a DB query plus a `readdirSync` +
  // `statSync` over every model checkpoint on disk.
  const now = Date.now();
  const cached = _modelMetaCache.get(gid);
  if (cached && now - cached.at < MODEL_META_TTL_MS) return cached.value;

  let rows;
  try {
    [rows] = await db_pool.query(
      `SELECT id, status, games_played, started_at, ended_at
         FROM ai_training_jobs
        WHERE game_type_id = ?
        ORDER BY id DESC`,
      [gid],
    );
  } catch (e) {
    // Table may not exist yet (fresh install before migrations).
    return null;
  }
  if (!rows || rows.length === 0) {
    _modelMetaCache.set(gid, { at: now, value: null });
    return null;
  }

  let totalGamesPlayed = 0;
  for (const r of rows) {
    if (r.status === 'failed') continue;
    totalGamesPlayed += r.games_played || 0;
  }
  // NOTE: We intentionally do NOT reconcile in-flight progress from the
  // log files here. The Adaptive-bot button only needs a rough "trained on
  // ~N games" count, and the DB row is updated at every checkpoint. Reading
  // every running job's log on every Play-page interaction was a major
  // EBS IOPS contributor.

  // Find newest checkpoint across every job dir for this game type. In
  // REMOTE_MODE the trainer host owns the files, so the local directories
  // never exist on the API host — skip the disk scan entirely.
  let latestCheckpointPath = null;
  if (!REMOTE_MODE) {
    let latestCheckpointMtime = 0;
    for (const r of rows) {
      const dir = jobsDirFor(gid, r.id);
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir);
        for (const name of entries) {
          if (!/^model-\d+\.bin$/.test(name)) continue;
          const full = path.join(dir, name);
          const st = fs.statSync(full);
          if (st.mtimeMs > latestCheckpointMtime) {
            latestCheckpointMtime = st.mtimeMs;
            latestCheckpointPath = full;
          }
        }
      } catch (_) { /* skip */ }
    }
  }

  const latest = rows[0];
  const value = {
    gameTypeId: gid,
    totalGamesPlayed,
    latestJobId: latest.id,
    latestJobStatus: latest.status,
    latestJobAt: latest.ended_at || latest.started_at,
    latestCheckpointPath,
    // In REMOTE_MODE we can't see the checkpoint files; fall back to
    // games_played as the "has model" signal.
    hasModel: latestCheckpointPath != null || totalGamesPlayed > 0,
  };
  _modelMetaCache.set(gid, { at: now, value });
  return value;
}

// In-memory cache for getModelMetaForGameType. Cleared automatically when
// a training job's status changes via the existing job lifecycle hooks
// (or on TTL expiration).
const _modelMetaCache = new Map();
const MODEL_META_TTL_MS = 60 * 1000; // 1 minute
function _invalidateModelMetaCache(gameTypeId) {
  if (gameTypeId == null) _modelMetaCache.clear();
  else _modelMetaCache.delete(parseInt(gameTypeId, 10));
}

/** Stop a running job. Returns true if a live process was signalled. */
function stopJob(jobId) {
  if (REMOTE_MODE) {
    // Fire-and-forget; the trainer service updates the DB row to 'stopped'.
    return trainerClient.stopJob(jobId).catch((e) => {
      console.warn('Remote stopJob failed:', e.message);
      return false;
    });
  }
  const live = liveJobs.get(jobId);
  if (!live) return false;
  try {
    live.child.kill('SIGTERM');
    return true;
  } catch (_) {
    return false;
  }
}

/** Snapshot useful for the admin UI: status row + last few log events. */
async function getJobStatus(jobId) {
  const job = await getJob(jobId);
  if (!job) return null;
  const events = await tailLog(jobId, 50);
  // Update games_played live from the log if the row hasn't caught up yet.
  let liveProgress = job.games_played || 0;
  for (const ev of events) {
    if (ev && typeof ev.index === 'number') liveProgress = Math.max(liveProgress, ev.index);
  }
  return {
    job,
    liveProgress,
    events,
    isLive: REMOTE_MODE ? (job.status === 'running') : liveJobs.has(jobId),
  };
}

module.exports = {
  RUST_BIN,
  REMOTE_MODE,
  isRustBuilt,
  isRustBuiltRemote,
  listJobs,
  getJob,
  getJobStatus,
  tailLog,
  startJob,
  resumeJob,
  stopJob,
  markInterruptedJobs,
  getModelMetaForGameType,
  pauseNewJobs,
  resumeNewJobs,
  isNewJobsPaused,
  MAX_CONCURRENT_JOBS,
  _invalidateModelMetaCache,
};
