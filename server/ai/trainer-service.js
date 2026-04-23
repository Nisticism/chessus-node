/**
 * Standalone trainer service.
 *
 * Runs on the frontend EC2 instance (t3.medium) and exposes the
 * subset of training-manager.js operations that need the Rust binary
 * to be co-located: spawn / kill / log tail / build check.
 *
 * Listens on a private interface only — bind to localhost via a security
 * group rule that allows the backend instance over the VPC. Authenticated
 * via the shared secret in env var `TRAINER_SHARED_SECRET`.
 *
 * Run with:
 *   PORT=4101 \
 *   TRAINER_SHARED_SECRET=... \
 *   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... \
 *   node server/ai/trainer-service.js
 *
 * (Add to PM2 / systemd alongside any frontend processes.)
 */
const express = require('express');
const trainingManager = require('./training-manager');

const PORT = parseInt(process.env.TRAINER_PORT || '4101', 10);
const SHARED_SECRET = process.env.TRAINER_SHARED_SECRET || '';
const BIND_HOST = process.env.TRAINER_BIND_HOST || '127.0.0.1';

if (!SHARED_SECRET) {
  console.error('FATAL: TRAINER_SHARED_SECRET env var must be set');
  process.exit(1);
}
if (process.env.REMOTE_TRAINER_URL) {
  console.error('FATAL: trainer-service must not have REMOTE_TRAINER_URL set (would proxy to itself)');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '256kb' }));
// Raw body parser used by the artifact upload endpoint. The backend
// proxies the user's file as a single binary blob with a kind=jsonl|zip
// query string, which keeps the wire protocol simple (no multipart on
// the trainer side).
app.use('/trainer/upload', express.raw({ type: '*/*', limit: '500mb' }));

// Auth middleware — single shared secret, constant-time compare.
app.use((req, res, next) => {
  const provided = req.headers['x-trainer-token'] || '';
  if (provided.length !== SHARED_SECRET.length) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ SHARED_SECRET.charCodeAt(i);
  }
  if (diff !== 0) return res.status(401).json({ message: 'Unauthorized' });
  next();
});

app.get('/trainer/health', (req, res) => {
  res.json({
    ok: true,
    rustBuilt: trainingManager.isRustBuilt(),
    enginePath: trainingManager.RUST_BIN,
  });
});

app.post('/trainer/jobs', async (req, res) => {
  try {
    const job = await trainingManager.startJob(req.body || {});
    res.json({ job });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.post('/trainer/jobs/:id/stop', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stopped = trainingManager.stopJob(id);
  res.json({ stopped: !!stopped });
});

app.post('/trainer/jobs/:id/resume', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const job = await trainingManager.resumeJob(id);
    res.json({ job });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get('/trainer/jobs/:id/log', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const lines = Math.min(parseInt(req.query.lines, 10) || 200, 5000);
    const events = await trainingManager.tailLog(id, lines);
    res.json({ events });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Return the merged opening book for a game type. Books from every job
// directory for this game type are summed (W/L/D per position+move).
// Fingerprint lets the caller avoid re-parsing unchanged data.
app.get('/trainer/book/:gameTypeId', (req, res) => {
  try {
    const gameTypeId = parseInt(req.params.gameTypeId, 10);
    if (!Number.isFinite(gameTypeId)) {
      return res.status(400).json({ message: 'Invalid gameTypeId' });
    }
    const openingBook = require('./opening-book');
    const { book, fingerprint } = openingBook.loadLocalMergedBook(gameTypeId);
    res.json({ book, fingerprint });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload pre-trained artifacts (raw book.jsonl or a zip of a job dir).
// Body is the raw bytes of the file. Query string carries metadata.
//   POST /trainer/upload?gameTypeId=N&kind=jsonl|zip&userId=N
app.post('/trainer/upload', async (req, res) => {
  try {
    const gameTypeId = parseInt(req.query.gameTypeId, 10);
    const kind = String(req.query.kind || '').toLowerCase();
    const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
    if (!Number.isFinite(gameTypeId)) {
      return res.status(400).json({ message: 'Missing or invalid gameTypeId query param' });
    }
    if (kind !== 'jsonl' && kind !== 'zip') {
      return res.status(400).json({ message: 'kind must be "jsonl" or "zip"' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: 'Empty upload body' });
    }
    const { importUpload } = require('./artifact-uploader');
    const result = await importUpload(gameTypeId, { kind, buffer: req.body }, { userId });
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

(async () => {
  try {
    await trainingManager.markInterruptedJobs();
  } catch (e) {
    console.warn('markInterruptedJobs at startup failed:', e.message);
  }
  app.listen(PORT, BIND_HOST, () => {
    console.log(`[trainer-service] listening on ${BIND_HOST}:${PORT}`);
    console.log(`[trainer-service] rust binary: ${trainingManager.RUST_BIN}`);
    console.log(`[trainer-service] rust built: ${trainingManager.isRustBuilt()}`);
  });
})();
