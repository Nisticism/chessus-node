#!/bin/bash
# Production deploy script for chessus-node (EC2).
# Run from /home/ec2-user/chessus-node/
#
# Git credentials: configure via SSH key or a ~/.netrc / credential helper so
# the token is not embedded in this file.  Example one-time setup:
#   git remote set-url origin https://<token>@github.com/nisticism/chessus-node
# Then just run: git pull
#
# The whole script is one function, called on the last line. bash reads a
# script as it runs it, and this one `git pull`s ITSELF: when a pull changes
# this file, bash would carry on reading the new file at the old byte offset
# and run half of one version and half of the other. A function is parsed in
# full before any of it runs, so a pull mid-deploy cannot reach it.
#
# Each step prints how long it took, and the total at the end.

main() {
set -e

DEPLOY_START=$SECONDS
step_start=$SECONDS
step_done() {
  echo "[deploy]   ...$(( SECONDS - step_start ))s"
  step_start=$SECONDS
}

echo "[deploy] Pulling latest code..."
git pull
git lfs pull
step_done

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

cd chessus-frontend

# Install BEFORE building - but only when the dependencies changed.
#
# The install used to be missing, and the failure it caused is a bad one: a
# deploy that adds a frontend dependency dies with "Module not found: Can't
# resolve '<package>'", which reads like a broken import rather than an
# uninstalled package. It runs whenever package-lock.json differs from the one
# the last successful install used (the fingerprint lives inside node_modules,
# so a missing or wiped node_modules installs too). Otherwise it is skipped:
# even a no-op npm install spends time checking every package.
LOCK_SUM=$(sha256sum package-lock.json package.json | sha256sum | cut -d' ' -f1)
LOCK_MARK=node_modules/.deploy-lock-sum
if [ -d node_modules ] && [ -f "$LOCK_MARK" ] && [ "$(cat "$LOCK_MARK")" = "$LOCK_SUM" ]; then
  echo "[deploy] Frontend dependencies unchanged - skipping npm install."
else
  echo "[deploy] Installing frontend dependencies..."
  if ! npm install > /tmp/chessus-frontend-install.log 2>&1; then
    echo "[deploy] Frontend dependency install failed:"
    tail -40 /tmp/chessus-frontend-install.log
    exit 1
  fi
  echo "$LOCK_SUM" > "$LOCK_MARK"
  step_done
fi

# Build quietly: the CRA build prints a long per-chunk gzip size table and any
# lint warnings on success, which clutters the deploy output. Capture it to a
# log and only surface it if the build actually fails.
#
# Two things the production build does not need, measured on a 61s local build:
#   GENERATE_SOURCEMAP=false  -10s. Source maps let a browser's dev tools show
#                             the original source - and so publish it to anyone
#                             who looks. No error tracker here reads them.
#   DISABLE_ESLINT_PLUGIN     -21s. The build re-lints every file, and its
#                             warnings were already being thrown away above.
#                             Lint still runs in development (npm start) and in
#                             the editor; it just stops slowing the deploy.
echo "[deploy] Building frontend..."
if ! GENERATE_SOURCEMAP=false DISABLE_ESLINT_PLUGIN=true npm run build > /tmp/chessus-frontend-build.log 2>&1; then
  echo "[deploy] Frontend build failed:"
  cat /tmp/chessus-frontend-build.log
  exit 1
fi
step_done
cd ..

# Publish: copy only what changed, and never leave the site empty.
#
# This used to `rm -rf` the live folder and then copy the whole build back in
# - every file, every deploy, with a window in between where visitors got 404s
# for the bundle. rsync compares by content (--checksum: the build rewrites
# every file, so dates prove nothing), sends only the files that differ, lands
# them all at the end (--delay-updates) and removes old ones last
# (--delete-after). Content-hashed bundles and unchanged images are skipped.
echo "[deploy] Publishing frontend to nginx..."
if command -v rsync > /dev/null 2>&1; then
  sudo rsync -a --checksum --delete-after --delay-updates --no-owner --no-group \
    /home/ec2-user/chessus-node/chessus-frontend/build/ /usr/share/nginx/html/
else
  echo "[deploy] (rsync not installed - full copy; 'sudo yum install -y rsync' makes this faster)"
  sudo rm -rf /usr/share/nginx/html/*
  sudo cp -r /home/ec2-user/chessus-node/chessus-frontend/build/. /usr/share/nginx/html/
fi
step_done

echo "[deploy] Installing COOP/COEP and cache headers..."
# Copies a two-line add_header snippet into conf.d/. nginx includes conf.d/*.conf
# inside http {}, so these headers are inherited by all server/location blocks
# that don't define their own add_header (the main site config in nginx.conf
# has none, so all responses pick them up). SharedArrayBuffer requires both
# COOP same-origin and COEP credentialless to be set on the page response.
sudo cp /home/ec2-user/chessus-node/configs/nginx-site.conf /etc/nginx/conf.d/coop-coep.conf

sudo nginx -t || { echo "[deploy] nginx config test failed, aborting"; exit 1; }

# reload, not restart: nginx re-reads its config and hands over to new workers
# without dropping the connections in flight. The files themselves are served
# straight from disk, so they never needed a restart.
echo "[deploy] Reloading nginx..."
sudo systemctl reload nginx
step_done

echo "[deploy] Done in $(( SECONDS - DEPLOY_START ))s."
}

main "$@"
exit $?
