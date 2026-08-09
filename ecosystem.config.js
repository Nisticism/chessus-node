/**
 * PM2 ecosystem file for the Chessus / SquareStrat backend.
 *
 * Why this exists:
 *   On small EC2 instances V8 auto-sizes the old-space heap to ~256 MB,
 *   which is too small for this app + TensorFlow.js (nsfwjs) once normal
 *   state, sockets, and TF tensors accumulate. We bump the cap and tell
 *   PM2 to recycle the process gracefully before it OOMs.
 *
 * Apply on the server:
 *   pm2 delete chessus-node     # if it's already registered
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *
 * If the instance has more RAM, increase max_old_space_size and
 * max_memory_restart proportionally (keep restart ~25% above the heap cap).
 */
// Load .env from the repo root into process.env so the entries below can
// reference them, and so PM2 bakes them into the spawned process env.
// The .env file is gitignored — add secrets there, not here.
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .forEach(l => {
      const eq = l.indexOf('=');
      if (eq > 0) {
        const k = l.slice(0, eq).trim();
        const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    });
}

module.exports = {
  apps: [
    {
      name: "chessus-node",
      script: "server/index.js",
      // Run a single instance (this app uses in-memory socket state)
      instances: 1,
      exec_mode: "fork",
      // Restart automatically if memory grows past this — well below OOM
      max_memory_restart: "1100M",
      // Tell V8 to allow up to ~900MB of old-space heap, and expose global.gc
      // so the in-process memory watchdog (server/index.js) can hint a
      // collection under high pressure.
      // max_memory_restart is set to 1100M so pm2 restarts cleanly before
      // the OS OOM killer fires (keep ~200MB gap above the V8 cap).
      //
      // IMPORTANT: node_args only take effect when the process is (re)created.
      // If you previously ran `pm2 start server/index.js` directly, the saved
      // process will NOT have these flags — you MUST recreate it:
      //     pm2 delete chessus-node
      //     pm2 start ecosystem.config.js --env production
      //     pm2 save
      // Verify on boot: the log line "[memory] V8 heap_size_limit = NNNMb"
      // should read ~900MB. If it reads ~700MB the flags did not apply.
      node_args: "--max-old-space-size=900 --expose-gc",
      // Restart on crash with backoff
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 4000,
      // Give the app up to 8s to drain socket.io + the DB pool on stop/restart
      // before PM2 force-SIGKILLs it. Pairs with the gracefulShutdown() handler
      // in server/index.js (which self-exits after a 7s hard fallback).
      kill_timeout: 8000,
      // Keep logs sane
      merge_logs: true,
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      env: {
        NODE_ENV: "production",
        // Belt-and-suspenders heap cap: NODE_OPTIONS is inherited by the
        // spawned process even in edge cases where node_args is not applied
        // (e.g. a process resurrected from an older `pm2 save`). Keep this in
        // sync with the --max-old-space-size value in node_args above.
        // (--expose-gc is intentionally NOT here — it is not permitted in
        // NODE_OPTIONS and lives in node_args instead.)
        NODE_OPTIONS: "--max-old-space-size=900",
        // Gate the chattiest debug console.log lines (game-socket.js).
        // Set to "1" temporarily when troubleshooting a specific issue,
        // then unset and `pm2 restart chessus-node --update-env` to quiet
        // the logs again.
        VERBOSE_GAME_LOG: process.env.VERBOSE_GAME_LOG || "0",
        // Loaded from .env automatically by the block at the top of this file.
        // Add secrets there (DB creds, JWT secret, trainer config, etc.).
        ...(process.env.DB_HOST       && { DB_HOST:               process.env.DB_HOST }),
        ...(process.env.DB_USER       && { DB_USER:               process.env.DB_USER }),
        ...(process.env.DB_PASSWORD   && { DB_PASSWORD:           process.env.DB_PASSWORD }),
        ...(process.env.DB_NAME       && { DB_NAME:               process.env.DB_NAME }),
        ...(process.env.DB_PORT       && { DB_PORT:               process.env.DB_PORT }),
        ...(process.env.UPLOADS_DIR   && { UPLOADS_DIR:           process.env.UPLOADS_DIR }),
        ...(process.env.FRONTEND_EC2_URL && { FRONTEND_EC2_URL:    process.env.FRONTEND_EC2_URL }),
        ...(process.env.JWT_SECRET    && { JWT_SECRET:            process.env.JWT_SECRET }),
        ...(process.env.REMOTE_TRAINER_URL     && { REMOTE_TRAINER_URL:     process.env.REMOTE_TRAINER_URL }),
        ...(process.env.TRAINER_SHARED_SECRET  && { TRAINER_SHARED_SECRET:  process.env.TRAINER_SHARED_SECRET }),
      },
      // env_production mirrors env — PM2 uses this when you run with `--env production`
      env_production: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=900",
        VERBOSE_GAME_LOG: process.env.VERBOSE_GAME_LOG || "0",
        ...(process.env.DB_HOST       && { DB_HOST:               process.env.DB_HOST }),
        ...(process.env.DB_USER       && { DB_USER:               process.env.DB_USER }),
        ...(process.env.DB_PASSWORD   && { DB_PASSWORD:           process.env.DB_PASSWORD }),
        ...(process.env.DB_NAME       && { DB_NAME:               process.env.DB_NAME }),
        ...(process.env.DB_PORT       && { DB_PORT:               process.env.DB_PORT }),
        ...(process.env.UPLOADS_DIR   && { UPLOADS_DIR:           process.env.UPLOADS_DIR }),
        ...(process.env.FRONTEND_EC2_URL && { FRONTEND_EC2_URL:    process.env.FRONTEND_EC2_URL }),
        ...(process.env.JWT_SECRET    && { JWT_SECRET:            process.env.JWT_SECRET }),
        ...(process.env.REMOTE_TRAINER_URL     && { REMOTE_TRAINER_URL:     process.env.REMOTE_TRAINER_URL }),
        ...(process.env.TRAINER_SHARED_SECRET  && { TRAINER_SHARED_SECRET:  process.env.TRAINER_SHARED_SECRET }),
      }
    }
  ]
};
