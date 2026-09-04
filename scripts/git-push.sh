#!/usr/bin/env bash
#
# Push using a token from .git-credentials.env (untracked).
#
# The token is passed to git through a transient credential helper on the
# command line, so it is never written into .git/config, never stored in a
# credential cache, and never echoed. See .git-credentials.env.example.
#
# Usage: ./scripts/git-push.sh [branch]   (defaults to the current branch)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.git-credentials.env"

if [ ! -f "$env_file" ]; then
  echo "No .git-credentials.env found." >&2
  echo "Copy .git-credentials.env.example to .git-credentials.env and fill it in." >&2
  exit 1
fi

# Load without tracing, so the token can't land in shell logs.
set +x
# shellcheck disable=SC1090
set -a; . "$env_file"; set +a

if [ -z "${GITHUB_USERNAME:-}" ] || [ -z "${GITHUB_TOKEN:-}" ] \
   || [ "${GITHUB_TOKEN}" = "github_pat_replace_me" ]; then
  echo "GITHUB_USERNAME and GITHUB_TOKEN must be set in .git-credentials.env." >&2
  exit 1
fi

branch="${1:-$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)}"

echo "Pushing $branch to origin as $GITHUB_USERNAME ..."

# The helper prints the credentials to git on stdin only; nothing is persisted.
git -C "$repo_root" \
  -c credential.helper= \
  -c credential.helper='!f() { printf "username=%s\npassword=%s\n" "$GITHUB_USERNAME" "$GITHUB_TOKEN"; }; f' \
  push origin "$branch"

echo "Pushed $branch."
