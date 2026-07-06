#!/usr/bin/env bash
# One-command KERN install: CRD + operator + default KernMonitor (agent DaemonSet).
#
#   ./scripts/install-kern.sh
#
# Options:
#   SKIP_BUILD=1          Skip docker builds
#   AGENT_IMAGE=...       Agent image (default kern/agent:latest)
#   OPERATOR_IMAGE=...    Operator image (default kern/operator:latest)
#   IMAGE_PULL_POLICY=... KernMonitor agent pull policy (Never for minikube)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_IMAGE="${AGENT_IMAGE:-kern/agent:latest}"
OPERATOR_IMAGE="${OPERATOR_IMAGE:-kern/operator:latest}"
PULL_POLICY="${IMAGE_PULL_POLICY:-IfNotPresent}"
USE_MINIKUBE_DOCKER=0

if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
  eval "$(minikube docker-env)"
  USE_MINIKUBE_DOCKER=1
  PULL_POLICY="${IMAGE_PULL_POLICY:-Never}"
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building agent image ${AGENT_IMAGE}"
  docker build -t "${AGENT_IMAGE}" "${ROOT}/agent"
  echo "==> Building operator image ${OPERATOR_IMAGE}"
  docker build -t "${OPERATOR_IMAGE}" "${ROOT}/operator"
fi

if [[ "$USE_MINIKUBE_DOCKER" -eq 0 ]] && command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
  minikube image load "${AGENT_IMAGE}" || true
  minikube image load "${OPERATOR_IMAGE}" || true
fi

echo "==> Installing CRDs"
kubectl apply -f "${ROOT}/deploy/operator/crd/kernmonitors.kern.io.yaml"
kubectl apply -f "${ROOT}/deploy/operator/crd/kernalertrules.kern.io.yaml"

echo "==> Installing operator"
kubectl apply -f "${ROOT}/deploy/operator/operator.yaml"
kubectl set image deployment/kern-operator -n kern-system manager="${OPERATOR_IMAGE}" >/dev/null 2>&1 || true
kubectl rollout status deployment/kern-operator -n kern-system --timeout=120s

echo "==> Applying default KernMonitor"
MONITOR_FILE="$(mktemp)"
sed "s/imagePullPolicy: IfNotPresent/imagePullPolicy: ${PULL_POLICY}/" \
  "${ROOT}/deploy/operator/kernmonitor-default.yaml" > "${MONITOR_FILE}"
kubectl apply -f "${MONITOR_FILE}"
rm -f "${MONITOR_FILE}"

if [[ "${INSTALL_SAMPLE_ALERT_RULES:-1}" == "1" ]]; then
  echo "==> Applying sample KernAlertRules"
  kubectl apply -f "${ROOT}/deploy/operator/samples/kernalertrule-default.yaml"
fi

echo ""
echo "Waiting for agent DaemonSet..."
for _ in $(seq 1 40); do
  PHASE="$(kubectl get kernmonitor default -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  if [[ "${PHASE}" == "Ready" ]]; then
    break
  fi
  sleep 3
done

echo ""
kubectl get kernmonitors
kubectl get daemonset -n kern
echo ""
echo "Helm install (alternative):"
echo "  helm install kern ${ROOT}/deploy/helm/kern -n kern-system --create-namespace"
echo ""
echo "GitOps:"
echo "  Flux:  kubectl apply -f ${ROOT}/deploy/gitops/flux/helmrelease.yaml"
echo "  Argo:  kubectl apply -f ${ROOT}/deploy/gitops/argo/application.yaml"
echo ""
echo "KERN installed."
echo "  Agent in-cluster: $(kubectl get kernmonitor default -o jsonpath='{.status.agentService}' 2>/dev/null || echo kern-agent.kern.svc.cluster.local:9474)"
echo "  Local dev port-forward: ./scripts/port-forward-agent.sh"
echo "  Health: curl http://127.0.0.1:9474/health"
