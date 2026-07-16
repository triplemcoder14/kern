#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${AGENT_PORT:-9474}"
REMOTE_PORT=9474
SERVICE="${AGENT_SERVICE:-kern-agent}"
NAMESPACE="${KERN_AGENT_NAMESPACE:-kern}"

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

# Prefer a concrete agent pod. Service PF picks a random node — DNS decode is
# only on the node where the lookup process runs.
TARGET="svc/${SERVICE}"
if POD="$(kubectl -n "${NAMESPACE}" get pod -l app=kern-agent --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)" \
  && [[ -n "${POD}" ]]; then
  # Prefer a worker node when present (demo traffic usually isn't on the CP).
  WORKER_POD="$(kubectl -n "${NAMESPACE}" get pod -l app=kern-agent --field-selector=status.phase=Running -o json 2>/dev/null \
    | python3 -c '
import json,sys
items=json.load(sys.stdin).get("items",[])
for p in items:
  node=p.get("spec",{}).get("nodeName","")
  if node and not node.endswith("-cp") and "control" not in node:
    print(p["metadata"]["name"]); break
' 2>/dev/null || true)"
  if [[ -n "${WORKER_POD}" ]]; then
    POD="${WORKER_POD}"
  fi
  TARGET="pod/${POD}"
  echo "Forwarding KERN agent ${NAMESPACE}/${TARGET}:${REMOTE_PORT} -> localhost:${LOCAL_PORT}"
else
  echo "Forwarding KERN agent ${NAMESPACE}/${TARGET}:${REMOTE_PORT} -> localhost:${LOCAL_PORT}"
fi

echo "Keep this terminal open while using KERN."
echo "Tip: also run kubectl proxy --port=8001 so the console can merge flows from all nodes."
exec kubectl port-forward -n "${NAMESPACE}" "${TARGET}" "${LOCAL_PORT}:${REMOTE_PORT}"
