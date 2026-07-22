#!/usr/bin/env bash
# Start kubectl proxy (:8001) + kern-agent port-forward (:9474) together.
# Keep this terminal open while using the local console.
#
# Port-forwards to hostNetwork DaemonSet agents drop often ("lost connection to pod").
# This script restarts the agent forward automatically instead of killing everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${KERN_STATE_DIR:-$ROOT/.kern/dev}"
KUBECTL_PROXY_PORT="${KERN_K8S_PROXY_PORT:-8001}"
AGENT_PORT="${KERN_AGENT_PORT:-9474}"
AGENT_NS="${KERN_AGENT_NAMESPACE:-kern}"
AGENT_SERVICE="${AGENT_SERVICE:-kern-agent}"

PROXY_PID=""
PF_PID=""
STOPPING=0

usage() {
  cat <<EOF
Usage: $(basename "$0")

Starts both local tunnels for the KERN console:
  - kubectl proxy          → http://127.0.0.1:${KUBECTL_PROXY_PORT}
  - agent port-forward     → http://127.0.0.1:${AGENT_PORT}

Uses the current kubectl context. Ctrl+C stops both.
# Agent forwards auto-restart if the pod drops (common with hostNetwork agents).

Env overrides:
  KERN_K8S_PROXY_PORT   (default ${KUBECTL_PROXY_PORT})
  KERN_AGENT_PORT       (default ${AGENT_PORT})
  KERN_AGENT_NAMESPACE  (default ${AGENT_NS})
  AGENT_SERVICE         (default ${AGENT_SERVICE})
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# Prefer a concrete Running agent pod — Service PF to hostNetwork DaemonSets is flaky.
pick_agent_target() {
  local pod=""
  local worker=""
  pod="$(kubectl -n "${AGENT_NS}" get pod -l app=kern-agent \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "${pod}" ]]; then
    if kubectl -n "${AGENT_NS}" get "svc/${AGENT_SERVICE}" >/dev/null 2>&1; then
      echo "svc/${AGENT_SERVICE}"
      return
    fi
    return 1
  fi
  worker="$(kubectl -n "${AGENT_NS}" get pod -l app=kern-agent \
    --field-selector=status.phase=Running -o json 2>/dev/null \
    | python3 -c '
import json,sys
items=json.load(sys.stdin).get("items",[])
for p in items:
  node=p.get("spec",{}).get("nodeName","") or ""
  if node and not node.endswith("-cp") and "control" not in node.lower() and "master" not in node.lower():
    print(p["metadata"]["name"]); break
' 2>/dev/null || true)"
  if [[ -n "${worker}" ]]; then
    echo "pod/${worker}"
  else
    echo "pod/${pod}"
  fi
}

start_proxy() {
  if port_listening "${KUBECTL_PROXY_PORT}"; then
    echo "✓ kubectl proxy already on :${KUBECTL_PROXY_PORT}"
    PROXY_PID=""
    return 0
  fi
  echo "→ kubectl proxy :${KUBECTL_PROXY_PORT}"
  kubectl proxy --port="${KUBECTL_PROXY_PORT}" \
    >"${STATE_DIR}/kubectl-proxy.log" 2>&1 &
  PROXY_PID=$!
  echo "${PROXY_PID}" >"${STATE_DIR}/kubectl-proxy.pid"
  for _ in $(seq 1 30); do
    if port_listening "${KUBECTL_PROXY_PORT}"; then
      echo "✓ kubectl proxy ready"
      return 0
    fi
    if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
      echo "kubectl proxy exited early — see ${STATE_DIR}/kubectl-proxy.log" >&2
      PROXY_PID=""
      return 1
    fi
    sleep 0.2
  done
  echo "Timed out waiting for kubectl proxy on :${KUBECTL_PROXY_PORT}" >&2
  return 1
}

start_agent_forward() {
  if port_listening "${AGENT_PORT}"; then
    # Someone else already owns the port — don't steal it.
    if [[ -z "${PF_PID}" ]]; then
      echo "✓ agent port-forward already on :${AGENT_PORT}"
    fi
    return 0
  fi

  local target
  if ! target="$(pick_agent_target)"; then
    echo "No kern-agent pods/Service in ${AGENT_NS}." >&2
    echo "Install the agent first, or set AGENT_SERVICE / KERN_AGENT_NAMESPACE." >&2
    return 1
  fi

  echo "→ agent port-forward ${AGENT_NS}/${target} → :${AGENT_PORT}"
  kubectl -n "${AGENT_NS}" port-forward "${target}" "${AGENT_PORT}:9474" \
    >"${STATE_DIR}/port-forward.log" 2>&1 &
  PF_PID=$!
  echo "${PF_PID}" >"${STATE_DIR}/port-forward.pid"
  for _ in $(seq 1 40); do
    if port_listening "${AGENT_PORT}"; then
      echo "✓ agent port-forward ready (${target})"
      return 0
    fi
    if ! kill -0 "${PF_PID}" 2>/dev/null; then
      echo "port-forward exited early — see ${STATE_DIR}/port-forward.log" >&2
      tail -5 "${STATE_DIR}/port-forward.log" 2>/dev/null >&2 || true
      PF_PID=""
      return 1
    fi
    sleep 0.25
  done
  echo "Timed out waiting for agent port-forward on :${AGENT_PORT}" >&2
  return 1
}

cleanup() {
  local code=$?
  STOPPING=1
  trap - EXIT INT TERM
  if [[ -n "${PF_PID}" ]] && kill -0 "${PF_PID}" 2>/dev/null; then
    kill "${PF_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PROXY_PID}" ]] && kill -0 "${PROXY_PID}" 2>/dev/null; then
    kill "${PROXY_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PF_PID}" && -f "${STATE_DIR}/port-forward.pid" ]]; then
    if [[ "$(cat "${STATE_DIR}/port-forward.pid" 2>/dev/null || true)" == "${PF_PID}" ]]; then
      rm -f "${STATE_DIR}/port-forward.pid"
    fi
  fi
  if [[ -n "${PROXY_PID}" && -f "${STATE_DIR}/kubectl-proxy.pid" ]]; then
    if [[ "$(cat "${STATE_DIR}/kubectl-proxy.pid" 2>/dev/null || true)" == "${PROXY_PID}" ]]; then
      rm -f "${STATE_DIR}/kubectl-proxy.pid"
    fi
  fi
  exit "${code}"
}

