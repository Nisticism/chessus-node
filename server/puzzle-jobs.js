/*
 * Background puzzle checks: a small job queue that runs each check in a worker
 * thread (puzzle-verify-worker.js).
 *
 * Two lanes, each running ONE job at a time, so a long staff search never holds
 * up a creator waiting on a save-time check (or the other way round):
 *
 *   interactive  the builder's "Check puzzle" (seconds to a couple of minutes)
 *   long         staff uniqueness searches from the admin tab, which run for as
 *                long as they need - hours, for a deep puzzle in a wide game
 *
 * Limits, so neither costs the rest of the site:
 *   - Memory: each worker's heap is capped (resourceLimits). A search that
 *     outgrows it is stopped and the job fails, rather than the server.
 *   - CPU: the search runs at a duty cycle (a share of wall-clock time),
 *     pausing between slices of work. The long lane runs at a lower one.
 *   - Time: an interactive job has a wall-clock limit; a long one has whatever
 *     limit staff chose (none by default) and can be cancelled.
 *
 * All of it can be tuned per server with the PUZZLE_* environment variables.
 *
 * Jobs live in memory for JOB_TTL_MS after they finish, long enough for the
 * page that started one to collect the result. A long job's result is also
 * recorded by its onDone (puzzle_verification_runs), so it survives that.
 */
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Worker } = require('worker_threads');

const LANES = {
  interactive: {
    heapMb: Number(process.env.PUZZLE_WORKER_HEAP_MB) || 384,
    dutyCycle: Number(process.env.PUZZLE_WORKER_DUTY_CYCLE) || 0.7,
  },
  long: {
    heapMb: Number(process.env.PUZZLE_LONG_HEAP_MB) || 512,
    dutyCycle: Number(process.env.PUZZLE_LONG_DUTY_CYCLE) || 0.5,
  },
};
const MAX_CONCURRENT = 1; // per lane
const JOB_TTL_MS = 30 * 60 * 1000;

const jobs = new Map();
const lanes = Object.fromEntries(Object.keys(LANES).map((k) => [k, { queue: [], running: 0 }]));

/** The caps in force, for the admin tab to show. */
function limits() {
  return {
    cpus: os.cpus().length,
    lanes: Object.fromEntries(Object.entries(LANES).map(([k, v]) => [k, {
      heapMb: v.heapMb, dutyCycle: v.dutyCycle, concurrent: MAX_CONCURRENT,
      queued: lanes[k].queue.length, running: lanes[k].running,
    }])),
  };
}

function publicView(job) {
  if (!job) return null;
  const now = Date.now();
  const elapsedMs = job.startedAt ? (job.finishedAt || now) - job.startedAt : 0;
  /*
   * The time left, from progress: the first step of a line dominates the cost
   * (it searches deepest), so the estimate follows how far through its first
   * moves it is. Unknown until it has done some work.
   */
  let etaMs = null;
  const p = job.progress;
  if (job.state === 'running' && p && p.total) {
    const fraction = p.step > 1 ? 0.95 : Math.min(0.95, p.done / p.total);
    if (fraction > 0.02) etaMs = Math.max(0, Math.round(elapsedMs * (1 - fraction) / fraction));
  }
  return {
    id: job.id,
    kind: job.kind,
    lane: job.lane,
    state: job.state,
    queuePosition: job.state === 'queued' ? lanes[job.lane].queue.indexOf(job) + 1 : 0,
    progress: job.progress,
    elapsedMs,
    etaMs,
    result: job.state === 'done' ? job.publicResult : undefined,
    error: job.state === 'failed' || job.state === 'cancelled' ? job.error : undefined,
  };
}

/*
 * Exactly once per job. A worker's result arrives as a message, and its exit
 * event follows while the result is still being recorded (onDone is async) - so
 * without this guard that exit would finish the job a second time, as a
 * failure, and count the lane's running total down twice.
 */
function finish(job, patch) {
  if (job.settled) return;
  job.settled = true;
  Object.assign(job, patch, { finishedAt: Date.now() });
  lanes[job.lane].running--;
  setTimeout(() => jobs.delete(job.id), JOB_TTL_MS).unref();
  if (job.onEnd) Promise.resolve().then(() => job.onEnd(job)).catch(() => {});
  pump(job.lane);
}

