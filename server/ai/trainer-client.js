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
  fetchBook: (gameTypeId) => request('GET', `/trainer/book/${Number(gameTypeId)}`),
  uploadArtifact: ({ gameTypeId, kind, buffer, userId }) => {
    const qs = new URLSearchParams({ gameTypeId: String(gameTypeId), kind });
    if (userId) qs.set('userId', String(userId));
    return uploadBinary(`/trainer/upload?${qs.toString()}`, buffer);
  },
};
