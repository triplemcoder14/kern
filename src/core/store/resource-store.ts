import type { ClusterStats, K8sResource, ResourceKind } from "../types/k8s";
import { getResourceNamespace, resourceKey } from "../types/k8s";

export class ResourceStore {
  private resources = new Map<string, K8sResource>();

  private keyFor(resource: K8sResource): string {
    const namespace = getResourceNamespace(resource);
    return resourceKey(resource.kind, namespace, resource.metadata.name);
  }

  upsert(resource: K8sResource): { resource: K8sResource; created: boolean } {
    const key = this.keyFor(resource);
    const created = !this.resources.has(key);
    const enriched = this.enrichResource(resource, created);
    this.resources.set(key, enriched);
    return { resource: enriched, created };
  }

  delete(kind: ResourceKind, namespace: string, name: string): boolean {
    return this.resources.delete(resourceKey(kind, namespace, name));
  }

  get(kind: ResourceKind, namespace: string, name: string): K8sResource | undefined {
    return this.resources.get(resourceKey(kind, namespace, name));
  }

  list(kind: ResourceKind, namespace?: string): K8sResource[] {
    return [...this.resources.values()].filter((resource) => {
      if (resource.kind !== kind) {
        return false;
      }
      if (namespace === undefined) {
        return true;
      }
      return getResourceNamespace(resource) === namespace;
    });
  }

  listAll(): K8sResource[] {
    return [...this.resources.values()];
  }

  clear(): void {
    this.resources.clear();
  }

  load(resources: K8sResource[]): void {
    this.resources.clear();
    for (const resource of resources) {
      this.resources.set(this.keyFor(resource), resource);
    }
  }

  stats(): ClusterStats {
    return {
      pods: this.list("Pod").length,
      deployments: this.list("Deployment").length,
      services: this.list("Service").length,
      namespaces: this.list("Namespace").length,
    };
  }

  private enrichResource(resource: K8sResource, created: boolean): K8sResource {
    const now = new Date().toISOString();
    const metadata = {
      ...resource.metadata,
      uid: resource.metadata.uid ?? crypto.randomUUID(),
      creationTimestamp: created
        ? now
        : (resource.metadata.creationTimestamp ?? now),
    };

    switch (resource.kind) {
      case "Pod":
        return {
          ...resource,
          metadata,
          status: resource.status ?? {
            phase: "Running",
            podIP: `10.${Math.floor(Math.random() * 255)}.0.${Math.floor(Math.random() * 254) + 1}`,
            hostIP: "10.0.0.1",
          },
        };
      case "Deployment": {
        const replicas = resource.spec.replicas ?? 1;
        return {
          ...resource,
          metadata,
          status: resource.status ?? {
            replicas,
            readyReplicas: replicas,
            availableReplicas: replicas,
          },
        };
      }
      case "Service":
        return {
          ...resource,
          metadata,
          spec: {
            ...resource.spec,
            type: resource.spec.type ?? "ClusterIP",
            clusterIP: resource.spec.clusterIP ?? `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
          },
        };
      case "Namespace":
        return {
          ...resource,
          metadata,
          status: resource.status ?? { phase: "Active" },
        };
    }
  }
}
