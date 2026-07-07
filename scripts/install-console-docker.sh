#!/usr/bin/env bash
# Install KERN console with Docker Compose (Linux or macOS).
#
# Usage:
#   ./scripts/install-console-docker.sh [--build] [--version 0.6.0]
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_DIR="${ROOT}/deploy/docker"
COMPOSE_FILE="docker-compose.self-hosted.yml"
KERN_VERSION="${KERN_VERSION:-0.6.0}"
BUILD=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Run the KERN console (UI + API) with Docker Compose.

Options:
  --build           Build images from source instead of pulling from GHCR
  --version TAG     GHCR image tag when pulling (default: ${KERN_VERSION})
  -h, --help        Show this help

Setup:
  cd deploy/docker && cp .env.example .env
  Edit .env — KERN_USERNAME, KERN_PASSWORD, KERN_AUTH_SECRET, KERN_PUBLIC_ORIGIN

Docs: docs/INSTALL.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1 ;;
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

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required: https://docs.docker.com/get-docker/" >&2
  exit 1
fi

cd "${COMPOSE_DIR}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Created deploy/docker/.env — edit credentials before continuing"
fi

export KERN_VERSION

if [[ "${BUILD}" -eq 1 ]]; then
  echo "==> Building and starting console from source"
  docker compose -f "${COMPOSE_FILE}" up -d --build --remove-orphans
else
  echo "==> Pulling ghcr.io/triplemcoder14/kern-api:${KERN_VERSION} and kern-web:${KERN_VERSION}"
  docker compose -f "${COMPOSE_FILE}" pull || true
  echo "==> Starting console"
  docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans
fi

# shellcheck disable=SC1091
source .env
ORIGIN="${KERN_PUBLIC_ORIGIN:-http://localhost:${KERN_CONSOLE_PORT:-8080}}"

echo ""
echo "KERN console is starting."
echo "  Open ${ORIGIN}/login"
echo "  Logs: docker compose -f ${COMPOSE_FILE} logs -f"
echo "  Stop: docker compose -f ${COMPOSE_FILE} down"
