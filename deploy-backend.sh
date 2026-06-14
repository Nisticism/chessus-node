#!/bin/bash
# Production deploy script for chessus-node backend (main app)
# Run from anywhere; this script uses absolute paths
#
# Usage:
#   ./deploy-backend.sh
#
# Git credentials: configure via SSH key or credential helper.

set -e

# Absolute path to the project root
PROJECT_ROOT="/home/ec2-user/chessus-node"

echo "[deploy] Pulling latest code from $PROJECT_ROOT..."
cd "$PROJECT_ROOT"
git pull
git lfs pull

echo "[deploy] Installing/updating npm dependencies..."
npm install --production

echo "[deploy] Running database migrations..."
# Migrations run automatically on server start, but we can trigger them early
# by starting the server in a subprocess briefly. Skip this if you prefer to
# let the main restart handle it.
# node -e "require('./server/migrations.js').runMigrations().then(() => process.exit(0))"

echo "[deploy] Stopping chessus-node..."
pm2 delete chessus-node || true  # Don't fail if app doesn't exist

echo "[deploy] Starting chessus-node with ecosystem.config.js..."
cd "$PROJECT_ROOT"
pm2 start ecosystem.config.js --env production

echo "[deploy] Saving PM2 process list..."
pm2 save

echo "[deploy] Deployment complete. Showing logs..."
pm2 logs chessus-node --lines 30 --nostream | grep -E '\[memory\]|heap_size_limit|listening'

echo ""
echo "[deploy] Verify heap limit above shows ~900MB"
echo "[deploy] To monitor: pm2 logs chessus-node"