trap cleanup EXIT INT TERM

mkdir -p "${STATE_DIR}"

CONTEXT="$(kubectl config current-context 2>/dev/null || echo unknown)"
echo "KERN local tunnels"
echo "  context: ${CONTEXT}"
echo ""

start_proxy
start_agent_forward || true

echo ""
echo "Listening:"
echo "  K8s API proxy  http://127.0.0.1:${KUBECTL_PROXY_PORT}"
echo "  Agent          http://127.0.0.1:${AGENT_PORT}/health"
echo ""
echo "Keep this terminal open. Ctrl+C stops tunnels started by this script."
echo "Or: ./scripts/stop-kern.sh"
echo "Agent forwards restart automatically if the pod drops."
echo ""

# Supervise: restart agent PF (and proxy if we own it) instead of exiting the session.
backoff=1
while [[ "${STOPPING}" -eq 0 ]]; do
  if [[ -n "${PROXY_PID}" ]] && ! kill -0 "${PROXY_PID}" 2>/dev/null; then
    echo "kubectl proxy exited — restarting…" >&2
    PROXY_PID=""
    start_proxy || true
  fi

  if [[ -n "${PF_PID}" ]] && ! kill -0 "${PF_PID}" 2>/dev/null; then
    echo "agent port-forward dropped (common with hostNetwork agents) — restarting…" >&2
    tail -3 "${STATE_DIR}/port-forward.log" 2>/dev/null | sed 's/^/  /' >&2 || true
    PF_PID=""
    sleep "${backoff}"
    if start_agent_forward; then
      backoff=1
    else
      backoff=$(( backoff < 15 ? backoff * 2 : 15 ))
      echo "  retry in ${backoff}s…" >&2
    fi
    continue
  fi

  # We didn't start PF (pre-existing listener) — still watch the port and recover if it dies.
  if [[ -z "${PF_PID}" ]] && ! port_listening "${AGENT_PORT}"; then
    echo "agent :${AGENT_PORT} not listening — starting port-forward…" >&2
    start_agent_forward || true
  fi

  sleep 2
done
