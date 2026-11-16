#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Error: node and npm are required to run GPX Route Master locally." >&2
  exit 1
fi

if [ ! -d "node_modules" ] || [ ! -x "node_modules/.bin/tsx" ]; then
  echo "==> Installing dependencies (npm install)..."
  npm install
fi

mkdir -p data

if [ ! -f "data/gpx_library.db" ]; then
  echo "==> No local database found in data/gpx_library.db — a fresh DB will be created on startup."
else
  echo "==> Using existing local database: data/gpx_library.db"
fi

if [ "${1:-}" = "--test" ]; then
  echo "==> Running typecheck & test suite..."
  npm run lint
  npm test
  exit 0
fi

echo "==> Starting GPX Route Master locally on http://localhost:3000 ..."
echo "    (Tip: run './start-local.sh --test' to run typecheck & tests)"
exec npm run dev
