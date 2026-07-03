#!/bin/bash
# Production deploy script for chessus-node (EC2).
# Run from /home/ec2-user/chessus-node/
#
# Git credentials: configure via SSH key or a ~/.netrc / credential helper so
# the token is not embedded in this file.  Example one-time setup:
#   git remote set-url origin https://<token>@github.com/nisticism/chessus-node
# Then just run: git pull

set -e

echo "[deploy] Pulling latest code..."
git pull
git lfs pull

# --- Rust AI engine TEMPORARILY DISABLED ---------------------------------
# Fairy Stockfish + the JS engine currently cover bot play, so the Rust build
# and trainer-service restart are skipped to keep deploys fast and unblocked.
# To re-enable: uncomment the two blocks below (and restore `npm run build:rust`
# in package.json's dev/start:all scripts, plus set RUST_ENGINE=1).
#
# echo "[deploy] Building Rust AI engine and copying binary..."
# # Using build-rust.js (not cargo directly) so the binary is automatically
# # copied to trainer-binaries/linux/ where the download endpoint expects it.
# # NOTE: The win32 binary must be built locally on Windows and rsync'd manually:
# #   rsync -avz trainer-binaries/win32/ai-engine.exe ec2-user@<host>:/home/ec2-user/chessus-node/trainer-binaries/win32/
# node scripts/build-rust.js
#
# echo "[deploy] Restarting trainer service..."
# pm2 restart trainer-service --update-env
# -------------------------------------------------------------------------

echo "[deploy] Building frontend..."
cd chessus-frontend
npm run build || { echo "[deploy] Frontend build failed, aborting"; exit 1; }
cd ..

echo "[deploy] Publishing frontend to nginx..."
sudo rm -rf /usr/share/nginx/html/*
sudo cp -r /home/ec2-user/chessus-node/chessus-frontend/build/. /usr/share/nginx/html/

echo "[deploy] Installing COOP/COEP header snippet for Fairy Stockfish..."
# Copies a two-line add_header snippet into conf.d/. nginx includes conf.d/*.conf
# inside http {}, so these headers are inherited by all server/location blocks
# that don't define their own add_header (the main site config in nginx.conf
# has none, so all responses pick them up). SharedArrayBuffer requires both
# COOP same-origin and COEP credentialless to be set on the page response.
sudo cp /home/ec2-user/chessus-node/configs/nginx-site.conf /etc/nginx/conf.d/coop-coep.conf
sudo nginx -t || { echo "[deploy] nginx config test failed, aborting"; exit 1; }

echo "[deploy] Restarting nginx..."
sudo systemctl restart nginx

echo "[deploy] Done."
pm2 logs trainer-service --lines 20
