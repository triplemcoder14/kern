#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${HUBBLE_PORT:-4245}"

echo "Port-forwarding Hubble Relay to 127.0.0.1:${LOCAL_PORT}"
echo "Keep this terminal open while using Hubble mode locally."
echo ""

if command -v cilium >/dev/null 2>&1; then
  exec cilium hubble port-forward --address "127.0.0.1" --port "$LOCAL_PORT"
fi

exec kubectl -n kube-system port-forward "service/hubble-relay" "${LOCAL_PORT}:4245"
