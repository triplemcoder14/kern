#!/usr/bin/env bash
set -euo pipefail

echo "Enabling Cilium CNI on minikube (if not already)..."
if minikube addons list 2>/dev/null | grep -q cilium; then
  minikube addons enable cilium || true
else
  echo "Cilium addon not found — installing Cilium via cilium CLI..."
  if ! command -v cilium >/dev/null 2>&1; then
    echo "Install cilium CLI: https://docs.cilium.io/en/latest/gettingstarted/k8s-install-default/"
    exit 1
  fi
  cilium install --wait
fi

echo "Enabling Hubble..."
if command -v cilium >/dev/null 2>&1; then
  cilium hubble enable --wait
  echo ""
  echo "Hubble enabled. Verify with:"
  echo "  cilium status --wait"
  echo "  cilium hubble status"
else
  echo "cilium CLI not found — enable Hubble manually after installing Cilium."
  exit 1
fi
