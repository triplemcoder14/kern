#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE="${KERN_HELM_RELEASE:-kern}"
NS_OPERATOR="${KERN_OPERATOR_NS:-kern-system}"
VALUES="${KERN_OPENSHIFT_VALUES:-${ROOT}/.kern/openshift-values.yaml}"

DRY_RUN=0
UNINSTALL=0
CLEANUP_LEGACY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --cleanup-legacy) CLEANUP_LEGACY=1 ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need oc
need helm

if ! oc whoami >/dev/null 2>&1; then
  echo "Not logged in. Run: oc login --token=... --server=..." >&2
  exit 1
fi

echo "==> Cluster: $(oc config current-context)"
echo "==> User:    $(oc whoami)"

cleanup_legacy_kern() {
  echo "==> Removing legacy KERN resources (kubectl apply / install-kern.sh)"
  oc delete kernmonitor default --ignore-not-found --wait=false 2>/dev/null || true
  oc delete kernalertrule prod-latency-warning prod-drop-critical -n kern --ignore-not-found 2>/dev/null || true
  oc delete deployment kern-operator -n "${NS_OPERATOR}" --ignore-not-found --wait=false 2>/dev/null || true
  oc delete clusterrolebinding kern-operator kern-agent --ignore-not-found 2>/dev/null || true
  oc delete clusterrole kern-operator kern-agent --ignore-not-found 2>/dev/null || true
  oc delete namespace kern --ignore-not-found --wait=false 2>/dev/null || true
  oc delete namespace "${NS_OPERATOR}" --ignore-not-found --wait=false 2>/dev/null || true
  echo "    Legacy KERN RBAC and namespaces removed (CRDs kept)."
}

if [[ "${CLEANUP_LEGACY}" -eq 1 ]]; then
  cleanup_legacy_kern
  exit 0
fi

if [[ "${UNINSTALL}" -eq 1 ]]; then
  echo "==> Uninstalling Helm release ${RELEASE} from ${NS_OPERATOR}"
  helm uninstall "${RELEASE}" -n "${NS_OPERATOR}" 2>/dev/null || true
  cleanup_legacy_kern
  echo "Done. CRDs left in place (cluster-scoped). Delete manually if needed:"
  echo "  oc delete crd kernmonitors.kern.io kernalertrules.kern.io"
  exit 0
fi

if [[ ! -f "${VALUES}" ]]; then
  echo "Values file not found: ${VALUES}" >&2
  exit 1
fi

if helm status "${RELEASE}" -n "${NS_OPERATOR}" >/dev/null 2>&1; then
  echo "Helm release ${RELEASE} already exists in ${NS_OPERATOR}." >&2
  echo "Use --uninstall first, or: helm upgrade ${RELEASE} ..." >&2
  exit 1
fi

if oc get clusterrole kern-operator >/dev/null 2>&1; then
  echo "==> Found existing kern-operator ClusterRole without Helm ownership"
  cleanup_legacy_kern
  sleep 3
fi

HELM_ARGS=(
  install "${RELEASE}" "${ROOT}/deploy/helm/kern"
  -n "${NS_OPERATOR}"
  --create-namespace
  -f "${VALUES}"
)

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "==> Dry run (helm template)"
  helm template "${RELEASE}" "${ROOT}/deploy/helm/kern" -n "${NS_OPERATOR}" -f "${VALUES}"
  exit 0
fi

echo "==> Installing KERN (agent + operator only)"
helm "${HELM_ARGS[@]}"

echo "==> Granting OpenShift SCCs"
oc adm policy add-scc-to-user anyuid -z kern-operator -n "${NS_OPERATOR}" 2>/dev/null || {
  echo "    Could not bind anyuid to kern-operator — ask platform admin if operator pod fails SCC"
}
oc adm policy add-scc-to-user privileged -z kern-agent -n kern 2>/dev/null || {
  echo "    Could not bind privileged to kern-agent — ask platform admin if agent pods fail SCC"
}

echo "==> Waiting for operator..."
if ! oc rollout status deployment/kern-operator -n "${NS_OPERATOR}" --timeout=300s; then
  echo ""
  echo "Operator rollout failed. Diagnose with:"
  echo "  oc get pods -n ${NS_OPERATOR} -o wide"
  echo "  oc describe pod -n ${NS_OPERATOR} -l app=kern-operator"
  echo "  oc get events -n ${NS_OPERATOR} --sort-by='.lastTimestamp' | tail -20"
  echo ""
  echo "Common fixes on OpenShift:"
  echo "  - ImagePullBackOff: add ghcr.io pull secret to ${NS_OPERATOR}"
  echo "    oc create secret docker-registry ghcr-secret --docker-server=ghcr.io \\"
  echo "      --docker-username=USER --docker-password=TOKEN -n ${NS_OPERATOR}"
  echo "    oc secrets link default ghcr-secret --for=pull -n ${NS_OPERATOR}"
  echo "  - SCC denied: oc adm policy add-scc-to-user anyuid -z kern-operator -n ${NS_OPERATOR}"
  exit 1
fi

echo "==> Waiting for KernMonitor..."
for _ in $(seq 1 60); do
  phase="$(oc get kernmonitor default -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  if [[ "${phase}" == "Ready" ]]; then
    break
  fi
  sleep 3
done

echo ""
oc get kernmonitor default 2>/dev/null || true
oc get pods -n "${NS_OPERATOR}" -l app=kern-operator
oc get pods -n kern -l app=kern-agent
oc get svc -n kern kern-agent

cat <<EOF

KERN agent installed in-cluster. Console stays on your laptop.

On your laptop (keep these running while using KERN):
  kubectl proxy --port=8001 &
  oc port-forward -n kern svc/kern-agent 9474:9474 &

Start console:
  cd ${ROOT}
  cp deploy/docker/.env.example deploy/docker/.env   # set credentials once
  npm run dev

In KERN UI → Settings → Connect:
  Agent URL: http://127.0.0.1:9474

Verify:
  curl -s http://127.0.0.1:8001/version | head
  curl -s http://127.0.0.1:9474/health

EOF
