# v0.3 — Network Layer + eBPF Architecture

## Vision

Browser-native Kubernetes **network observability**: pod-to-pod flows, service latency, kernel-level instrumentation via eBPF.

eBPF runs in the **Linux kernel** — not in the browser. Architecture:

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser UI (port-of-k8s)                                   │
│  ├── Topology map (Service → Pod edges)                     │
│  ├── Flow stream (src → dst, verdict, latency)              │
│  └── eBPF collector status                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ Web Worker
┌──────────────────────────▼──────────────────────────────────┐
│  Network Engine                                             │
│  ├── K8s topology (pods, services, endpoints)               │
│  ├── K8s network events → inferred flows                    │
│  └── eBPF Collector Adapter (/ebpf-api → :9474)             │
└──────────────┬─────────────────────────────┬────────────────┘
               │                             │
     kubectl proxy :8001              eBPF Collector :9474
               │                             │
               ▼                             ▼
        Kubernetes API              eBPF programs (TC/kprobe)
        pods / svc / endpoints      TCP latency, drops, bytes
```

## Data sources

| Layer | Source | Data |
|-------|--------|------|
| **Topology** | K8s API | Service→Pod edges via Endpoints |
| **Inferred flows** | K8s Events | Probe failures, DNS, network errors |
| **Kernel flows** | eBPF collector | Real packet/socket latency, verdicts |

## eBPF Collector API (sidecar — to build next)

Runs on host or minikube node, exposes:

```
GET /health          → { programs: 3, flows_per_second: 42 }
GET /api/v1/flows    → { flows: [{ src_ip, dst_ip, src_pod, dst_pod, latency_ms, verdict }] }
```

Attach points (planned):
- `kprobe/tcp_connect` — connection latency
- `kprobe/tcp_rcv_established` — RTT samples
- `tc` egress/ingress — drop verdicts, bytes

Browser proxies via Vite: `/ebpf-api` → `127.0.0.1:9474`

## UI (v0.3)

- **NETWORK** tab (default): topology + flows + eBPF status
- **CONFIG**: CLUSTER, PROXY, EBPF, TOKEN, KUBECONFIG
- Incidents sidebar for network failures

## Roadmap

| Phase | Deliverable |
|-------|-------------|
| **v0.3a** ✓ | Topology from K8s, flow model, collector adapter, network UI |
| **v0.3b** ✓ | Go flow collector daemon (port 9474), minikube DaemonSet |
| **v0.3c** ✓ | Latency histograms p50/p95/p99 per service edge |
| **v0.3d** ✓ | Interactive topology graph (SVG/canvas) |
| **v0.4** ✓ | Hubble / Cilium integration option (auto/proc/hubble modes) |
