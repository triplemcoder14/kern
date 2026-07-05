#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${KERN_STATE_DIR:-$ROOT/.kern/dev}"

stop_pidfile() {
  local name="$1"
  local file="${STATE_DIR}/${name}.pid"
  if [[ ! -f "$file" ]]; then
    return
  fi
  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "→ Stopping ${name} (pid ${pid})..."
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

echo "Stopping KERN background services..."

stop_pidfile port-forward
stop_pidfile kubectl-proxy

echo "Done."
echo "UI/API (npm run dev) are not stopped by this script — use Ctrl+C in that terminal."
