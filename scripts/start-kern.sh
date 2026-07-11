#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${KERN_STATE_DIR:-$ROOT/.kern/dev}"
KUBECTL_PROXY_PORT="${KERN_K8S_PROXY_PORT:-8001}"
AGENT_PORT="${KERN_AGENT_PORT:-9474}"
SKIP_AGENT=0
FORCE_AGENT=0
QUICK=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Bootstraps KERN for local development:
  - npm dependencies (root + api)
  - kubectl proxy on :${KUBECTL_PROXY_PORT}
  - in-cluster agent (unless already running)
  - agent port-forward on :${AGENT_PORT}
  - UI + API via npm run dev

Then open http://localhost:5173/login → sign in → Settings → Connect.

Options:
  --quick         Skip agent deploy when kern-agent is already Running
  --skip-agent    Skip agent deploy entirely (agent URL must already work)
  --force-agent   Always rebuild and redeploy the agent
  -h, --help      Show this help

Stop background services: ./scripts/stop-kern.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) QUICK=1 ;;
    --skip-agent) SKIP_AGENT=1 ;;
    --force-agent) FORCE_AGENT=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_cmd() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "Missing required command: $cmd" >&2
      exit 1
    fi
  done
}

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local port="$1"
  local label="$2"
  local attempts=30
  local i=0
  while ! port_listening "$port"; do
    i=$((i + 1))
    if [[ "$i" -ge "$attempts" ]]; then
      echo "Timed out waiting for ${label} on port ${port}" >&2
      exit 1
    fi
    sleep 1
  done
}

write_pid() {
  local name="$1"
  local pid="$2"
  echo "$pid" >"${STATE_DIR}/${name}.pid"
}

start_kubectl_proxy() {
  if port_listening "$KUBECTL_PROXY_PORT"; then
    echo "✓ kubectl proxy already listening on :${KUBECTL_PROXY_PORT}"
    return
  fi

  echo "→ Starting kubectl proxy on :${KUBECTL_PROXY_PORT}..."
  kubectl proxy --port="${KUBECTL_PROXY_PORT}" >"${STATE_DIR}/kubectl-proxy.log" 2>&1 &
  write_pid kubectl-proxy "$!"
  wait_for_port "$KUBECTL_PROXY_PORT" "kubectl proxy"
  echo "✓ kubectl proxy ready"
}

agent_pod_running() {
  local phase
  phase="$(kubectl get pods -n kern -l app=kern-agent -o jsonpath='{.items[0].status.phase}' 2>/dev/null || true)"
  [[ "$phase" == "Running" ]]
}

deploy_agent() {
  if [[ "$SKIP_AGENT" -eq 1 ]]; then
    echo "⊘ Skipping agent deploy (--skip-agent)"
    return
  fi

  if [[ "$FORCE_AGENT" -eq 0 && "$QUICK" -eq 1 ]] && agent_pod_running; then
    echo "✓ kern-agent already Running (--quick)"
    return
  fi

  if [[ "$FORCE_AGENT" -eq 0 && "$QUICK" -eq 0 ]] && agent_pod_running; then
    echo "✓ kern-agent already Running (use --force-agent to rebuild)"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required to build the agent image." >&2
    exit 1
  fi

  echo "→ Building and deploying kern-agent (this may take a few minutes)..."
  "$ROOT/scripts/deploy-agent.sh"
}

start_agent_port_forward() {
  if port_listening "$AGENT_PORT"; then
    echo "✓ agent port-forward already listening on :${AGENT_PORT}"
    return
  fi

  if ! kubectl get svc kern-agent -n kern >/dev/null 2>&1; then
    echo "kern-agent service not found — deploy the agent first (remove --skip-agent)." >&2
    exit 1
  fi

  echo "→ Port-forwarding kern-agent :${AGENT_PORT} → localhost..."
  kubectl port-forward -n kern "svc/kern-agent" "${AGENT_PORT}:9474" \
    >"${STATE_DIR}/port-forward.log" 2>&1 &
  write_pid port-forward "$!"
  wait_for_port "$AGENT_PORT" "agent port-forward"
  echo "✓ agent reachable at http://127.0.0.1:${AGENT_PORT}"
}

install_dependencies() {
  echo "→ Checking npm dependencies..."
  if [[ ! -d "$ROOT/node_modules" ]]; then
    npm install --prefix "$ROOT"
  fi
  if [[ ! -d "$ROOT/api/node_modules" ]]; then
    npm install --prefix "$ROOT/api"
  fi
  echo "✓ dependencies ready"
}

check_cluster() {
  echo "→ Checking Kubernetes cluster..."
  if ! kubectl cluster-info >/dev/null 2>&1; then
    echo "Cannot reach a Kubernetes cluster. Point kubectl at your cluster and retry." >&2
    echo "  kubectl config use-context <your-context>" >&2
    exit 1
  fi
  echo "✓ cluster: $(kubectl config current-context 2>/dev/null || echo unknown)"
}

print_banner() {
  cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  KERN is ready — self-hosted observability
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Console:  http://localhost:5173/login
  API:      http://127.0.0.1:3000/api
  Agent:    http://127.0.0.1:${AGENT_PORT}

  Console login:
    username: ${KERN_USERNAME}
    password: ${KERN_PASSWORD}

  1. Sign in at /login
  2. Open Settings → Connect (agent URL defaults to http://127.0.0.1:${AGENT_PORT})
  3. K8s proxy is server-side at http://127.0.0.1:${KUBECTL_PROXY_PORT}

  Ctrl+C stops UI + API only.
  Background proxy/port-forward: ./scripts/stop-kern.sh

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
}

mkdir -p "$STATE_DIR"

export KERN_USERNAME="${KERN_USERNAME:-admin}"
export KERN_PASSWORD="${KERN_PASSWORD:-change-me-on-install}"
export KERN_AUTH_SECRET="${KERN_AUTH_SECRET:-kern-dev-auth-secret-change-me}"

echo ""
echo "KERN — local setup"
echo ""

require_cmd kubectl node npm
check_cluster
install_dependencies
start_kubectl_proxy
deploy_agent
start_agent_port_forward
print_banner

cd "$ROOT"
exec npm run dev
