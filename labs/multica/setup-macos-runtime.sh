#!/bin/sh
set -eu

SERVER_URL="${MULTICA_LAB_SERVER_URL:-https://zhuge-multica-lab-api.onrender.com}"
APP_URL="${MULTICA_LAB_APP_URL:-https://zhuge-multica-lab.onrender.com}"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required on this macOS runtime." >&2
  exit 1
fi

if ! command -v multica >/dev/null 2>&1; then
  brew install multica-ai/tap/multica
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not on PATH. Install/sign in to Codex before connecting this runtime." >&2
  exit 2
fi

echo "Connecting this machine to Zhuge Multica Lab..."
multica setup self-host --server-url "$SERVER_URL" --app-url "$APP_URL"
multica daemon status
