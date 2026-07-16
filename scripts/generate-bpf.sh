#!/usr/bin/env bash
# Generate eBPF Go bindings (requires clang + llvm on Linux, or Docker below).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT="${ROOT}/agent"

generate_in_docker() {
  echo "==> Generating eBPF bindings via Docker (clang + bpf2go)"
  docker run --rm \
    -v "${AGENT}:/src" \
    -w /src \
    golang:1.25-bookworm \
    bash -c 'apt-get update && apt-get install -y --no-install-recommends clang llvm libbpf-dev linux-libc-dev git >/dev/null \
      && GOPACKAGE=ebpf go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 \
           flows bpf/flows.c -- -Ibpf \
      && mv flows_* internal/ebpf/ \
<<<<<<< Updated upstream
      && go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 \
           dns bpf/dns.c -- -Ibpf \
      && mv dns_* internal/ebpf/ \
      && go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 \
=======
      && GOPACKAGE=ebpf go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 \
           http bpf/http.c -- -Ibpf \
      && mv http_* internal/ebpf/ \
      && GOPACKAGE=profile go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 \
>>>>>>> Stashed changes
           profileStacks bpf/profile_stacks.c -- -Ibpf \
      && mv profilestacks_* internal/profile/'
}

if command -v clang >/dev/null 2>&1 && [[ "$(uname -s)" == "Linux" ]]; then
  cd "${AGENT}"
  go generate ./internal/ebpf/... ./internal/profile/...
  exit 0
fi

generate_in_docker
