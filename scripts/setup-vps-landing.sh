#!/usr/bin/env bash
# Prepare web root + nginx snippet on a VPS that ALREADY runs nginx.
# Does NOT install nginx, certbot, or replace your main config.
#
#   sudo bash scripts/setup-vps-landing.sh
#
# After this, add to your existing server block for kern.muutassim.xyz:
#   root /var/www/kern;
#   index index.html;
#   include /etc/nginx/snippets/kern-locations.conf;
#
# Then: sudo nginx -t && sudo systemctl reload nginx
#
set -euo pipefail

DOMAIN="${KERN_DEPLOY_DOMAIN:-kern.muutassim.xyz}"
WEB_ROOT="${KERN_DEPLOY_PATH:-/var/www/kern}"
SNIPPET_DST="${KERN_NGINX_SNIPPET:-/etc/nginx/snippets/kern-locations.conf}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNIPPET_SRC="${REPO_ROOT}/deploy/nginx/kern-locations.conf"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx not found. Install nginx on the VPS first, then re-run." >&2
  exit 1
fi

echo "==> Using existing nginx ($(nginx -v 2>&1))"
echo "==> Creating web root ${WEB_ROOT}"
mkdir -p "${WEB_ROOT}"
chown -R www-data:www-data "${WEB_ROOT}" 2>/dev/null || chown -R nginx:nginx "${WEB_ROOT}" 2>/dev/null || true

echo "==> Installing location snippet -> ${SNIPPET_DST}"
mkdir -p "$(dirname "${SNIPPET_DST}")"
cp "${SNIPPET_SRC}" "${SNIPPET_DST}"

echo ""
echo "Done. No nginx restart was performed."
echo ""
echo "Add this inside your existing server { } for ${DOMAIN}:"
echo ""
echo "  root ${WEB_ROOT};"
echo "  index index.html;"
echo "  include ${SNIPPET_DST};"
echo ""
echo "If you use gzip/security headers globally, keep those as-is."
echo "If TLS is not set up yet, use certbot on your existing vhost:"
echo "  certbot --nginx -d ${DOMAIN}"
echo ""
echo "Deploy static files from your laptop:"
echo "  export KERN_DEPLOY_HOST=you@${DOMAIN}"
echo "  npm run deploy:landing"
echo ""
echo "Optional API (OAuth + console) via Docker:"
echo "  cd deploy/docker && cp .env.example .env"
echo "  docker compose up -d --build"
echo "  — or from laptop: npm run deploy:docker"
