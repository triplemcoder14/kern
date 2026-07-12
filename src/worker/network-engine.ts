import type { K8sApiClient } from "../core/k8s-api/client";
import { EbpfCollectorClient } from "../core/network/ebpf-collector";
import {
  aggregateEdgeMetrics,
  buildTopology,
  flowFromNetworkEvent,
} from "../core/network/topology";
import { retentionPolicy } from "../core/monitoring/retention";
import type { MonitorEvent } from "../core/types/monitoring";
import type { NetworkFlow, NetworkSnapshot, NetworkTopology } from "../core/types/network";

const POLL_MS = 8_000;

export class NetworkEngine {
  private topology: NetworkTopology = { nodes: [], edges: [], updatedAt: "" };
  private flows: NetworkFlow[] = [];
  private ebpfClient: EbpfCollectorClient | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onSnapshot: ((snapshot: NetworkSnapshot) => void) | null = null;
  private lastEbpfStatus: NetworkSnapshot["ebpf"] = {
    connected: false,
    collectorUrl: "",
    message: "not configured",
  };
  private activeClient: K8sApiClient | null = null;

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

  onUpdate(handler: (snapshot: NetworkSnapshot) => void): void {
    this.onSnapshot = handler;
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
    this.pushFlow(flow);
    this.emitSnapshot(this.lastEbpfStatus);
  }

  getSnapshot(): NetworkSnapshot {
    return {
      topology: this.topology,
      flows: this.flows,
      ebpf: this.lastEbpfStatus,
    };
  }

  private async refresh(client: K8sApiClient): Promise<void> {
    const [pods, services, endpoints] = await Promise.all([
      client.listPods(),
      client.listServices(),
      client.listEndpoints(),
    ]);

    this.topology = buildTopology(pods, services, endpoints);

    const ebpfStatus = this.ebpfClient
      ? await this.ebpfClient.status()
      : {
          connected: false,
          collectorUrl: "",
          message: "Set EBPF COLLECTOR to http://127.0.0.1:9474 in Settings",
        };

    this.lastEbpfStatus = ebpfStatus;

    if (this.ebpfClient && ebpfStatus.connected) {
      const ebpfFlows = await this.ebpfClient.fetchFlows(this.topology);
      for (const flow of ebpfFlows) {
        this.pushFlow(flow);
      }
    }

    this.topology = aggregateEdgeMetrics(this.topology, this.flows);
    this.emitSnapshot(ebpfStatus);
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
      flows: this.flows,
      ebpf,
    });
  }
}
