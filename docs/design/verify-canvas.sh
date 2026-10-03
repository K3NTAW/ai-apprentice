#!/usr/bin/env bash
# Checks docs/design/canvas/ against canvas.sha256 and, given the canvas source folder, the manifest against the source.
# Usage: docs/design/verify-canvas.sh [source-dir]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
(cd "$here/canvas" && shasum -a 256 -c ../canvas.sha256 --quiet)
listed=$(awk '{print $2}' "$here/canvas.sha256" | sort)
present=$(cd "$here/canvas" && ls | sort)
[ "$listed" = "$present" ] || { echo "verify-canvas: file list differs from the manifest" >&2; exit 1; }
if [ -n "${1:-}" ]; then
  diff <(cd "$1" && shasum -a 256 * | sort -k2) <(sort -k2 "$here/canvas.sha256") >/dev/null \
    || { echo "verify-canvas: source folder differs from the manifest" >&2; exit 1; }
fi
echo "verify-canvas: OK"
