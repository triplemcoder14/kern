#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/docker-arch.sh
source "${ROOT}/scripts/lib/docker-arch.sh"

IMAGE="${AGENT_IMAGE:-kern/agent:latest}"
USE_MINIKUBE_DOCKER=0

pull_with_retry() {
  local image="$1"
  local attempt
  for attempt in 1 2 3; do
    echo "Pulling $image (attempt $attempt/3)..."
    if docker pull "$image"; then
      return 0
    fi
    echo "Pull failed, pruning build cache and retrying..."
    docker builder prune -f >/dev/null 2>&1 || true
    sleep 2
  done
  echo "Failed to pull $image after 3 attempts."
  echo "Try manually: docker builder prune -f && docker pull $image"
  return 1
}

if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
  echo "Building directly in minikube Docker (avoids stale image load)..."
  # shellcheck disable=SC1091
  eval "$(minikube docker-env)"
  USE_MINIKUBE_DOCKER=1
fi

echo "Pre-pulling base images (avoids corrupted partial layers)..."
pull_with_retry "golang:1.25-alpine"
pull_with_retry "gcr.io/distroless/static-debian12"

echo "Building KERN agent image: $IMAGE"
kern_build_go_image "$ROOT/agent" "$IMAGE" --network=host --pull

if [[ "$USE_MINIKUBE_DOCKER" -eq 0 ]] && command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
  echo "Loading image into minikube..."
  minikube image rm "$IMAGE" >/dev/null 2>&1 || true
  minikube image load "$IMAGE"
fi

echo "Removing legacy flow-collector (conflicts on port 9474)..."
kubectl delete daemonset flow-collector -n kern --ignore-not-found
kubectl delete service flow-collector -n kern --ignore-not-found
kubectl delete serviceaccount flow-collector -n kern --ignore-not-found
kubectl delete clusterrole kern-flow-collector --ignore-not-found
kubectl delete clusterrolebinding kern-flow-collector --ignore-not-found

echo "Applying DaemonSet..."
kubectl apply -f "$ROOT/agent/deploy/daemonset.yaml"
kubectl rollout restart daemonset/kern-agent -n kern
kubectl rollout status daemonset/kern-agent -n kern --timeout=90s

echo ""
POD="$(kubectl get pod -n kern -l app=kern-agent -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "$POD" ]]; then
  echo "Agent pod: $POD"
  kubectl logs -n kern "$POD" --tail=8 2>/dev/null || true
fi

echo ""
echo "KERN agent deployed (ProcNet mode)."
echo ""
echo "Prefer the operator install for production:"
echo "  ./scripts/install-kern.sh"
echo ""
echo "Port-forward (if not already running):"
echo "  ./scripts/port-forward-agent.sh"
echo ""
echo "Health check:"
echo "  curl http://127.0.0.1:9474/health"
echo "  curl http://127.0.0.1:9474/api/v1/agent"
