#!/usr/bin/env bash
# Build KERN agent + operator locally and push to OpenShift internal registry.
# Use when GHCR tags are missing or the cluster cannot pull from ghcr.io.
#
# Usage:
#   ./scripts/push-kern-images-openshift.sh
#   ./scripts/push-kern-images-openshift.sh --tag local
#
# Then upgrade Helm:
#   helm upgrade kern ./deploy/helm/kern -n kern-system -f .kern/openshift-values.yaml \
#     --set operator.image=<printed-operator-image> \
#     --set agent.image=<printed-agent-image>
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${KERN_IMAGE_TAG:-local}"
NS_OPERATOR="${KERN_OPERATOR_NS:-kern-system}"
NS_AGENT="${KERN_AGENT_NS:-kern}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing: $1" >&2
    exit 1
  }
}

need docker
need oc

if ! oc whoami >/dev/null 2>&1; then
  echo "Run oc login first." >&2
  exit 1
fi

REGISTRY="${KERN_OPENSHIFT_REGISTRY:-}"
if [[ -z "${REGISTRY}" ]]; then
  REGISTRY="$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}' 2>/dev/null || true)"
fi
if [[ -z "${REGISTRY}" ]]; then
  echo "Could not resolve OpenShift image registry route." >&2
  echo "Set KERN_OPENSHIFT_REGISTRY or ask platform team for the registry host." >&2
  exit 1
fi

OPERATOR_IMAGE="${REGISTRY}/${NS_OPERATOR}/kern-operator:${TAG}"
AGENT_IMAGE="${REGISTRY}/${NS_AGENT}/kern-agent:${TAG}"

echo "==> Registry: ${REGISTRY}"
echo "==> Operator: ${OPERATOR_IMAGE}"
echo "==> Agent:    ${AGENT_IMAGE}"

echo "==> Logging in to OpenShift registry"
docker login -u "$(oc whoami)" -p "$(oc whoami -t)" "${REGISTRY}"

# Cross-compile to linux/amd64 on Apple Silicon (native BUILDPLATFORM build stage).
BUILDER="${KERN_BUILDX_BUILDER:-kern-openshift}"
if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  docker buildx create --name "${BUILDER}" --use
else
  docker buildx use "${BUILDER}"
fi
docker buildx inspect --bootstrap >/dev/null

echo "==> Building operator (linux/amd64)"
docker buildx build --platform linux/amd64 --load -t "${OPERATOR_IMAGE}" "${ROOT}/operator"

echo "==> Building agent (linux/amd64)"
docker buildx build --platform linux/amd64 --load -t "${AGENT_IMAGE}" "${ROOT}/agent"

echo "==> Pushing images"
docker push "${OPERATOR_IMAGE}"
docker push "${AGENT_IMAGE}"

cat <<EOF

Images pushed. Upgrade Helm release:

  helm upgrade kern ${ROOT}/deploy/helm/kern -n ${NS_OPERATOR} \\
    -f ${ROOT}/.kern/openshift-values.yaml \\
    --set operator.image=${OPERATOR_IMAGE} \\
    --set agent.image=${AGENT_IMAGE} \\
    --set operator.imagePullPolicy=Always \\
    --set agent.imagePullPolicy=Always

Then watch rollout:

  oc rollout status deployment/kern-operator -n ${NS_OPERATOR} --timeout=300s
  oc get pods -n ${NS_OPERATOR} -l app=kern-operator
  oc get pods -n ${NS_AGENT} -l app=kern-agent

EOF
