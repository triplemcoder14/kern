#!/usr/bin/env bash
# Build and deploy the KERN landing page to trykern.xyz on the VPS.
#
# Uses fundtrail-nginx (ports 80/443) + kern-web container on fundtrail_default.
#
# Usage:
#   ./scripts/deploy-landing.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${KERN_DEPLOY_HOST:-root@167.86.84.96}"
KEY="${KERN_DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
DOMAIN="${KERN_DEPLOY_DOMAIN:-trykern.xyz}"
WEB_ROOT="${KERN_WEB_ROOT:-/var/www/trykern}"
NGINX_CONF="${KERN_FUNDTRAIL_NGINX:-/root/fundtrail-app/fundtrail/nginx/nginx-active.conf}"
NGINX_CONTAINER="${KERN_NGINX_CONTAINER:-fundtrail-nginx-1}"
WEB_CONTAINER="${KERN_WEB_CONTAINER:-kern-web}"
MARKER="server_name trykern.xyz"
HTTPS_MARKER="ssl_certificate /etc/letsencrypt/live/trykern.xyz/fullchain.pem"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -f "${KEY/#\~/$HOME}" ]]; then
  SSH_OPTS+=(-i "${KEY/#\~/$HOME}")
fi

ssh_cmd() {
  ssh "${SSH_OPTS[@]}" "$HOST" "$@"
}

rsync_cmd() {
  rsync -avz --delete \
    -e "ssh ${SSH_OPTS[*]}" \
    "$@"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-build] [--skip-cert]

Build dist/, sync to ${WEB_CONTAINER}, configure ${DOMAIN} on fundtrail nginx.

Environment:
  KERN_DEPLOY_HOST      SSH target (default: root@167.86.84.96)
  KERN_DEPLOY_KEY       SSH key (default: ~/.ssh/id_ed25519)
  KERN_DEPLOY_DOMAIN    Domain (default: trykern.xyz)
EOF
}

SKIP_BUILD=0
SKIP_CERT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-cert) SKIP_CERT=1 ;;
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

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  echo "==> Building landing site"
  cd "${ROOT}"
  npm run build:web
fi

if [[ ! -d "${ROOT}/dist" ]]; then
  echo "dist/ not found — run npm run build:web first" >&2
  exit 1
fi

echo "==> Uploading backup copy to ${HOST}:${WEB_ROOT}/"
ssh_cmd "mkdir -p '${WEB_ROOT}'"
rsync_cmd "${ROOT}/dist/" "${HOST}:${WEB_ROOT}/"

echo "==> Updating ${WEB_CONTAINER} container"
ssh_cmd "docker cp '${WEB_ROOT}/.' '${WEB_CONTAINER}:/usr/share/nginx/html/'"

echo "==> Ensuring nginx HTTP vhost for ${DOMAIN}"
ssh_cmd "grep -qF '${MARKER}' '${NGINX_CONF}'" 2>/dev/null || {
  rsync_cmd "${ROOT}/deploy/nginx/trykern-fundtrail-http.conf" "${HOST}:/tmp/trykern-http.conf"
  ssh_cmd "cat /tmp/trykern-http.conf >> '${NGINX_CONF}' && rm /tmp/trykern-http.conf"
  echo "    Appended HTTP vhost"
}

CERT_DIR="/root/fundtrail-app/fundtrail/certbot/conf/live/${DOMAIN}"

if [[ "${SKIP_CERT}" -eq 0 ]]; then
  echo "==> TLS certificate for ${DOMAIN}"
  ssh_cmd "
    if [[ ! -d '${CERT_DIR}' ]]; then
      docker run --rm \
        -v /root/fundtrail-app/fundtrail/certbot/conf:/etc/letsencrypt \
        -v /root/fundtrail-app/fundtrail/certbot/www:/var/www/certbot \
        certbot/certbot certonly --webroot \
        -w /var/www/certbot \
        -d ${DOMAIN} -d www.${DOMAIN} \
        --email admin@${DOMAIN} \
        --agree-tos --non-interactive \
      || echo 'Certbot failed — point DNS A record to this server, then re-run'
    else
      echo 'Certificate already exists'
    fi
  "
fi

echo "==> Ensuring nginx HTTPS vhost for ${DOMAIN}"
ssh_cmd "
  if [[ -d '${CERT_DIR}' ]] && ! grep -qF '${HTTPS_MARKER}' '${NGINX_CONF}'; then
    test -f /tmp/trykern-https.conf || echo 'waiting for upload'
  fi
"
rsync_cmd "${ROOT}/deploy/nginx/trykern-fundtrail-https.conf" "${HOST}:/tmp/trykern-https.conf"
ssh_cmd "
  if [[ -d '${CERT_DIR}' ]] && ! grep -qF '${HTTPS_MARKER}' '${NGINX_CONF}'; then
    cat /tmp/trykern-https.conf >> '${NGINX_CONF}' && rm /tmp/trykern-https.conf
    echo '    Appended HTTPS vhost'
  else
    rm -f /tmp/trykern-https.conf
  fi
"

echo "==> Reloading nginx"
if ssh_cmd "docker exec '${NGINX_CONTAINER}' nginx -t" 2>/dev/null; then
  ssh_cmd "docker exec '${NGINX_CONTAINER}' nginx -s reload"
else
  echo "nginx -t failed — likely waiting for TLS cert. Site may work on HTTP once DNS propagates."
  echo "Re-run this script after: dig +short ${DOMAIN} A"
fi

echo ""
echo "Deployed landing to ${WEB_CONTAINER}."
echo "  https://${DOMAIN}/"
