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
 * Or place a .env file at server/ai/.env (see server/ai/.env.example) and
 * launch with:  node server/ai/trainer-service.js
 *
 * (Add to PM2 / systemd alongside any frontend processes.)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
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

// Return the raw games.ndjson content for a job (per-move game transcript).
app.get('/trainer/jobs/:id/game-log', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid job id' });
    const content = await trainingManager.getGameLog(id);
    if (content === null) return res.status(404).json({ message: 'No game log found for this job' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    res.status(500).json({ message: err.message });
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

// Aggregate every training job's log.ndjson for a game type into a
// summary the backend persists in `ai_training_analyses`. The trainer
// host has the files; the backend orchestrates storage + visibility.
// NOTE: computeAnalysis is async — must await or the Promise is serialised
// as {} causing the public analysis page to crash on missing fields.
app.get('/trainer/analysis/:gameTypeId', async (req, res) => {
  try {
    const gameTypeId = parseInt(req.params.gameTypeId, 10);
    if (!Number.isFinite(gameTypeId)) {
      return res.status(400).json({ message: 'Invalid gameTypeId' });
    }
    const filterLegacy = req.query.filterLegacy !== 'false';
    const { computeAnalysis } = require('./training-analysis');
    const summary = await computeAnalysis(gameTypeId, { filterLegacy });
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete on-disk training data for a specific job. Called by the backend
// when an admin clears or deletes a job. In REMOTE_MODE the data lives here,
// not on the backend EC2, so the backend proxies the cleanup here.
app.delete('/trainer/jobs/:id/data', (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (!Number.isFinite(jobId)) return res.status(400).json({ message: 'Invalid job id' });
    const fs = require('fs');
    const path = require('path');
    const { trainingRootDir } = require('./export-game-rules');
    // We don't know the game_type_id here, so scan all game type dirs.
    const TRAINING_ROOT = trainingRootDir();
    let deleted = false;
    if (fs.existsSync(TRAINING_ROOT)) {
      for (const entry of fs.readdirSync(TRAINING_ROOT)) {
        const jobDir = path.join(TRAINING_ROOT, entry, 'jobs', String(jobId));
        if (fs.existsSync(jobDir)) {
          fs.rmSync(jobDir, { recursive: true, force: true });
          deleted = true;
        }
      }
    }
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Bulk wipe: delete on-disk job dirs and rules.json for the given game type
// IDs. Accepts { gameTypeIds: number[] } in the body. If gameTypeIds is
// omitted or empty, wipes ALL game type directories.
app.delete('/trainer/wipe', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { trainingDirFor, trainingRootDir, rulesPathFor } = require('./export-game-rules');
    const TRAINING_ROOT = trainingRootDir();
    const gameTypeIds = Array.isArray(req.body?.gameTypeIds) ? req.body.gameTypeIds : null;
    let deletedDirs = 0;
    let deletedRules = 0;
    const wipeOneGameType = (gtid) => {
      const jobsDir = path.join(trainingDirFor(gtid), 'jobs');
      if (fs.existsSync(jobsDir)) {
        fs.rmSync(jobsDir, { recursive: true, force: true });
        deletedDirs++;
      }
      const rp = rulesPathFor(gtid);
      if (fs.existsSync(rp)) {
        try { fs.unlinkSync(rp); deletedRules++; } catch (_) {}
      }
    };
    if (gameTypeIds && gameTypeIds.length > 0) {
      for (const gtid of gameTypeIds) {
        const id = parseInt(gtid, 10);
        if (Number.isFinite(id)) wipeOneGameType(id);
      }
    } else {
      // Wipe all — iterate every subdirectory of ai-training/
      if (fs.existsSync(TRAINING_ROOT)) {
        for (const entry of fs.readdirSync(TRAINING_ROOT)) {
          const id = parseInt(entry, 10);
          if (Number.isFinite(id)) wipeOneGameType(id);
        }
      }
    }
    res.json({ ok: true, deletedDirs, deletedRules });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Verify what's actually on disk for every job of a game type and return
// per-job game counts.  The backend uses this to reconcile games_played.
app.get('/trainer/verify-disk/:gameTypeId', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const gameTypeId = parseInt(req.params.gameTypeId, 10);
    if (!Number.isFinite(gameTypeId)) return res.status(400).json({ message: 'Invalid gameTypeId' });
    const { trainingDirFor } = require('./export-game-rules');
    const jobsRoot = path.join(trainingDirFor(gameTypeId), 'jobs');
    const jobs = [];
    if (fs.existsSync(jobsRoot)) {
      for (const entry of fs.readdirSync(jobsRoot)) {
        const jobId = parseInt(entry, 10);
        if (!Number.isFinite(jobId) || jobId <= 0) continue;
        const dir = path.join(jobsRoot, entry);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
        const logPath  = path.join(dir, 'log.ndjson');
        const bookPath = path.join(dir, 'book.jsonl');
        let gamesOnDisk = 0;
        let source = 'none';
        if (fs.existsSync(logPath)) {
          // Count game_complete events in the log.
          try {
            const text = fs.readFileSync(logPath, 'utf8');
            for (const line of text.split(/\r?\n/)) {
              if (!line) continue;
              try { const ev = JSON.parse(line); if (ev?.type === 'game_complete') gamesOnDisk++; } catch { /* skip */ }
            }
            source = 'log';
          } catch { /* unreadable log */ }
        } else if (fs.existsSync(bookPath)) {
          // Count p=0 records as game count.
          try {
            const text = fs.readFileSync(bookPath, 'utf8');
            for (const line of text.split(/\r?\n/)) {
              if (!line.trim()) continue;
              try { const r = JSON.parse(line); if (r.p === 0 || r.p === '0') gamesOnDisk++; } catch { /* skip */ }
            }
            source = 'book';
          } catch { /* unreadable book */ }
        }
        jobs.push({ jobId, gamesOnDisk, source });
      }
    }
    res.json({ gameTypeId, jobs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Back up all training data for a game type (or all game types) to a
// directory outside the repo so it survives git operations.
// Set TRAINING_BACKUP_DIR env var on the trainer host; defaults to a
// sibling of the training directory named ai-training-backup.
app.post('/trainer/backup', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { trainingDirFor, trainingRootDir } = require('./export-game-rules');
    const TRAINING_ROOT = trainingRootDir();
    const BACKUP_ROOT = process.env.TRAINING_BACKUP_DIR
      ? path.resolve(process.env.TRAINING_BACKUP_DIR)
      : path.join(path.dirname(TRAINING_ROOT), 'ai-training-backup');

    const gameTypeIds = Array.isArray(req.body?.gameTypeIds) && req.body.gameTypeIds.length > 0
      ? req.body.gameTypeIds.map(Number).filter(Number.isFinite)
      : null; // null = all

    // Collect which game type dirs to back up.
    let gtids = [];
    if (gameTypeIds) {
      gtids = gameTypeIds;
    } else if (fs.existsSync(TRAINING_ROOT)) {
      for (const entry of fs.readdirSync(TRAINING_ROOT)) {
        const id = parseInt(entry, 10);
        if (Number.isFinite(id)) gtids.push(id);
      }
    }

    // Recursive copy helper.
    function copyDir(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        const st = fs.statSync(s);
        if (st.isDirectory()) {
          copyDir(s, d);
        } else {
          fs.copyFileSync(s, d);
        }
      }
    }

    let copiedGameTypes = 0;
    let copiedFiles = 0;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapshotRoot = path.join(BACKUP_ROOT, timestamp);

    for (const gtid of gtids) {
      const src = trainingDirFor(gtid);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(snapshotRoot, String(gtid));
      copyDir(src, dest);
      copiedGameTypes++;
      // Count files for reporting.
      const countFiles = (d) => {
        let n = 0;
        for (const e of fs.readdirSync(d)) {
          const full = path.join(d, e);
          if (fs.statSync(full).isDirectory()) n += countFiles(full);
          else n++;
        }
        return n;
      };
      try { copiedFiles += countFiles(dest); } catch { /* non-fatal */ }
    }

    res.json({ ok: true, backupPath: snapshotRoot, copiedGameTypes, copiedFiles, timestamp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Check which job directories actually exist on disk.
// Body: { jobs: [{ id, game_type_id }] }
// Returns { present: [id,...], absent: [id,...] }
app.post('/trainer/disk-status', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { trainingRootDir } = require('./export-game-rules');
    const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
    const present = [];
    const absent = [];
    for (const j of jobs) {
      const jobId = Number(j.id);
      const gtid = Number(j.game_type_id);
      if (!Number.isFinite(jobId) || !Number.isFinite(gtid)) continue;
      const dir = path.join(trainingRootDir(), String(gtid), 'jobs', String(jobId));
      if (fs.existsSync(dir)) {
        present.push(jobId);
      } else {
        absent.push(jobId);
      }
    }
    res.json({ present, absent });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Serve a rules.json file for a game type.
// GET /trainer/rules/:gameTypeId
app.get('/trainer/rules/:gameTypeId', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { trainingRootDir } = require('./export-game-rules');
    const gtid = parseInt(req.params.gameTypeId, 10);
    if (!Number.isFinite(gtid) || gtid <= 0) {
      return res.status(400).json({ message: 'Invalid gameTypeId' });
    }
    const rulesFile = path.join(trainingRootDir(), String(gtid), 'rules.json');
    if (!fs.existsSync(rulesFile)) {
      return res.status(404).json({ message: 'rules.json not found for this game type — export it first' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="rules-${gtid}.json"`);
    fs.createReadStream(rulesFile).pipe(res);
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
    // Surface the binary's mtime so it's obvious in PM2 logs whether
    // a `cargo build --release` step was actually run after a `git pull`.
    // A stale mtime here is a strong signal the binary needs rebuilding.
    try {
      const fs = require('fs');
      const st = fs.statSync(trainingManager.RUST_BIN);
      console.log(`[trainer-service] rust binary built at: ${st.mtime.toISOString()} (size: ${st.size} bytes)`);
    } catch (e) {
      console.warn(`[trainer-service] could not stat rust binary: ${e.message}`);
    }
  });
})();
