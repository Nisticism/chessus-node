#!/usr/bin/env bash
#
# Push using the settings in .git-credentials.env (untracked).
#
# Prefers SSH, which doesn't expire. Falls back to a Personal Access Token if
# one is configured and no SSH key is set. See .git-credentials.env.example.
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

# Load without tracing, so nothing sensitive can land in shell logs.
set +x
# shellcheck disable=SC1090
set -a; . "$env_file"; set +a

branch="${1:-$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)}"

# Expand a leading ~ in the key path.
key_path="${SSH_KEY_PATH:-}"
case "$key_path" in
  "~/"*) key_path="$HOME/${key_path#\~/}" ;;
esac

if [ -n "$key_path" ] && [ -f "$key_path" ]; then
  # ── SSH ────────────────────────────────────────────────────────────────
  if [ -n "${GIT_REMOTE_SSH_URL:-}" ]; then
    current="$(git -C "$repo_root" remote get-url origin)"
    if [ "$current" != "$GIT_REMOTE_SSH_URL" ]; then
      echo "Switching origin to SSH: $GIT_REMOTE_SSH_URL"
      git -C "$repo_root" remote set-url origin "$GIT_REMOTE_SSH_URL"
    fi
  fi

  echo "Pushing $branch to origin over SSH (key: $key_path) ..."
  # IdentitiesOnly stops ssh offering every other key in the agent first.
  GIT_SSH_COMMAND="ssh -i '$key_path' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
    git -C "$repo_root" push origin "$branch"
  echo "Pushed $branch."
  exit 0
fi

# ── Token fallback ───────────────────────────────────────────────────────
if [ -z "${GITHUB_USERNAME:-}" ] || [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "No usable credentials." >&2
  echo "Set SSH_KEY_PATH to an existing private key (recommended), or fill in" >&2
  echo "GITHUB_USERNAME and GITHUB_TOKEN, in $env_file." >&2
  [ -n "$key_path" ] && echo "(SSH_KEY_PATH is set to '$key_path' but no such file exists.)" >&2
  exit 1
fi

echo "Pushing $branch to origin as $GITHUB_USERNAME (token) ..."
echo "Note: a fine-grained token needs 'Contents: Read and write' on this repo." >&2

git -C "$repo_root" \
  -c credential.helper= \
  -c credential.helper='!f() { printf "username=%s\npassword=%s\n" "$GITHUB_USERNAME" "$GITHUB_TOKEN"; }; f' \
  push origin "$branch"

echo "Pushed $branch."
