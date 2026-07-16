import type { K8sApiClient } from "../k8s-api/client";
import {
  fetchAgentViaPodProxy,
  fetchAllAgentJson,
} from "../k8s-api/agent-access";
import type { EbpfCollectorStatus, EbpfFlowPayload, NetworkFlow } from "../types/network";
import { resolveEndpoint } from "./topology";
import type { NetworkTopology } from "../types/network";

const DIRECT_COLLECTOR = "http://127.0.0.1:9474";

function flowMergeKey(flow: EbpfFlowPayload): string {
  return [
    flow.src_ip,
    flow.dst_ip,
    flow.protocol ?? "TCP",
    String(flow.port),
    flow.src_pod ?? "",
    flow.dst_pod ?? flow.dst_service ?? "",
  ].join("|");
}

export class EbpfCollectorClient {
  private collectorUrl: string;
  private origin: string;

  constructor(collectorUrl: string, origin = "") {
    this.collectorUrl = collectorUrl;
    this.origin = origin;
  }

  private resolveUrl(path: string, base?: string): string {
    const root = (base ?? this.collectorUrl).replace(/\/$/, "");
    if (root.startsWith("http")) {
      return `${root}${path}`;
    }
    return `${this.origin.replace(/\/$/, "")}${root}${path}`;
  }

  private candidateRoots(): string[] {
    const roots = [this.collectorUrl.replace(/\/$/, "")];
    if (!roots[0].startsWith("http")) {
      roots.push("/ebpf-api");
    }
    if (!roots.includes(DIRECT_COLLECTOR)) {
      roots.push(DIRECT_COLLECTOR);
    }
    return roots;
  }

