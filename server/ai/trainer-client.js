/**
 * HTTP client for the remote trainer-service running on the frontend EC2.
 *
 * Activated when env var `REMOTE_TRAINER_URL` is set on the backend.
 * Mirrors only the operations that touch the trainer process directly
 * (spawn / kill / log tail / build check). DB-backed operations
 * (listJobs, getJob, getModelMetaForGameType, markInterruptedJobs)
 * continue to run locally on the backend because both EC2 instances
 * share the same MySQL.
 *
 * Auth: shared-secret header `X-Trainer-Token` matched against the
 * trainer's `TRAINER_SHARED_SECRET` env var. The trainer-service should
 * be bound to a private security group, not exposed publicly.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const REMOTE_URL = process.env.REMOTE_TRAINER_URL || null;
const SHARED_SECRET = process.env.TRAINER_SHARED_SECRET || '';

function isEnabled() {
  return !!REMOTE_URL;
}

function request(method, pathPart, body) {
  if (!REMOTE_URL) return Promise.reject(new Error('REMOTE_TRAINER_URL not configured'));
  const u = new URL(pathPart, REMOTE_URL);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;
  const opts = {
    method,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + (u.search || ''),
    headers: {
      'Content-Type': 'application/json',
      'X-Trainer-Token': SHARED_SECRET,
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
    timeout: 30_000,
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(text ? JSON.parse(text) : null); }
          catch { resolve(text); }
        } else {
          let msg = `Trainer service ${res.statusCode}`;
          try { msg = JSON.parse(text).message || msg; } catch { /* ignore */ }
          reject(new Error(msg));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Trainer service timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * POST a raw binary body to the trainer-service. Used to forward
 * uploaded book.jsonl / job zip artifacts.
 */
function uploadBinary(pathPart, buffer) {
  if (!REMOTE_URL) return Promise.reject(new Error('REMOTE_TRAINER_URL not configured'));
  const u = new URL(pathPart, REMOTE_URL);
  const lib = u.protocol === 'https:' ? https : http;
  const opts = {
    method: 'POST',
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + (u.search || ''),
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
      'X-Trainer-Token': SHARED_SECRET,
    },
    timeout: 120_000, // uploads can be large
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(text ? JSON.parse(text) : null); }
          catch { resolve(text); }
        } else {
          let msg = `Trainer service ${res.statusCode}`;
          try { msg = JSON.parse(text).message || msg; } catch { /* ignore */ }
          reject(new Error(msg));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Trainer service timeout')));
    req.write(buffer);
    req.end();
  });
}

module.exports = {
  isEnabled,
  remoteUrl: () => REMOTE_URL,
  isRustBuilt: () => request('GET', '/trainer/health').then((r) => !!(r && r.rustBuilt)).catch(() => false),
  startJob: (params) => request('POST', '/trainer/jobs', params).then((r) => r.job),
  stopJob: (jobId) => request('POST', `/trainer/jobs/${jobId}/stop`).then((r) => !!r.stopped),
  resumeJob: (jobId) => request('POST', `/trainer/jobs/${jobId}/resume`).then((r) => r.job),
  tailLog: (jobId, maxLines) => request('GET', `/trainer/jobs/${jobId}/log?lines=${maxLines || 200}`).then((r) => r.events || []),
  // Return the raw games.ndjson content (per-move transcript) for a job.
  // The response body is plain text (ndjson), not JSON-wrapped.
  getGameLog: (jobId) => {
    if (!REMOTE_URL) return Promise.reject(new Error('REMOTE_TRAINER_URL not configured'));
    const u = new URL(`/trainer/jobs/${jobId}/game-log`, REMOTE_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method: 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: { 'X-Trainer-Token': SHARED_SECRET },
      timeout: 60_000,
    };
    return new Promise((resolve, reject) => {
      const req = lib.request(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 404) return resolve(null);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString('utf8'));
          } else {
            let msg = `Trainer service ${res.statusCode}`;
            try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')).message || msg; } catch { /* ignore */ }
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Trainer service timeout')));
      req.end();
    });
  },
  fetchBook: (gameTypeId) => request('GET', `/trainer/book/${Number(gameTypeId)}`),
  fetchAnalysis: (gameTypeId, opts = {}) => {
    const qs = [];
    if (opts.filterLegacy === false) qs.push('filterLegacy=false');
    const suffix = qs.length ? `?${qs.join('&')}` : '';
    return request('GET', `/trainer/analysis/${Number(gameTypeId)}${suffix}`);
  },
  uploadArtifact: ({ gameTypeId, kind, buffer, userId }) => {
    const qs = new URLSearchParams({ gameTypeId: String(gameTypeId), kind });
    if (userId) qs.set('userId', String(userId));
    return uploadBinary(`/trainer/upload?${qs.toString()}`, buffer);
  },
  // Delete on-disk data for a specific job. Used when admin clears/deletes a job.
  deleteJobData: (jobId) => request('DELETE', `/trainer/jobs/${jobId}/data`).catch(() => null),
  // Wipe on-disk data (jobs dirs + rules.json) for one or more game types.
  // Pass an array of game type IDs, or omit to wipe everything.
  wipeGameTypes: (gameTypeIds) => request('DELETE', '/trainer/wipe', { gameTypeIds: gameTypeIds || [] }).catch(() => null),
  // Return per-job disk game counts for a game type so the backend can
  // reconcile games_played in the DB against actual on-disk data.
  verifyDisk: (gameTypeId) => request('GET', `/trainer/verify-disk/${Number(gameTypeId)}`),
  // Copy all training data for the given game type IDs (or all if omitted)
  // to the backup directory on the trainer host.
  backup: (gameTypeIds) => request('POST', '/trainer/backup', { gameTypeIds: gameTypeIds || [] }),
  // Check which job directories actually exist on disk.
  // jobs: [{ id, game_type_id }]
  // Returns { present: [id,...], absent: [id,...] }
  diskStatus: (jobs) => request('POST', '/trainer/disk-status', { jobs: jobs || [] }),
  // Download a rules.json file for a game type.
  // Returns the raw JSON buffer (axios response.data).
  downloadRules: (gameTypeId) => request('GET', `/trainer/rules/${Number(gameTypeId)}`),
};
