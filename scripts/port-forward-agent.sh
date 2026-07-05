#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${AGENT_PORT:-9474}"
REMOTE_PORT=9474
SERVICE="${AGENT_SERVICE:-kern-agent}"

if lsof -nP -iTCP:"${LOCAL_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${LOCAL_PORT} is already in use — likely an existing port-forward."
  echo ""
  lsof -nP -iTCP:"${LOCAL_PORT}" -sTCP:LISTEN 2>/dev/null || true
  echo ""
  echo "If this is ./scripts/port-forward-agent.sh from another terminal, you're good."
  echo "Test: curl http://127.0.0.1:${LOCAL_PORT}/health"
  echo ""
  echo "To restart: kill the process above, then run this script again."
  exit 0
fi

echo "Forwarding KERN agent ${SERVICE}:${REMOTE_PORT} -> localhost:${LOCAL_PORT}"
echo "Keep this terminal open while using KERN."
exec kubectl port-forward -n kern "svc/${SERVICE}" "${LOCAL_PORT}:${REMOTE_PORT}"
