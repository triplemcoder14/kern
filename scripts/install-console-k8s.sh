#!/usr/bin/env bash
# Deploy KERN console to Kubernetes.
#
# Usage:
#   ./scripts/install-console-k8s.sh [--version 0.6.0] [--host kern-console.example.com]
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONSOLE_DIR="${ROOT}/deploy/k8s/console"
KERN_VERSION="${KERN_VERSION:-0.6.0}"
INGRESS_HOST="${KERN_INGRESS_HOST:-kern-console.local}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Apply console manifests to the current kubectl context.

Options:
  --version TAG     Image tag for kern-api / kern-web (default: ${KERN_VERSION})
  --host HOST       Ingress host (default: ${INGRESS_HOST})
  -h, --help        Show this help

Before applying, create the auth secret:
  cp deploy/k8s/console/secret.example.yaml /tmp/kern-console-secret.yaml
  # edit username, password, auth secret
  kubectl apply -f /tmp/kern-console-secret.yaml

Docs: docs/INSTALL.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      KERN_VERSION="$2"
      shift
      ;;
    --host)
      INGRESS_HOST="$2"
      shift
      ;;
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

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

if ! kubectl get secret kern-console-auth -n kern-console >/dev/null 2>&1; then
  echo "Missing secret kern-console-auth in namespace kern-console." >&2
  echo "Create it from deploy/k8s/console/secret.example.yaml first." >&2
  exit 1
fi

echo "==> Applying namespace"
kubectl apply -f "${CONSOLE_DIR}/namespace.yaml"

TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT

sed \
  -e "s|ghcr.io/triplemcoder14/kern-api:0.6.0|ghcr.io/triplemcoder14/kern-api:${KERN_VERSION}|g" \
  -e "s|ghcr.io/triplemcoder14/kern-web:0.6.0|ghcr.io/triplemcoder14/kern-web:${KERN_VERSION}|g" \
  -e "s|value: http://kern-console.local|value: http://${INGRESS_HOST}|g" \
  -e "s|host: kern-console.local|host: ${INGRESS_HOST}|g" \
  "${CONSOLE_DIR}/api.yaml" >"${TMP}"
kubectl apply -f "${TMP}"

sed \
  -e "s|ghcr.io/triplemcoder14/kern-web:0.6.0|ghcr.io/triplemcoder14/kern-web:${KERN_VERSION}|g" \
  -e "s|host: kern-console.local|host: ${INGRESS_HOST}|g" \
  "${CONSOLE_DIR}/web.yaml" >"${TMP}"
kubectl apply -f "${TMP}"

echo ""
echo "Console deployed to namespace kern-console (version ${KERN_VERSION})."
echo "  Ingress host: ${INGRESS_HOST}"
echo "  Open http://${INGRESS_HOST}/login (add DNS or /etc/hosts)"
echo "  kubectl get pods -n kern-console"
