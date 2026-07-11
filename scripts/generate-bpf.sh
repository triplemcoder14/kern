#!/usr/bin/env bash
# Generate eBPF Go bindings (requires clang + llvm on Linux, or Docker below).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT="${ROOT}/agent"

if command -v clang >/dev/null 2>&1 && [[ "$(uname -s)" == "Linux" ]]; then
  cd "${AGENT}"
  go generate ./internal/ebpf/...
  exit 0
fi

echo "==> Generating eBPF bindings via Docker (clang + bpf2go)"
docker run --rm \
  -v "${AGENT}:/src" \
  -w /src \
  golang:1.25-alpine \
  sh -c 'apk add --no-cache clang18 llvm18 linux-headers git && \
    go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang18 -cflags "-O2 -g -Wall -Werror" -target amd64 flows bpf/flows.c -- -Ibpf && \
    mv flows_* internal/ebpf/'
