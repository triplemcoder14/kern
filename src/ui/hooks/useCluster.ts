import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClusterStats, K8sResource, ResourceKind } from "../../core/types/k8s";
import { getResourceNamespace } from "../../core/types/k8s";
import type { WorkerEvent } from "../../core/types/rpc";
import { getClusterWorker } from "../../lib/worker-rpc";

const EMPTY_STATS: ClusterStats = {
  pods: 0,
  deployments: 0,
  services: 0,
  namespaces: 0,
};

export function useCluster() {
  const worker = useMemo(() => getClusterWorker(), []);
  const [resources, setResources] = useState<K8sResource[]>([]);
  const [stats, setStats] = useState<ClusterStats>(EMPTY_STATS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = worker.onEvent((event: WorkerEvent) => {
      switch (event.type) {
        case "CLUSTER_READY":
          setStats(event.stats);
          setReady(true);
          break;
        case "RESOURCES_SNAPSHOT":
          setResources(event.resources);
          break;
        case "RESOURCE_ADDED":
          setResources((prev) => {
            const filtered = prev.filter(
              (item) =>
                !(
                  item.kind === event.resource.kind &&
                  getResourceNamespace(item) === getResourceNamespace(event.resource) &&
                  item.metadata.name === event.resource.metadata.name
                ),
            );
            return [...filtered, event.resource];
          });
          break;
        case "RESOURCE_UPDATED":
          setResources((prev) =>
            prev.map((item) =>
              item.kind === event.resource.kind &&
              getResourceNamespace(item) === getResourceNamespace(event.resource) &&
              item.metadata.name === event.resource.metadata.name
                ? event.resource
                : item,
            ),
          );
          break;
        case "RESOURCE_DELETED":
          setResources((prev) =>
            prev.filter(
              (item) =>
                !(
                  item.kind === event.kind &&
                  getResourceNamespace(item) === event.namespace &&
                  item.metadata.name === event.name
                ),
            ),
          );
          break;
        case "ERROR":
          setError(event.message);
          break;
      }
    });

    worker.request({ type: "LOAD_CLUSTER" }).catch((err: Error) => setError(err.message));
    worker.subscribe().catch((err: Error) => setError(err.message));

    return unsubscribe;
  }, [worker]);

  const applyYaml = useCallback(
    async (yaml: string) => {
      setBusy(true);
      setError(null);
      try {
        await worker.request({ type: "APPLY_YAML", yaml });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply YAML");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [worker],
  );

  const deleteResource = useCallback(
    async (kind: ResourceKind, namespace: string, name: string) => {
      setBusy(true);
      setError(null);
      try {
        await worker.request({ type: "DELETE", kind, namespace, name });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete resource");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [worker],
  );

  const resetCluster = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await worker.request({ type: "RESET_CLUSTER" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset cluster");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [worker]);

  return {
    resources,
    stats,
    ready,
    error,
    busy,
    applyYaml,
    deleteResource,
    resetCluster,
  };
}