  private async fetchAgentJson<T>(
    path: string,
    k8s: K8sApiClient | null,
    timeoutMs: number,
  ): Promise<{ body: T; source: string } | null> {
    for (const root of this.candidateRoots()) {
      if (!root.startsWith("http")) {
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(this.resolveUrl(path, root), {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.ok) {
          return { body: (await response.json()) as T, source: root };
        }
      } catch {
        // try next direct URL
      }
    }

    if (k8s) {
      const proxied = await fetchAgentViaPodProxy(k8s, path, { timeoutMs });
      if (proxied) {
        return {
          body: (await proxied.response.json()) as T,
          source: `${proxied.pod.namespace}/${proxied.pod.name}`,
        };
      }
    }

    return null;
  }

  async status(k8s: K8sApiClient | null = null): Promise<EbpfCollectorStatus> {
    let lastError = "Collector unreachable";

    for (const root of this.candidateRoots()) {
      if (!root.startsWith("http")) {
        continue;
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(this.resolveUrl("/health", root), {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          lastError = `Collector offline (${response.status}) at ${root}`;
          continue;
        }

        const body = (await response.json()) as {
          programs?: number;
          flows_per_second?: number;
          mode?: string;
          message?: string;
          pods_indexed?: number;
          services_indexed?: number;
        };

        return {
          connected: true,
          collectorUrl: root,
          mode: body.mode,
          programsAttached: body.programs,
          flowsPerSecond: body.flows_per_second,
          podsIndexed: body.pods_indexed,
          servicesIndexed: body.services_indexed,
          message: formatModeMessage(body.mode, body.message ?? "agent live"),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : `Failed at ${root}`;
      }
    }

    if (k8s) {
      try {
        const agents = await fetchAllAgentJson<{
          programs?: number;
          flows_per_second?: number;
          mode?: string;
          message?: string;
          pods_indexed?: number;
          services_indexed?: number;
          ok?: boolean;
        }>(k8s, "/health", { timeoutMs: 4000 });

        if (agents.length > 0) {
          const primary = agents[0].body;
          const podsIndexed = agents.reduce(
            (sum, item) => sum + (item.body.pods_indexed ?? 0),
            0,
          );
          const flowsPerSecond = agents.reduce(
            (sum, item) => sum + (item.body.flows_per_second ?? 0),
            0,
          );
          const programs = agents.reduce(
            (sum, item) => sum + (item.body.programs ?? 0),
            0,
          );
          const via = `pod-proxy ×${agents.length}`;
          return {
            connected: true,
            collectorUrl: via,
            mode: primary.mode,
            programsAttached: programs || primary.programs,
            flowsPerSecond,
            podsIndexed: podsIndexed || primary.pods_indexed,
            servicesIndexed: primary.services_indexed,
            message: formatModeMessage(
              primary.mode,
              `live from ${agents.length} agent(s)`,
            ),
          };
        }
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Failed to reach agent via pod proxy";
      }
    }

    return {
      connected: false,
      collectorUrl: this.collectorUrl,
      message: `${lastError} — run ./scripts/port-forward-agent.sh or ensure kubectl proxy is running`,
    };
  }

  async fetchFlows(topology: NetworkTopology, k8s: K8sApiClient | null = null): Promise<NetworkFlow[]> {
    const payloads: EbpfFlowPayload[] = [];

    for (const root of this.candidateRoots()) {
      if (!root.startsWith("http")) {
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(this.resolveUrl("/api/v1/flows", root), {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.ok) {
          const body = (await response.json()) as { flows?: EbpfFlowPayload[] };
          payloads.push(...(body.flows ?? []));
        }
      } catch {
        // try next / pod proxy
      }
    }

    if (k8s) {
      const agents = await fetchAllAgentJson<{ flows?: EbpfFlowPayload[] }>(
        k8s,
        "/api/v1/flows",
        { timeoutMs: 5000 },
      );
      for (const agent of agents) {
        payloads.push(...(agent.body.flows ?? []));
      }
    }

    if (payloads.length === 0) {
      // Fall back to single-agent fetch (covers relative /ebpf-api roots).
      const payload = await this.fetchAgentJson<{ flows?: EbpfFlowPayload[] }>(
        "/api/v1/flows",
        k8s,
        5000,
      );
      if (!payload) {
        return [];
      }
      return (payload.body.flows ?? []).map((flow, index) =>
        this.toNetworkFlow(flow, topology, index),
      );
    }

    const merged = new Map<string, EbpfFlowPayload>();
    for (const flow of payloads) {
      const key = flowMergeKey(flow);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, flow);
        continue;
      }
      const existingTs = Date.parse(existing.last_seen ?? existing.timestamp ?? "");
      const nextTs = Date.parse(flow.last_seen ?? flow.timestamp ?? "");
      if (!Number.isFinite(existingTs) || nextTs >= existingTs) {
        merged.set(key, flow);
      }
    }

    return [...merged.values()].map((flow, index) =>
      this.toNetworkFlow(flow, topology, index),
    );
  }

  private toNetworkFlow(
    flow: EbpfFlowPayload,
    topology: NetworkTopology,
    index: number,
  ): NetworkFlow {
    const src = flow.src_pod
      ? {
          kind: "Pod" as const,
          name: flow.src_pod,
          namespace: flow.src_namespace,
          ip: flow.src_ip,
        }
      : resolveEndpoint(flow.src_ip, topology);

    const dst = flow.dst_service
      ? {
          kind: "Service" as const,
          name: flow.dst_service,
          namespace: flow.dst_service_namespace,
          ip: flow.dst_ip,
        }
      : flow.dst_pod
        ? {
            kind: "Pod" as const,
            name: flow.dst_pod,
            namespace: flow.dst_namespace,
            ip: flow.dst_ip,
          }
        : resolveEndpoint(flow.dst_ip, topology);

    const stableId = [
      "ebpf",
      src.namespace ?? "",
      src.name,
      dst.namespace ?? "",
      dst.name,
      flow.protocol ?? "TCP",
      String(flow.port),
    ].join(":");

    return {
      id: stableId || `ebpf-${flow.timestamp}-${index}`,
      timestamp: flow.timestamp,
      firstSeen: flow.first_seen,
      lastSeen: flow.last_seen,
      path: flow.path,
      source: "ebpf",
      src,
      dst,
      protocol: (flow.protocol?.toUpperCase() as NetworkFlow["protocol"]) ?? "TCP",
      port: flow.port,
      verdict: normalizeVerdict(flow.verdict),
      latencyMs: flow.latency_ms,
      bytesSent: flow.bytes_sent,
      bytesReceived: flow.bytes_received,
      retransmits: flow.retransmits,
    };
  }
}

function formatModeMessage(mode?: string, fallback = "agent live"): string {
  if (!mode) {
    return fallback;
  }
  if (mode.includes("hubble")) {
    return `Hubble relay · ${fallback}`;
  }
  if (mode.includes("proc")) {
    return `ProcNet · ${fallback}`;
  }
  return `${mode} · ${fallback}`;
}

function normalizeVerdict(value?: string): NetworkFlow["verdict"] {
  const upper = value?.toUpperCase();
  if (upper === "OK" || upper === "PASS") {
    return "OK";
  }
  if (upper === "DROPPED" || upper === "DROP") {
    return "DROPPED";
  }
  if (upper === "TIMEOUT") {
    return "TIMEOUT";
  }
  if (upper === "RETRY") {
    return "RETRY";
  }
  return "UNKNOWN";
}
