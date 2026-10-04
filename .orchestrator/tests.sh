#!/usr/bin/env bash
# Merge gate: install deps if needed, then unit tests, typecheck, lint.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
  touch node_modules
fi

npx vitest run
npx tsc --noEmit
npm run lint --silent
