import type { GraphEdgeLayout } from "./graph-model";
import { inferProtocolClass, type ProtocolClass } from "./protocol-class";
import type { NetworkFlow, NetworkSnapshot } from "../types/network";

const WINDOW_SECONDS = 15;

export interface NetworkOverviewStats {
  activeFlows: number;
  services: number;
  requestsPerSec: number;
  p95LatencyMs?: number;
  tcpDrops: number;
  tcpRetransmits: number;
  dnsFailures: number;
}

export interface NetworkPathRow {
  id: string;
  source: string;
  sourceNamespace?: string;
  destination: string;
  destinationNamespace?: string;
  protocol: string;
  port: number;
  appClass: ProtocolClass;
  requestsPerSec: number;
  flowCount: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  errors: number;
  drops: number;
  retransmits: number;
  bytesPerSec: number;
  verdict: string;
  path?: string;
  sampleFlowIds: string[];
}

function endpointKey(name: string, namespace?: string): string {
  return namespace ? `${namespace}/${name}` : name;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function buildOverviewStats(
  snapshot: NetworkSnapshot,
  edges: GraphEdgeLayout[],
): NetworkOverviewStats {
  const flows = snapshot.flows;
  const latencies = flows
    .map((flow) => flow.latencyMs)
    .filter((value): value is number => value !== undefined && value >= 0)
    .sort((a, b) => a - b);

  const edgeP95 = edges
    .map((edge) => edge.latencyP95Ms)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);

  const tcpDrops = flows.filter(
    (flow) =>
      flow.protocol === "TCP" &&
      (flow.verdict === "DROPPED" || flow.verdict === "TIMEOUT"),
  ).length;

  const tcpRetransmits = flows.reduce((sum, flow) => sum + (flow.retransmits ?? 0), 0);

  const dnsFailures = flows.filter(
    (flow) =>
      flow.port === 53 &&
      (flow.verdict === "DROPPED" || flow.verdict === "TIMEOUT" || flow.verdict === "RETRY"),
  ).length;

  return {
    activeFlows: flows.length,
    services: snapshot.topology.nodes.filter((node) => node.kind === "Service").length,
    requestsPerSec: Number((flows.length / WINDOW_SECONDS).toFixed(1)),
    p95LatencyMs: percentile(latencies, 95) ?? percentile(edgeP95, 95),
    tcpDrops,
    tcpRetransmits,
    dnsFailures,
  };
}

export function rankSlowEdges(edges: GraphEdgeLayout[], limit = 6): GraphEdgeLayout[] {
  return [...edges]
    .filter((edge) => edge.flowCount > 0)
    .sort(
      (a, b) =>
        (b.latencyP95Ms ?? b.latencyP99Ms ?? 0) - (a.latencyP95Ms ?? a.latencyP99Ms ?? 0) ||
        b.flowCount - a.flowCount,
    )
    .slice(0, limit);
}

export function rankRetransmitEdges(
  edges: GraphEdgeLayout[],
  flows: NetworkFlow[],
  limit = 6,
): Array<GraphEdgeLayout & { retransmits: number }> {
  const byEdge = new Map<string, number>();
  for (const flow of flows) {
    const key = `${flow.src.name}->${flow.dst.name}:${flow.port}`;
    byEdge.set(key, (byEdge.get(key) ?? 0) + (flow.retransmits ?? 0));
  }

  return [...edges]
    .map((edge) => {
      const key = `${edge.routeName.split(" → ")[0]}->${edge.routeName.split(" → ")[1]}:${edge.port}`;
      const fallback = flows
        .filter((flow) => flow.port === edge.port)
        .reduce((sum, flow) => sum + (flow.retransmits ?? 0), 0);
      return { ...edge, retransmits: byEdge.get(key) ?? fallback };
    })
    .filter((edge) => edge.retransmits > 0 || edge.verdict === "RETRY")
    .sort((a, b) => b.retransmits - a.retransmits || b.flowCount - a.flowCount)
    .slice(0, limit);
}

export function recentDroppedFlows(flows: NetworkFlow[], limit = 8): NetworkFlow[] {
  return flows
    .filter(
      (flow) =>
        flow.verdict === "DROPPED" || flow.verdict === "TIMEOUT" || flow.verdict === "RETRY",
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function buildPathRows(flows: NetworkFlow[]): NetworkPathRow[] {
  const groups = new Map<string, NetworkFlow[]>();

  for (const flow of flows) {
    const key = [
      endpointKey(flow.src.name, flow.src.namespace),
      endpointKey(flow.dst.name, flow.dst.namespace),
      flow.protocol,
      String(flow.port),
    ].join("|");
    const bucket = groups.get(key) ?? [];
    bucket.push(flow);
    groups.set(key, bucket);
  }

  const rows: NetworkPathRow[] = [];
  for (const [id, bucket] of groups) {
    const sample = bucket[0];
    const latencies = bucket
      .map((flow) => flow.latencyMs)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    const bytes = bucket.reduce(
      (sum, flow) => sum + (flow.bytesSent ?? 0) + (flow.bytesReceived ?? 0),
      0,
    );
    const errors = bucket.filter(
      (flow) =>
        flow.verdict === "DROPPED" ||
        flow.verdict === "TIMEOUT" ||
        flow.verdict === "RETRY",
    ).length;
    const drops = bucket.filter((flow) => flow.verdict === "DROPPED").length;
    const retransmits = bucket.reduce((sum, flow) => sum + (flow.retransmits ?? 0), 0);
    const worst =
      bucket.find((flow) => flow.verdict === "DROPPED") ??
      bucket.find((flow) => flow.verdict === "TIMEOUT") ??
      bucket.find((flow) => flow.verdict === "RETRY") ??
      sample;

    rows.push({
      id,
      source: sample.src.name,
      sourceNamespace: sample.src.namespace,
      destination: sample.dst.name,
      destinationNamespace: sample.dst.namespace,
      protocol: sample.protocol,
      port: sample.port,
      appClass: inferProtocolClass(sample.port, sample.protocol),
      requestsPerSec: Number((bucket.length / WINDOW_SECONDS).toFixed(2)),
      flowCount: bucket.length,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      errors,
      drops,
      retransmits,
      bytesPerSec: Number((bytes / WINDOW_SECONDS).toFixed(1)),
      verdict: worst.verdict,
      path: sample.path,
      sampleFlowIds: bucket.map((flow) => flow.id),
    });
  }

  return rows.sort(
    (a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0) || b.flowCount - a.flowCount,
  );
}
