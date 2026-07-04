# v0.4 — Hubble / Cilium Flow Integration

## Goal

Add **Hubble Relay** as an optional high-fidelity flow source alongside the existing `/proc/net/tcp` collector, without changing the browser UI contract (`GET /health`, `GET /api/v1/flows`).

## Architecture

```text
Browser UI  →  Network Engine  →  EbpfCollectorClient  →  :9474
                                              ↑
                                    Go collector (unchanged API)
                                    ├── mode=proc   (/proc/net/tcp)
                                    ├── mode=hubble (gRPC → Hubble Relay :4245)
                                    └── mode=auto   (try hubble, fallback proc)
```

Hubble runs in the cluster (Cilium CNI). The collector normalizes Hubble flows into the same JSON shape the UI already consumes.

## Collector modes

| Mode | Behavior |
|------|----------|
| `proc` | Current Linux `/proc/net/tcp` tracing (default) |
| `hubble` | Stream flows from Hubble Relay gRPC Observer API |
| `auto` | Attempt Hubble; on failure fall back to `proc` |

Environment / flags:
- `-mode auto|proc|hubble`
- `-hubble-relay hubble-relay.kube-system.svc.cluster.local:4245`

## Minikube setup

```bash
./scripts/enable-hubble.sh      # cilium + hubble enable
./scripts/deploy-collector.sh   # FLOW_SOURCE=auto by default
./scripts/port-forward-collector.sh
# optional local hubble UI:
./scripts/port-forward-hubble.sh
```

## UI changes

- Settings: flow source documentation + mode shown from `/health`
- Network eBPF panel: display `Hubble` vs `ProcNet` source
- Version bump to **0.4.0**

## Out of scope (v0.4)

- L7 HTTP visibility from Hubble
- Direct browser → Hubble gRPC (stays behind collector)
- Replacing Cilium as CNI on non-Cilium clusters

## Success criteria

1. With Cilium+Hubble enabled, collector `/health` reports `mode: hubble`
2. Network tab shows pod→pod flows with Hubble verdicts
3. Without Hubble, `auto` mode still works via proc fallback
