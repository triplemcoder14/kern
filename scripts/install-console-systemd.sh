#!/usr/bin/env bash
# Install KERN console on a Linux VM using systemd (native Node + nginx, or Docker Compose).
#
# Native (default): pulls GHCR images once, extracts artifacts to /opt/kern, enables systemd units.
# Docker: installs compose files to /opt/kern/docker and enables kern-console-docker.service.
#
# Usage:
#   sudo ./scripts/install-console-systemd.sh [--docker] [--version 0.6.0]
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
METHOD="native"
KERN_VERSION="${KERN_VERSION:-0.6.0}"
REGISTRY="${KERN_REGISTRY:-ghcr.io/triplemcoder14}"
ENV_FILE="/etc/kern/console.env"
INSTALL_DIR="/opt/kern"
DATA_DIR="/var/lib/kern/data"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Install the KERN console (UI + API) as systemd services on Linux.

Options:
  --docker          Run console via Docker Compose (requires Docker)
  --native          Run API with Node + static UI with nginx (default)
  --version TAG     GHCR image tag, e.g. 0.6.0 (default: ${KERN_VERSION})
  -h, --help        Show this help

Before first start, edit ${ENV_FILE} — set KERN_USERNAME, KERN_PASSWORD, KERN_AUTH_SECRET,
KERN_PUBLIC_ORIGIN, KERN_K8S_PROXY, and KERN_EBPF_COLLECTOR.

Docs: docs/INSTALL.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) METHOD="docker" ;;
    --native) METHOD="native" ;;
    --version)
      KERN_VERSION="$2"
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

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

echo "==> Installing KERN console (${METHOD}, version ${KERN_VERSION})"

mkdir -p /etc/kern /var/log/kern /run/kern "${DATA_DIR}"
chmod 700 /etc/kern

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT}/deploy/systemd/console.env.example" "${ENV_FILE}"
  sed -i "s/^KERN_VERSION=.*/KERN_VERSION=${KERN_VERSION}/" "${ENV_FILE}" 2>/dev/null \
    || sed -i '' "s/^KERN_VERSION=.*/KERN_VERSION=${KERN_VERSION}/" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "==> Created ${ENV_FILE} — edit credentials before starting services"
else
  echo "==> Using existing ${ENV_FILE}"
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"
CONSOLE_PORT="${KERN_CONSOLE_PORT:-8080}"

if [[ "${METHOD}" == "docker" ]]; then
  require_cmd docker
  DOCKER_DIR="${INSTALL_DIR}/docker"
  mkdir -p "${DOCKER_DIR}"
  cp "${ROOT}/deploy/docker/docker-compose.self-hosted.yml" "${DOCKER_DIR}/"
  cp "${ROOT}/deploy/docker/.env.example" "${DOCKER_DIR}/.env.example"

  cat >"${DOCKER_DIR}/.env" <<EOF
KERN_USERNAME=${KERN_USERNAME:-admin}
KERN_PASSWORD=${KERN_PASSWORD:-change-me-on-install}
KERN_AUTH_SECRET=${KERN_AUTH_SECRET:-replace-with-a-long-random-string}
KERN_PUBLIC_ORIGIN=${KERN_PUBLIC_ORIGIN:-http://localhost:${CONSOLE_PORT}}
KERN_CONSOLE_PORT=${CONSOLE_PORT}
KERN_K8S_PROXY=${KERN_K8S_PROXY:-http://host.docker.internal:8001}
KERN_EBPF_COLLECTOR=${KERN_EBPF_COLLECTOR:-http://host.docker.internal:9474}
KERN_VERSION=${KERN_VERSION}
EOF

  cp "${ROOT}/deploy/systemd/kern-console-docker.service" /etc/systemd/system/kern-console.service
  systemctl daemon-reload
  systemctl enable kern-console.service

  echo ""
  echo "Installed Docker Compose console to ${DOCKER_DIR}"
  echo "  sudo systemctl start kern-console"
  echo "  Open ${KERN_PUBLIC_ORIGIN:-http://localhost:${CONSOLE_PORT}}/login"
  exit 0
fi

require_cmd docker
require_cmd node
require_cmd nginx

if ! id kern >/dev/null 2>&1; then
  useradd --system --home "${DATA_DIR}" --shell /usr/sbin/nologin kern
fi

API_IMAGE="${REGISTRY}/kern-api:${KERN_VERSION}"
WEB_IMAGE="${REGISTRY}/kern-web:${KERN_VERSION}"

echo "==> Pulling ${API_IMAGE}"
docker pull "${API_IMAGE}"
echo "==> Pulling ${WEB_IMAGE}"
docker pull "${WEB_IMAGE}"

mkdir -p "${INSTALL_DIR}/api" "${INSTALL_DIR}/web"
chown -R kern:kern "${DATA_DIR}"

echo "==> Extracting API from container"
docker rm -f kern-install-api >/dev/null 2>&1 || true
cid="$(docker create --name kern-install-api "${API_IMAGE}")"
docker cp "${cid}:/kern/api/." "${INSTALL_DIR}/api/"
docker rm "${cid}" >/dev/null

echo "==> Extracting web UI from container"
docker rm -f kern-install-web >/dev/null 2>&1 || true
cid="$(docker create --name kern-install-web "${WEB_IMAGE}")"
docker cp "${cid}:/usr/share/nginx/html/." "${INSTALL_DIR}/web/"
docker rm "${cid}" >/dev/null

chown -R kern:kern "${INSTALL_DIR}/api" "${DATA_DIR}"

sed "s/\${KERN_CONSOLE_PORT}/${CONSOLE_PORT}/g" \
  "${ROOT}/deploy/nginx/kern-console-host.conf" >/etc/kern/nginx.conf

cp "${ROOT}/deploy/systemd/kern-api.service" /etc/systemd/system/
cp "${ROOT}/deploy/systemd/kern-web.service" /etc/systemd/system/

systemctl daemon-reload
systemctl enable kern-api.service kern-web.service

echo ""
echo "Installed native console to ${INSTALL_DIR}"
echo "  Edit ${ENV_FILE} if you have not already"
echo "  sudo systemctl start kern-api kern-web"
echo "  Open ${KERN_PUBLIC_ORIGIN:-http://localhost:${CONSOLE_PORT}}/login"
echo ""
echo "Keep kubectl proxy and agent port-forward running on this host, or point"
echo "KERN_K8S_PROXY / KERN_EBPF_COLLECTOR in ${ENV_FILE} at reachable endpoints."
