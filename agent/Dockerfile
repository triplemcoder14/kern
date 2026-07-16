# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.25-bookworm AS build
WORKDIR /src

ENV GOPROXY=https://proxy.golang.org,direct

RUN apt-get update && apt-get install -y --no-install-recommends \
      clang llvm libbpf-dev linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG TARGETOS=linux
ARG TARGETARCH

# bpf2go target names: amd64 -> amd64, arm64 -> arm64
RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64|arm64) BPF_TARGET="${TARGETARCH}" ;; \
    *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  GOPACKAGE=ebpf go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 \
    -cc clang -cflags "-O2 -g -Wall -Werror" -target "${BPF_TARGET}" \
    -output-dir internal/ebpf flows bpf/flows.c -- -Ibpf; \
  GOPACKAGE=ebpf go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 \
    -cc clang -cflags "-O2 -g -Wall -Werror" -target "${BPF_TARGET}" \
    -output-dir internal/ebpf dns bpf/dns.c -- -Ibpf; \
  GOPACKAGE=profile go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 \
    -cc clang -cflags "-O2 -g -Wall -Werror" -target "${BPF_TARGET}" \
    -output-dir internal/profile profileStacks bpf/profile_stacks.c -- -Ibpf; \
  CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -tags ebpf -ldflags="-s -w" -o /kern-agent .

FROM gcr.io/distroless/static-debian12
USER 0:0
COPY --from=build /kern-agent /kern-agent
EXPOSE 9474
ENTRYPOINT ["/kern-agent"]
