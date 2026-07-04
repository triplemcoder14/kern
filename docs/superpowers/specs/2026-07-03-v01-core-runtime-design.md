# port-of-k8s v0.1 — Core Runtime Design

> Kubernetes in the browser — simulation-first, Web Worker runtime, monochrome UI.

**Goal:** Ship v0.1 Core Runtime: React UI, Web Worker cluster engine, YAML apply, CRUD for Pod/Deployment/Service/Namespace, IndexedDB persistence.

**Architecture:** K8s-shaped worker runtime (Approach B). Main thread React UI communicates via typed `postMessage` RPC. Worker owns `ResourceStore`, YAML parsing, and IndexedDB sync.

**Tech Stack:** Vite, React 19, TypeScript, Web Workers, js-yaml, idb, Tailwind v4.

---

## Scope (v0.1)

- Browser app with hardcore black/white UI
- Web Worker cluster runtime
- YAML parser (multi-doc)
- Resource store with watch events
- CRUD: Pod, Deployment, Service, Namespace
- IndexedDB persistence
- Default namespace bootstrap

## Deferred

- Controllers / reconciliation (v0.2)
- Networking / pod-to-pod (v0.3)
- Extension (v0.5)
- Real cluster adapter (v0.6)

## Worker RPC

Requests: `LOAD_CLUSTER`, `RESET_CLUSTER`, `APPLY_YAML`, `DELETE`, `LIST`, `GET`, `SUBSCRIBE`

Events: `CLUSTER_READY`, `RESOURCE_ADDED`, `RESOURCE_UPDATED`, `RESOURCE_DELETED`, `RESOURCES_SNAPSHOT`, `ERROR`

## UI Layout

Top bar · Sidebar nav · YAML editor · Resource table · Inspector · Status bar

## Roadmap Reference

v0.2 Engine → v0.3 Networking → v0.4 Observability → v0.5 Extension → v0.6 Real Cluster
