#!/usr/bin/env bash
# Start kubectl proxy (:8001) + kern-agent port-forward (:9474) together.
# Keep this terminal open while using the local console.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${KERN_STATE_DIR:-$ROOT/.kern/dev}"
KUBECTL_PROXY_PORT="${KERN_K8S_PROXY_PORT:-8001}"
AGENT_PORT="${KERN_AGENT_PORT:-9474}"
AGENT_NS="${KERN_AGENT_NAMESPACE:-kern}"
AGENT_SERVICE="${AGENT_SERVICE:-kern-agent}"

PROXY_PID=""
PF_PID=""

usage() {
  cat <<EOF
Usage: $(basename "$0")

Starts both local tunnels for the KERN console:
  - kubectl proxy          → http://127.0.0.1:${KUBECTL_PROXY_PORT}
  - agent port-forward     → http://127.0.0.1:${AGENT_PORT}

Uses the current kubectl context. Ctrl+C stops both.

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

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "${PF_PID}" ]] && kill -0 "${PF_PID}" 2>/dev/null; then
    kill "${PF_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PROXY_PID}" ]] && kill -0 "${PROXY_PID}" 2>/dev/null; then
    kill "${PROXY_PID}" 2>/dev/null || true
  fi
  # Only remove pidfiles we own.
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

if port_listening "${KUBECTL_PROXY_PORT}"; then
  echo "✓ kubectl proxy already on :${KUBECTL_PROXY_PORT}"
else
  echo "→ kubectl proxy :${KUBECTL_PROXY_PORT}"
  kubectl proxy --port="${KUBECTL_PROXY_PORT}" \
    >"${STATE_DIR}/kubectl-proxy.log" 2>&1 &
  PROXY_PID=$!
  echo "${PROXY_PID}" >"${STATE_DIR}/kubectl-proxy.pid"
  for _ in $(seq 1 30); do
    if port_listening "${KUBECTL_PROXY_PORT}"; then
      break
    fi
    if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
      echo "kubectl proxy exited early — see ${STATE_DIR}/kubectl-proxy.log" >&2
      exit 1
    fi
    sleep 0.2
  done
  if ! port_listening "${KUBECTL_PROXY_PORT}"; then
    echo "Timed out waiting for kubectl proxy on :${KUBECTL_PROXY_PORT}" >&2
    exit 1
  fi
  echo "✓ kubectl proxy ready"
fi

if port_listening "${AGENT_PORT}"; then
  echo "✓ agent port-forward already on :${AGENT_PORT}"
else
  if ! kubectl -n "${AGENT_NS}" get "svc/${AGENT_SERVICE}" >/dev/null 2>&1; then
    echo "Service ${AGENT_NS}/${AGENT_SERVICE} not found." >&2
    echo "Install the agent first, or set AGENT_SERVICE / KERN_AGENT_NAMESPACE." >&2
    exit 1
  fi
  echo "→ agent port-forward ${AGENT_NS}/${AGENT_SERVICE} → :${AGENT_PORT}"
  kubectl -n "${AGENT_NS}" port-forward "svc/${AGENT_SERVICE}" "${AGENT_PORT}:9474" \
    >"${STATE_DIR}/port-forward.log" 2>&1 &
  PF_PID=$!
  echo "${PF_PID}" >"${STATE_DIR}/port-forward.pid"
  for _ in $(seq 1 40); do
    if port_listening "${AGENT_PORT}"; then
      break
    fi
    if ! kill -0 "${PF_PID}" 2>/dev/null; then
      echo "port-forward exited early — see ${STATE_DIR}/port-forward.log" >&2
      exit 1
    fi
    sleep 0.25
  done
  if ! port_listening "${AGENT_PORT}"; then
    echo "Timed out waiting for agent port-forward on :${AGENT_PORT}" >&2
    echo "Tip: hostNetwork agents can be flaky via Service PF — try a specific pod." >&2
    exit 1
  fi
  echo "✓ agent port-forward ready"
fi

echo ""
echo "Listening:"
echo "  K8s API proxy  http://127.0.0.1:${KUBECTL_PROXY_PORT}"
echo "  Agent          http://127.0.0.1:${AGENT_PORT}/health"
echo ""
echo "Keep this terminal open. Ctrl+C stops tunnels started by this script."
echo "Or: ./scripts/stop-kern.sh"

# Stay alive while tunnels we started are running; if both were pre-existing, wait forever.
if [[ -n "${PROXY_PID}" || -n "${PF_PID}" ]]; then
  while true; do
    if [[ -n "${PROXY_PID}" ]] && ! kill -0 "${PROXY_PID}" 2>/dev/null; then
      echo "kubectl proxy exited" >&2
      exit 1
    fi
    if [[ -n "${PF_PID}" ]] && ! kill -0 "${PF_PID}" 2>/dev/null; then
      echo "agent port-forward exited" >&2
      exit 1
    fi
    sleep 2
  done
fi

# Pre-existing listeners only — block until interrupted.
while true; do
  sleep 3600
done
