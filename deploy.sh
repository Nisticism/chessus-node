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

# Install BEFORE building.
#
# This step used to be missing, and the failure it caused is a bad one: a deploy
# that adds a frontend dependency dies with "Module not found: Can't resolve
# '<package>'", which reads like a broken import rather than an uninstalled
# package. npm install is close to a no-op when the lockfile has not moved, and
# a minute of it beats a deploy that only fails for whoever pulls next.
if ! npm install > /tmp/chessus-frontend-install.log 2>&1; then
  echo "[deploy] Frontend dependency install failed:"
  tail -40 /tmp/chessus-frontend-install.log
  exit 1
fi

# Build quietly: the CRA build prints a long per-chunk gzip size table and any
# lint warnings on success, which clutters the deploy output. Capture it to a
# log and only surface it if the build actually fails.
if ! npm run build > /tmp/chessus-frontend-build.log 2>&1; then
  echo "[deploy] Frontend build failed:"
  cat /tmp/chessus-frontend-build.log
  exit 1
fi
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

echo "[deploy] Installing cache headers..."
# This one CANNOT go in conf.d/: it contains location blocks, and location is
# only legal inside server {}. default.d/ is included from inside the default
# server block on the RHEL/Amazon Linux nginx packages, which is what it needs.
#
# Guarded rather than assumed - if that include is not present, installing the
# file would either do nothing or break the config, and a deploy is the wrong
# moment to find out.
if grep -rq 'include */etc/nginx/default\.d/\*\.conf' /etc/nginx/nginx.conf; then
  sudo mkdir -p /etc/nginx/default.d
  sudo cp /home/ec2-user/chessus-node/configs/nginx-caching.conf           /etc/nginx/default.d/gridgrove-caching.conf
else
  echo "[deploy] WARNING: /etc/nginx/nginx.conf does not include default.d/*.conf."
  echo "[deploy]          Cache headers NOT installed. Add the include inside the"
  echo "[deploy]          server block, or paste configs/nginx-caching.conf into it."
fi

sudo nginx -t || { echo "[deploy] nginx config test failed, aborting"; exit 1; }

echo "[deploy] Restarting nginx..."
sudo systemctl restart nginx

echo "[deploy] Done."
