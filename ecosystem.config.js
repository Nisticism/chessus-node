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
module.exports = {
  apps: [
    {
      name: "chessus-node",
      script: "server/index.js",
      // Run a single instance (this app uses in-memory socket state)
      instances: 1,
      exec_mode: "fork",
      // Restart automatically if memory grows past this — well below OOM
      max_memory_restart: "900M",
      // Tell V8 to allow up to ~700MB of old-space heap
      // (leaves headroom for TF native allocations on a 1-2 GB box)
      node_args: "--max-old-space-size=700",
      // Restart on crash with backoff
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 4000,
      // Keep logs sane
      merge_logs: true,
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
        // Gate the chattiest debug console.log lines (game-socket.js).
        // Set to "1" temporarily when troubleshooting a specific issue,
        // then unset and `pm2 restart chessus-node --update-env` to quiet
        // the logs again.
        VERBOSE_GAME_LOG: "0"
      }
    }
  ]
};
