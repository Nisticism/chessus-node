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
      // Tell V8 to allow up to ~900MB of old-space heap.
      // max_memory_restart is set to 1100M so pm2 restarts cleanly before
      // the OS OOM killer fires (keep ~200MB gap above the V8 cap).
      node_args: "--max-old-space-size=900",
      // Restart on crash with backoff
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 4000,
      // Keep logs sane
      merge_logs: true,
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      env: {
        NODE_ENV: "production",
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
      }
    }
  ]
};
