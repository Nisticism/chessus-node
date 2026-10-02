/*
 * Background puzzle checks: a small job queue that runs each check in a worker
 * thread (puzzle-verify-worker.js).
 *
 * Limits, so a long search never costs the rest of the site:
 *   - ONE job at a time; the rest wait their turn, in order.
 *   - Memory: each worker's heap is capped (resourceLimits). A search that
 *     outgrows it is stopped and the job fails, rather than the server.
 *   - CPU: the search runs at a duty cycle (DUTY_CYCLE of wall-clock time),
 *     pausing between slices of work.
 *   - Time: each job has a wall-clock limit, after which the worker is ended.
 *
 * Jobs live in memory for JOB_TTL_MS after they finish, long enough for the
 * page that started one to collect the result.
 */
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const MAX_CONCURRENT = 1;
const HEAP_MB = Number(process.env.PUZZLE_WORKER_HEAP_MB) || 384;
const DUTY_CYCLE = Number(process.env.PUZZLE_WORKER_DUTY_CYCLE) || 0.7;
const JOB_TTL_MS = 30 * 60 * 1000;

const jobs = new Map();
const queue = [];
let running = 0;

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
    state: job.state,
    queuePosition: job.state === 'queued' ? queue.indexOf(job) + 1 : 0,
    progress: job.progress,
    elapsedMs,
    etaMs,
    result: job.state === 'done' ? job.publicResult : undefined,
    error: job.state === 'failed' ? job.error : undefined,
  };
}

function finish(job, patch) {
  Object.assign(job, patch, { finishedAt: Date.now() });
  running--;
  setTimeout(() => jobs.delete(job.id), JOB_TTL_MS).unref();
  pump();
}

function run(job) {
  running++;
  job.state = 'running';
  job.startedAt = Date.now();
  const worker = new Worker(path.join(__dirname, 'puzzle-verify-worker.js'), {
    workerData: { ...job.workerData, opts: { ...(job.workerData.opts || {}), dutyCycle: DUTY_CYCLE } },
    resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 48 },
  });
  job.worker = worker;
  const limit = setTimeout(() => {
    worker.terminate();
    if (job.state === 'running') finish(job, { state: 'failed', error: 'The check ran out of time.' });
  }, job.maxMs);
  worker.on('message', async (msg) => {
    if (msg.type === 'progress') { job.progress = msg.progress; return; }
    clearTimeout(limit);
    worker.terminate();
    if (job.state !== 'running') return;
    if (msg.type === 'error') { finish(job, { state: 'failed', error: msg.message }); return; }
    try {
      job.publicResult = job.onDone ? await job.onDone(msg.result) : msg.result;
      finish(job, { state: 'done' });
    } catch (err) {
      finish(job, { state: 'failed', error: err.message });
    }
  });
  worker.on('error', (err) => {
    clearTimeout(limit);
    if (job.state === 'running') {
      finish(job, { state: 'failed', error: /memory/i.test(err.message) ? 'The check needed more memory than it is allowed.' : err.message });
    }
  });
  worker.on('exit', (code) => {
    clearTimeout(limit);
    if (job.state === 'running') finish(job, { state: 'failed', error: `The check stopped unexpectedly (${code}).` });
  });
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) run(queue.shift());
}

/**
 * Queue a check. onDone(result) runs on the main thread when it succeeds (to
 * record the result) and its return value is what pollers receive.
 */
function startJob({ kind, workerData, onDone, owner = null, maxMs = 5 * 60 * 1000 }) {
  const job = { id: crypto.randomBytes(9).toString('hex'), kind, owner, state: 'queued', createdAt: Date.now(),
    workerData, onDone, maxMs, progress: null };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job.id;
}

function getJob(id) {
  const job = jobs.get(id);
  return job ? { owner: job.owner, view: publicView(job) } : null;
}

module.exports = { startJob, getJob };
