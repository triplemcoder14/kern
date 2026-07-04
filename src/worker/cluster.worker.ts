import { ResourceStore } from "../core/store/resource-store";
import type { K8sResource, ResourceKind } from "../core/types/k8s";
import { getResourceNamespace } from "../core/types/k8s";
import type { WorkerEvent, WorkerRequest, WorkerResponse } from "../core/types/rpc";
import { parseYamlDocuments } from "../core/yaml/engine";
import {
  clearDb,
  deleteResourceFromDb,
  loadResourcesFromDb,
  saveResourceToDb,
} from "./persistence/indexeddb";

type EventHandler = (event: WorkerEvent) => void;

export class ClusterRuntime {
  private store = new ResourceStore();
  private listeners = new Set<EventHandler>();
  private initialized = false;

  onEvent(handler: EventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(event: WorkerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async handle(request: WorkerRequest): Promise<WorkerResponse["data"]> {
    switch (request.type) {
      case "LOAD_CLUSTER":
        return this.loadCluster();
      case "RESET_CLUSTER":
        return this.resetCluster();
      case "APPLY_YAML":
        return this.applyYaml(request.yaml);
      case "DELETE":
        return this.deleteResource(request.kind, request.namespace, request.name);
      case "LIST":
        return this.store.list(request.kind, request.namespace);
      case "GET":
        return this.store.get(request.kind, request.namespace, request.name) ?? null;
      case "SUBSCRIBE":
        this.emit({ type: "RESOURCES_SNAPSHOT", resources: this.store.listAll() });
        return { subscribed: true };
      default:
        throw new Error("Unknown request type");
    }
  }

  private async loadCluster(): Promise<{ loaded: boolean }> {
    if (this.initialized) {
      this.emit({ type: "CLUSTER_READY", stats: this.store.stats() });
      this.emit({ type: "RESOURCES_SNAPSHOT", resources: this.store.listAll() });
      return { loaded: true };
    }

    const resources = await loadResourcesFromDb();
    if (resources.length === 0) {
      const defaultNs: K8sResource = {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: "default" },
        status: { phase: "Active" },
      };
      this.store.upsert(defaultNs);
      await saveResourceToDb(defaultNs);
    } else {
      this.store.load(resources);
    }

    this.initialized = true;
    this.emit({ type: "CLUSTER_READY", stats: this.store.stats() });
    this.emit({ type: "RESOURCES_SNAPSHOT", resources: this.store.listAll() });
    return { loaded: true };
  }

  private async resetCluster(): Promise<{ reset: true }> {
    this.store.clear();
    await clearDb();

    const defaultNs: K8sResource = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "default" },
      status: { phase: "Active" },
    };
    this.store.upsert(defaultNs);
    await saveResourceToDb(defaultNs);

    this.emit({ type: "CLUSTER_READY", stats: this.store.stats() });
    this.emit({ type: "RESOURCES_SNAPSHOT", resources: this.store.listAll() });
    return { reset: true };
  }

  private async applyYaml(yaml: string): Promise<{ applied: number }> {
    const { resources, errors } = parseYamlDocuments(yaml);
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    for (const resource of resources) {
      await this.ensureNamespaceExists(resource);
      const { resource: saved, created } = this.store.upsert(resource);
      await saveResourceToDb(saved);
      this.emit({
        type: created ? "RESOURCE_ADDED" : "RESOURCE_UPDATED",
        resource: saved,
      });
    }

    this.emit({ type: "CLUSTER_READY", stats: this.store.stats() });
    return { applied: resources.length };
  }

  private async ensureNamespaceExists(resource: K8sResource): Promise<void> {
    if (resource.kind === "Namespace") {
      return;
    }

    const namespace = getResourceNamespace(resource);
    const existing = this.store.get("Namespace", "", namespace);
    if (existing) {
      return;
    }

    const ns: K8sResource = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace },
      status: { phase: "Active" },
    };
    const { resource: saved } = this.store.upsert(ns);
    await saveResourceToDb(saved);
    this.emit({ type: "RESOURCE_ADDED", resource: saved });
  }

  private async deleteResource(
    kind: ResourceKind,
    namespace: string,
    name: string,
  ): Promise<{ deleted: boolean }> {
    const deleted = this.store.delete(kind, namespace, name);
    if (deleted) {
      await deleteResourceFromDb(kind, namespace, name);
      this.emit({ type: "RESOURCE_DELETED", kind, namespace, name });
      this.emit({ type: "CLUSTER_READY", stats: this.store.stats() });
    }
    return { deleted };
  }
}

const runtime = new ClusterRuntime();

self.onmessage = async (event: MessageEvent<{ id: string; request: WorkerRequest }>) => {
  const { id, request } = event.data;

  try {
    const data = await runtime.handle(request);
    self.postMessage({
      type: "response",
      response: { id, ok: true, data },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    self.postMessage({
      type: "response",
      response: { id, ok: false, error: message },
    });
    self.postMessage({
      type: "event",
      event: { type: "ERROR", message },
    });
  }
};

runtime.onEvent((workerEvent) => {
  self.postMessage({ type: "event", event: workerEvent });
});

runtime.handle({ type: "LOAD_CLUSTER" }).catch((error) => {
  const message = error instanceof Error ? error.message : "Failed to load cluster";
  self.postMessage({ type: "event", event: { type: "ERROR", message } });
});