function run(job) {
  const lane = LANES[job.lane];
  lanes[job.lane].running++;
  job.state = 'running';
  job.startedAt = Date.now();
  if (job.onStart) Promise.resolve().then(() => job.onStart(job)).catch(() => {});
  const worker = new Worker(path.join(__dirname, 'puzzle-verify-worker.js'), {
    workerData: { ...job.workerData, opts: { ...(job.workerData.opts || {}), dutyCycle: lane.dutyCycle } },
    resourceLimits: { maxOldGenerationSizeMb: lane.heapMb, maxYoungGenerationSizeMb: 48 },
  });
  job.worker = worker;
  // setTimeout cannot take Infinity (it would fire at once), so "no limit" sets no timer.
  const limit = Number.isFinite(job.maxMs)
    ? setTimeout(() => {
      worker.terminate();
      if (job.state === 'running') finish(job, { state: 'failed', error: 'The check ran out of time.' });
    }, job.maxMs)
    : null;
  const stopTimer = () => { if (limit) clearTimeout(limit); };
  worker.on('message', async (msg) => {
    if (msg.type === 'progress') { job.progress = msg.progress; return; }
    stopTimer();
    if (job.state !== 'running' || job.recording) return;
    if (msg.type === 'error') { finish(job, { state: 'failed', error: msg.message }); worker.terminate(); return; }
    // From here the job's outcome is this result: the worker's exit, which
    // terminate() is about to cause, must not be mistaken for a crash.
    job.recording = true;
    worker.terminate();
    try {
      job.publicResult = job.onDone ? await job.onDone(msg.result) : msg.result;
      finish(job, { state: 'done' });
    } catch (err) {
      finish(job, { state: 'failed', error: err.message });
    }
  });
  worker.on('error', (err) => {
    stopTimer();
    if (job.state === 'running' && !job.recording) {
      finish(job, { state: 'failed', error: /memory/i.test(err.message) ? 'The check needed more memory than it is allowed.' : err.message });
    }
  });
  worker.on('exit', (code) => {
    stopTimer();
    if (job.state === 'running' && !job.recording) finish(job, { state: 'failed', error: `The check stopped unexpectedly (${code}).` });
  });
}

function pump(laneName) {
  const lane = lanes[laneName];
  while (lane.running < MAX_CONCURRENT && lane.queue.length) run(lane.queue.shift());
}

/**
 * Queue a check.
 *   onDone(result)  runs on the main thread when it succeeds (to record the
 *                   result); its return value is what pollers receive
 *   onStart(job), onEnd(job)  optional, for callers that keep their own record
 *   maxMs           wall-clock limit; Infinity for none
 */
function startJob({ kind, workerData, onDone, onStart, onEnd, owner = null, maxMs = 5 * 60 * 1000, lane = 'interactive', meta = null }) {
  if (!LANES[lane]) throw new Error(`Unknown job lane '${lane}'`);
  // A timer longer than ~24.8 days overflows and fires at once; past that, "no limit" is the honest reading.
  if (!(maxMs > 0) || maxMs > 2147483647) maxMs = Infinity;
  const job = { id: crypto.randomBytes(9).toString('hex'), kind, lane, owner, meta, state: 'queued', createdAt: Date.now(),
    workerData, onDone, onStart, onEnd, maxMs, progress: null };
  jobs.set(job.id, job);
  lanes[lane].queue.push(job);
  pump(lane);
  return job.id;
}

function getJob(id) {
  const job = jobs.get(id);
  return job ? { owner: job.owner, meta: job.meta, view: publicView(job) } : null;
}

/** Stop a job, queued or running. False if it had already finished. */
function cancelJob(id, reason = 'Canceled.') {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.state === 'queued') {
    const q = lanes[job.lane].queue;
    q.splice(q.indexOf(job), 1);
    // finish() decrements running, so count it in first: it never started.
    lanes[job.lane].running++;
    finish(job, { state: 'cancelled', error: reason });
    return true;
  }
  if (job.state === 'running' && !job.recording) {
    finish(job, { state: 'cancelled', error: reason });
    if (job.worker) job.worker.terminate();
    return true;
  }
  return false;
}

/** Every job not yet finished, for the admin tab. */
function activeJobs(filter = () => true) {
  return [...jobs.values()]
    .filter((j) => (j.state === 'queued' || j.state === 'running') && filter(j))
    .map((j) => ({ ...publicView(j), meta: j.meta }));
}

module.exports = { startJob, getJob, cancelJob, activeJobs, limits };
