# KERN Agent

In-cluster DaemonSet that reads kernel/network flows and enriches them with Kubernetes metadata.

## API (v1)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness + tracer mode, flow rate, indexed pods/services |
| `/api/v1/agent` | GET | Agent metadata and endpoint map |
| `/api/v1/flows` | GET | Snapshot of enriched flows (limit 200) |
| `/api/v1/flows/stream` | GET | Server-Sent Events stream (1 Hz snapshot) |

Hubble mode (optional build) uses gRPC to Cilium Hubble Relay. External clients use REST + SSE above.

### Flow schema

Each flow includes:

```json
{
  "timestamp": "2026-07-04T20:00:00Z",
  "first_seen": "2026-07-04T19:59:58Z",
  "last_seen": "2026-07-04T20:00:00Z",
  "src_ip": "10.244.0.5",
  "dst_ip": "10.96.0.10",
  "src_pod": "frontend",
  "src_namespace": "default",
  "dst_service": "backend",
  "dst_service_namespace": "default",
  "dst_pod": "backend-abc",
  "dst_namespace": "default",
  "path": "frontend/default → backend/default → backend-abc/default",
  "protocol": "TCP",
  "port": 8080,
  "latency_ms": 12,
  "verdict": "OK",
  "bytes_sent": 1024,
  "bytes_received": 4096,
  "retransmits": 0
}
```

## RBAC

The agent needs read-only cluster metadata to label flows:

| Resource | Verbs | Why |
|----------|-------|-----|
| `pods` | get, list, watch | Map pod IP → pod name/namespace |
| `services` | get, list, watch | Map ClusterIP → service name |
| `endpointslices` | get, list, watch | Map backend pod → owning service |

All permissions are **read-only**. The agent does not modify cluster state.

Deploy manifests live in `deploy/daemonset.yaml` (ServiceAccount, ClusterRole, ClusterRoleBinding, DaemonSet, Service).

## Modes

| Mode | Source |
|------|--------|
| `proc` | Host `/proc/net/tcp` (default Docker image) |

## Build & deploy

```bash
./scripts/deploy-agent.sh
./scripts/port-forward-agent.sh   # forwards kern-agent:9474 → localhost:9474
curl http://127.0.0.1:9474/api/v1/agent
```

Environment:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HUBBLE_RELAY` | `hubble-relay.kube-system.svc.cluster.local:4245` | Hubble relay (optional future build) |
