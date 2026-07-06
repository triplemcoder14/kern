#!/usr/bin/env bash
# Build and run KERN API in Docker on the VPS (existing nginx proxies to it).
#
# Usage:
#   export KERN_DEPLOY_HOST=you@kern.muutassim.xyz
#   npm run deploy:docker
#
# First time on VPS: create deploy/docker/.env from .env.example
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="${KERN_DEPLOY_DIR:-/opt/kern}"
COMPOSE_DIR="${REMOTE_DIR}/deploy/docker"

resolve_host() {
  local raw="${KERN_DEPLOY_HOST:-}"
  if [[ -z "${raw}" ]]; then
    echo "Set KERN_DEPLOY_HOST, e.g. export KERN_DEPLOY_HOST=you@kern.muutassim.xyz" >&2
    exit 1
  fi
  if [[ "${raw}" == *@* ]]; then
    echo "${raw}"
    return
  fi
  local user="${KERN_DEPLOY_USER:-root}"
  echo "${user}@${raw}"
}

SSH_TARGET="$(resolve_host)"

cd "${ROOT}"

echo "==> Building API"
npm run build --prefix api

if [[ ! -f api/dist/api/src/main.js ]]; then
  echo "api/dist missing — build failed" >&2
  exit 1
fi

echo "==> Syncing repo to ${SSH_TARGET}:${REMOTE_DIR}/"
rsync -avz --delete \
  --exclude node_modules \
  --exclude api/node_modules \
  --exclude dist \
  --exclude api/dist \
  --exclude .git \
  --exclude api/data \
  "${ROOT}/" "${SSH_TARGET}:${REMOTE_DIR}/"

echo "==> Building and starting Docker (kern-web on fundtrail_default)"
ssh "${SSH_TARGET}" "cd ${COMPOSE_DIR} && docker compose -f docker-compose.prod.yml up -d --build kern-web"

echo ""
echo "KERN API running on 127.0.0.1:3000 (Docker)."
echo "Ensure nginx includes deploy/nginx/kern-locations.conf for /api proxy."
