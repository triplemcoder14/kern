#!/usr/bin/env bash
# Build the KERN web app and rsync static assets to the VPS.
#
# Usage:
#   export KERN_DEPLOY_HOST=you@your.vps.ip   # or you@kern.muutassim.xyz
#   npm run deploy:landing
#
# Env:
#   KERN_DEPLOY_HOST   SSH target (required)
#   KERN_DEPLOY_USER   SSH user if HOST has no user@ prefix (default: root)
#   KERN_DEPLOY_PATH   Remote web root (default: /var/www/kern)
#   KERN_SKIP_BUILD=1  Skip npm run build:web
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_PATH="${KERN_DEPLOY_PATH:-/var/www/kern}"

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

if [[ "${KERN_SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building web app (production)"
  npm run build:web
fi

if [[ ! -d dist ]]; then
  echo "dist/ missing — run npm run build:web first" >&2
  exit 1
fi

echo "==> Uploading dist/ -> ${SSH_TARGET}:${REMOTE_PATH}/"
rsync -avz --delete \
  --rsync-path="mkdir -p ${REMOTE_PATH} && rsync" \
  dist/ "${SSH_TARGET}:${REMOTE_PATH}/"

echo "==> Reloading nginx on remote (reload only — uses your existing nginx)"
ssh "${SSH_TARGET}" "command -v nginx >/dev/null && (sudo nginx -t && sudo systemctl reload nginx) || echo 'Skipped nginx reload (not installed or no sudo)'"

echo ""
echo "Static files uploaded to ${REMOTE_PATH} on ${SSH_TARGET}."
echo "Ensure your existing nginx vhost for kern.muutassim.xyz serves that path"
echo "(see deploy/nginx/kern-locations.conf — include in your server block)."
