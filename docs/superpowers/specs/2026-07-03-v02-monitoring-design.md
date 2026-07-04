# port-of-k8s v0.2 — Live Cluster Monitoring

**Goal:** Pivot from simulation-only to a browser-native monitoring tool that connects to real clusters, streams K8s events, detects incidents, and surfaces network/service signals.

## Architecture

```text
React UI (Monitor tab)
    │ postMessage
Monitor Worker
    ├── Kubeconfig parser
    ├── K8s API client (via /k8s-api proxy → kubectl proxy)
    ├── Event watch stream
    ├── Incident engine
    └── IndexedDB (events, incidents, connection config)
```

## Connection model

1. User runs `kubectl proxy --port=8001`
2. Vite dev proxy maps `/k8s-api` → `http://127.0.0.1:8001`
3. User connects with optional kubeconfig paste (token + context name)
4. Worker watches `/api/v1/events` and polls pod health

## UI

- **Monitor tab** (default): connection panel, live event stream, incidents, network signals, cost placeholder
- **Simulation tab**: v0.1 sandbox retained for offline demo

## Deferred to v0.3+

- Pod-to-pod network introspection graph
- Cost feed integrations (Kubecost, cloud billing)
- Browser extension alerts
