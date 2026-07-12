import type { K8sApiClient } from "../core/k8s-api/client";
import { EbpfCollectorClient } from "../core/network/ebpf-collector";
import {
  aggregateEdgeMetrics,
  buildTopology,
  flowFromNetworkEvent,
} from "../core/network/topology";
import { retentionPolicy } from "../core/monitoring/retention";
import {
  ALL_NAMESPACES,
  type MonitorNamespaceScope,
} from "../core/monitoring/scope";
import type { MonitorEvent } from "../core/types/monitoring";
import type { NetworkFlow, NetworkSnapshot, NetworkTopology } from "../core/types/network";

const POLL_MS = 8_000;

function flowInScope(flow: NetworkFlow, scope: MonitorNamespaceScope): boolean {
  if (scope === ALL_NAMESPACES) {
    return true;
  }
  return flow.src.namespace === scope || flow.dst.namespace === scope;
}

function topologyInScope(topology: NetworkTopology, scope: MonitorNamespaceScope): NetworkTopology {
  if (scope === ALL_NAMESPACES) {
    return topology;
  }
  const nodes = topology.nodes.filter((node) => node.namespace === scope);
  const keep = new Set(nodes.map((node) => node.id));
  const edges = topology.edges.filter((edge) => keep.has(edge.from) || keep.has(edge.to));
  return {
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
  };
}

export class NetworkEngine {
  private topology: NetworkTopology = { nodes: [], edges: [], updatedAt: "" };
  private flows: NetworkFlow[] = [];
  /** Last all-namespaces topology/flows for instant restore when widening scope. */
  private unscopedCache: { topology: NetworkTopology; flows: NetworkFlow[] } | null = null;
  private ebpfClient: EbpfCollectorClient | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onSnapshot: ((snapshot: NetworkSnapshot) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private scope: MonitorNamespaceScope = ALL_NAMESPACES;
  private lastEbpfStatus: NetworkSnapshot["ebpf"] = {
    connected: false,
    collectorUrl: "",
    message: "not configured",
  };
  private activeClient: K8sApiClient | null = null;
  private refreshSeq = 0;

  configure(collectorUrl: string, origin: string): void {
    this.ebpfClient = collectorUrl
      ? new EbpfCollectorClient(collectorUrl, origin)
      : null;
    if (!collectorUrl) {
      this.lastEbpfStatus = {
        connected: false,
        collectorUrl: "",
        message: "Configure agent URL in Settings",
      };
    }
  }

  /**
   * Apply scope immediately (local filter or cache restore + emit), then refresh from the API.
   * Callers that need sub-second UI should await this.
   */
  async setScope(scope: MonitorNamespaceScope): Promise<void> {
    const previous = this.scope;
    this.scope = scope;

    if (scope !== ALL_NAMESPACES) {
      if (previous === ALL_NAMESPACES) {
        this.unscopedCache = {
          topology: this.topology,
          flows: [...this.flows],
        };
      }
      this.topology = topologyInScope(this.topology, scope);
      this.flows = this.flows.filter((flow) => flowInScope(flow, scope));
      this.emitSnapshot(this.lastEbpfStatus);
    } else if (this.unscopedCache) {
      this.topology = this.unscopedCache.topology;
      this.flows = this.unscopedCache.flows;
      this.emitSnapshot(this.lastEbpfStatus);
    }

    if (this.activeClient) {
      await this.refresh(this.activeClient);
    }
  }

  onUpdate(handler: (snapshot: NetworkSnapshot) => void): void {
    this.onSnapshot = handler;
  }

  onRefreshError(handler: (message: string) => void): void {
    this.onError = handler;
  }

  start(client: K8sApiClient): void {
    this.stop();
    this.activeClient = client;
    void this.refresh(client);
    this.pollTimer = setInterval(() => {
      if (this.activeClient) {
        void this.refresh(this.activeClient);
      }
    }, POLL_MS);
  }

  triggerRefresh(): void {
    if (this.activeClient) {
      void this.refresh(this.activeClient);
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.activeClient = null;
  }

  ingestMonitorEvent(event: MonitorEvent): void {
    const flow = flowFromNetworkEvent({
      id: event.id,
      timestamp: event.timestamp,
      title: event.title,
      message: event.message,
      namespace: event.namespace,
      resourceKind: event.resourceKind,
      resourceName: event.resourceName,
    });
    if (!flow) {
      return;
    }
    if (!flowInScope(flow, this.scope)) {
      return;
    }
    this.pushFlow(flow);
    this.emitSnapshot(this.lastEbpfStatus);
  }

  getSnapshot(): NetworkSnapshot {
    return {
      topology: this.topology,
      flows: this.flows.filter((flow) => flowInScope(flow, this.scope)),
      ebpf: this.lastEbpfStatus,
    };
  }

  private async refresh(client: K8sApiClient): Promise<void> {
    const seq = ++this.refreshSeq;
    try {
      const [pods, services, endpoints] = await Promise.all([
        client.listPods(this.scope),
        client.listServices(this.scope),
        client.listEndpoints(this.scope),
      ]);

      if (seq !== this.refreshSeq) {
        return;
      }

      this.topology = buildTopology(pods, services, endpoints);

      const ebpfStatus = this.ebpfClient
        ? await this.ebpfClient.status()
        : {
            connected: false,
            collectorUrl: "",
            message: "Set EBPF COLLECTOR to http://127.0.0.1:9474 in Settings",
          };

      if (seq !== this.refreshSeq) {
        return;
      }

      this.lastEbpfStatus = ebpfStatus;

      if (this.ebpfClient && ebpfStatus.connected) {
        const ebpfFlows = await this.ebpfClient.fetchFlows(this.topology);
        if (seq !== this.refreshSeq) {
          return;
        }
        for (const flow of ebpfFlows) {
          if (flowInScope(flow, this.scope)) {
            this.pushFlow(flow);
          }
        }
      }

      this.flows = this.flows.filter((flow) => flowInScope(flow, this.scope));
      this.topology = aggregateEdgeMetrics(this.topology, this.flows);
      if (this.scope === ALL_NAMESPACES) {
        this.unscopedCache = {
          topology: this.topology,
          flows: [...this.flows],
        };
      }
      this.emitSnapshot(ebpfStatus);
    } catch (error) {
      if (seq !== this.refreshSeq) {
        return;
      }
      const message = error instanceof Error ? error.message : "Network refresh failed";
      this.onError?.(message);
    }
  }

  private pushFlow(flow: NetworkFlow): void {
    const index = this.flows.findIndex((item) => item.id === flow.id);
    if (index >= 0) {
      this.flows[index] = flow;
    } else {
      this.flows.unshift(flow);
      this.flows = this.flows.slice(0, retentionPolicy().maxFlows);
    }
  }

  private emitSnapshot(ebpf: NetworkSnapshot["ebpf"]): void {
    this.onSnapshot?.({
      topology: this.topology,
      flows: this.flows.filter((flow) => flowInScope(flow, this.scope)),
      ebpf,
    });
  }
}
