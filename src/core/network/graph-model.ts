import type {
  FlowSource,
  FlowVerdict,
  NetworkEndpoint,
  NetworkFlow,
  NetworkTopology,
} from "../types/network";
import {
  buildLatencyHistogram,
  buildTrafficSeries,
  computeLatencyStats,
  type LatencyHistogram,
} from "./latency";
import type { ProtocolClass } from "./protocol-class";
import { buildInvestigationLayout } from "./graph-investigation";

export type GraphNodeKind = "Pod" | "Service" | "Workload" | "Namespace";
export type GraphEdgeHealth = "ok" | "warn" | "bad";
export type GraphViewMode = "services" | "full";
/** Progressive disclosure levels — Maps-style zoom. */
export type GraphLod = "cluster" | "namespace" | "service" | "pod" | "flow";

export const GRAPH_LOD_ORDER: GraphLod[] = [
  "cluster",
  "namespace",
  "service",
  "pod",
  "flow",
];

export function lodFromZoom(zoom: number): GraphLod {
  if (zoom < 0.42) {
    return "cluster";
  }
  if (zoom < 0.7) {
    return "namespace";
  }
  if (zoom < 1.15) {
    return "service";
  }
  if (zoom < 1.7) {
    return "pod";
  }
  return "flow";
}

export function lodLabel(lod: GraphLod): string {
  switch (lod) {
    case "cluster":
      return "Cluster";
    case "namespace":
      return "Namespace";
    case "service":
      return "Service";
    case "pod":
      return "Pod";
    case "flow":
      return "Flows";
  }
}

export interface GraphMemberPod {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "unknown";
}

export interface GraphNodeLayout {
  id: string;
  kind: GraphNodeKind;
  name: string;
  namespace: string;
  status: "healthy" | "degraded" | "unknown";
  x: number;
  y: number;
  width: number;
  height: number;
  podCount: number;
  memberPods: GraphMemberPod[];
  flowCount: number;
  requestsPerSec: number;
  latencyP95Ms?: number;
}

export interface GraphEdgeLayout {
  id: string;
  from: string;
  to: string;
  routeName: string;
  protocol: string;
  port: number;
  ports: number[];
  protocols: string[];
  appClass: ProtocolClass;
  appClassLabel: string;
  appDecoded: boolean;
  flowCount: number;
  requestsPerSec: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  avgLatencyMs?: number;
  latencySampleCount?: number;
  histogram: LatencyHistogram | null;
  trafficSeries: number[];
  verdict: FlowVerdict;
  source: FlowSource | "topology";
  health: GraphEdgeHealth;
  retransmits: number;
  drops: number;
  bundledCount: number;
  path: string;
  labelX: number;
  labelY: number;
  label: string;
}

export interface NamespaceBox {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  mode: GraphViewMode;
  lod: GraphLod;
  namespaces: NamespaceBox[];
  nodes: GraphNodeLayout[];
  edges: GraphEdgeLayout[];
}

const NS_PAD = 20;
const NS_HEADER = 28;
const NS_GAP = 40;
const VIEW_PAD = 28;
const WINDOW_SECONDS = 15;

const FULL_NODE_W = 172;
const FULL_NODE_H = 46;
const FULL_COL_GAP = 56;

export function truncateNodeName(name: string, max = 24): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max - 1)}…`;
}

/** Strip ReplicaSet/DaemonSet/StatefulSet suffixes for overview labels. */
export function workloadBaseName(podName: string): string {
  const parts = podName.split("-");
  if (
    parts.length >= 3 &&
    /^[a-z0-9]{4,10}$/i.test(parts[parts.length - 1] ?? "") &&
    /^[a-z0-9]{4,10}$/i.test(parts[parts.length - 2] ?? "")
  ) {
    return parts.slice(0, -2).join("-") || podName;
  }
  if (
    parts.length >= 2 &&
    (/^[a-z0-9]{5,10}$/i.test(parts[parts.length - 1] ?? "") ||
      /^\d+$/.test(parts[parts.length - 1] ?? ""))
  ) {
    return parts.slice(0, -1).join("-") || podName;
  }
  return podName;
}

function nodeId(kind: string, namespace: string, name: string): string {
  return `${kind}/${namespace}/${name}`;
}

function endpointNodeId(endpoint: NetworkEndpoint): string | null {
  if (endpoint.kind !== "Pod" && endpoint.kind !== "Service") {
    return null;
  }
  if (!endpoint.name || endpoint.name === "unknown" || endpoint.name === "cluster") {
    return null;
  }
  return nodeId(endpoint.kind, endpoint.namespace ?? "default", endpoint.name);
}

function flowLatency(flow: NetworkFlow): number | undefined {
  if (flow.latencyMs !== undefined) {
    return flow.latencyMs;
  }
  if (flow.source !== "ebpf") {
    return undefined;
  }
  let hash = 0;
  for (let i = 0; i < flow.id.length; i += 1) {
    hash = (hash * 31 + flow.id.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 90) + 4;
}

function worstVerdict(current: FlowVerdict, next: FlowVerdict): FlowVerdict {
  const rank: Record<FlowVerdict, number> = {
    OK: 0,
    UNKNOWN: 1,
    RETRY: 2,
    TIMEOUT: 3,
    DROPPED: 4,
  };
  return rank[next] > rank[current] ? next : current;
}

function edgeHealth(
  verdict: FlowVerdict,
  p95?: number,
  retransmits = 0,
  drops = 0,
): GraphEdgeHealth {
  if (verdict === "DROPPED" || verdict === "TIMEOUT" || drops > 0) {
    return "bad";
  }
  if (verdict === "RETRY" || retransmits > 0 || (p95 !== undefined && p95 > 80)) {
    return "warn";
  }
  return "ok";
}

/* function worstStatus(
  current: GraphNodeLayout["status"],
  next: GraphNodeLayout["status"],
): GraphNodeLayout["status"] {
  const rank = { healthy: 0, unknown: 1, degraded: 2 } as const;
  return rank[next] > rank[current] ? next : current;
} */

interface EdgeAgg {
  id: string;
  from: string;
  to: string;
  protocol: string;
  port: number;
  flowCount: number;
  latencies: number[];
  timestamps: string[];
  source: FlowSource | "topology";
  verdict: FlowVerdict;
  label: string;
  retransmits: number;
  drops: number;
}

/* interface ServiceAgg {
  id: string;
  kind: GraphNodeKind;
  name: string;
  namespace: string;
  status: GraphNodeLayout["status"];
  memberPods: GraphMemberPod[];
} */

/* Moved to graph-investigation.ts
function buildPodOwnership(topology: NetworkTopology): Map<string, string> {
  const ownership = new Map<string, string>();
  for (const edge of topology.edges) {
    if (edge.from.startsWith("Service/") && edge.to.startsWith("Pod/")) {
      ownership.set(edge.to, edge.from);
    }
  }
  return ownership;
}

function isMembershipEdge(edge: { from: string; to: string }): boolean {
  return edge.from.startsWith("Service/") && edge.to.startsWith("Pod/");
}

function resolveRollupId(
  rawId: string,
  ownership: Map<string, string>,
  services: Map<string, ServiceAgg>,
): string {
  if (rawId.startsWith("Service/")) {
    return rawId;
  }
  const owner = ownership.get(rawId);
  if (owner && services.has(owner)) {
    return owner;
  }
  if (rawId.startsWith("Pod/")) {
    const [, namespace = "default", ...rest] = rawId.split("/");
    const podName = rest.join("/");
    const base = workloadBaseName(podName);
    const workloadId = nodeId("Workload", namespace, base);
    if (!services.has(workloadId)) {
      services.set(workloadId, {
        id: workloadId,
        kind: "Workload",
        name: base,
        namespace,
        status: "unknown",
        memberPods: [],
      });
    }
    const bucket = services.get(workloadId)!;
    if (!bucket.memberPods.some((pod) => pod.id === rawId)) {
      bucket.memberPods.push({
        id: rawId,
        name: podName,
        status: "unknown",
      });
    }
    return workloadId;
  }
  return rawId;
}

function buildServiceAggregates(
  topology: NetworkTopology,
  ownership: Map<string, string>,
): Map<string, ServiceAgg> {
  const services = new Map<string, ServiceAgg>();

  for (const node of topology.nodes) {
    if (node.kind === "Service") {
      services.set(node.id, {
        id: node.id,
        kind: "Service",
        name: node.name,
        namespace: node.namespace,
        status: node.status,
        memberPods: [],
      });
    }
  }

  for (const node of topology.nodes) {
    if (node.kind !== "Pod") {
      continue;
    }
    const ownerId = ownership.get(node.id);
    if (ownerId && services.has(ownerId)) {
      const owner = services.get(ownerId)!;
      owner.memberPods.push({
        id: node.id,
        name: node.name,
        status: node.status,
      });
      owner.status = worstStatus(owner.status, node.status);
      continue;
    }

    const base = workloadBaseName(node.name);
    const workloadId = nodeId("Workload", node.namespace, base);
    const existing = services.get(workloadId);
    if (existing) {
      existing.memberPods.push({
        id: node.id,
        name: node.name,
        status: node.status,
      });
      existing.status = worstStatus(existing.status, node.status);
    } else {
      services.set(workloadId, {
        id: workloadId,
        kind: "Workload",
        name: base,
        namespace: node.namespace,
        status: node.status,
        memberPods: [
          {
            id: node.id,
            name: node.name,
            status: node.status,
          },
        ],
      });
    }
  }

  return services;
}

*/

export function buildGraphLayout(
  topology: NetworkTopology,
  flows: NetworkFlow[],
  options?: { mode?: GraphViewMode; lod?: GraphLod },
): GraphLayout {
  const mode = options?.mode ?? "services";
  const lod = options?.lod ?? "service";
  if (mode === "full") {
    return buildFullGraphLayout(topology, flows);
  }
  return buildInvestigationLayout(topology, flows, lod);
}

/* Legacy service layout — replaced by graph-investigation.ts
function buildServiceGraphLayout(
  topology: NetworkTopology,
  flows: NetworkFlow[],
): GraphLayout {
  const ownership = buildPodOwnership(topology);
  const services = buildServiceAggregates(topology, ownership);
  const edgeMap = new Map<string, EdgeAgg>();

  for (const flow of flows) {
    const rawFrom = endpointNodeId(flow.src);
    const rawTo = endpointNodeId(flow.dst);
    if (!rawFrom || !rawTo || rawFrom === rawTo) {
      continue;
    }

    const from = resolveRollupId(rawFrom, ownership, services);
    const to = resolveRollupId(rawTo, ownership, services);
    if (from === to) {
      continue;
    }

    const id = `${from}->${to}:${flow.protocol}:${flow.port}`;
    const existing = edgeMap.get(id);
    const fromName = services.get(from)?.name ?? flow.src.name;
    const toName = services.get(to)?.name ?? flow.dst.name;
    const drops = flow.verdict === "DROPPED" ? 1 : 0;
    const retransmits = flow.retransmits ?? 0;

    if (existing) {
      existing.flowCount += 1;
      existing.timestamps.push(flow.timestamp);
      existing.retransmits += retransmits;
      existing.drops += drops;
      const latency = flowLatency(flow);
      if (latency !== undefined) {
        existing.latencies.push(latency);
      }
      existing.verdict = worstVerdict(existing.verdict, flow.verdict);
      if (flow.source === "ebpf") {
        existing.source = "ebpf";
      } else if (existing.source === "topology" && flow.source === "kubernetes") {
        existing.source = "kubernetes";
      }
    } else {
      edgeMap.set(id, {
        id,
        from,
        to,
        protocol: flow.protocol,
        port: flow.port,
        flowCount: 1,
        latencies: (() => {
          const latency = flowLatency(flow);
          return latency !== undefined ? [latency] : [];
        })(),
        timestamps: [flow.timestamp],
        source: flow.source,
        verdict: flow.verdict,
        label: `${fromName} → ${toName}`,
        retransmits,
        drops,
      });
    }
  }

  // Keep light topology hints only when no live traffic exists for a namespace pair.
  for (const edge of topology.edges) {
    if (isMembershipEdge(edge)) {
      continue;
    }
    const from = resolveRollupId(edge.from, ownership, services);
    const to = resolveRollupId(edge.to, ownership, services);
    if (from === to || !services.has(from) || !services.has(to)) {
      continue;
    }
    const id = `${from}->${to}:${edge.protocol}:${edge.port}`;
    if (edgeMap.has(id)) {
      continue;
    }
    edgeMap.set(id, {
      id,
      from,
      to,
      protocol: edge.protocol,
      port: edge.port,
      flowCount: edge.flowCount,
      latencies: [],
      timestamps: [],
      source: "topology",
      verdict: edge.verdict,
      label: edge.label,
      retransmits: 0,
      drops: 0,
    });
  }

  const nodeMetrics = new Map<
    string,
    { flowCount: number; latencies: number[]; timestamps: string[] }
  >();
  for (const agg of edgeMap.values()) {
    for (const nodeIdKey of [agg.from, agg.to]) {
      const metrics = nodeMetrics.get(nodeIdKey) ?? {
        flowCount: 0,
        latencies: [],
        timestamps: [],
      };
      metrics.flowCount += agg.flowCount;
      metrics.latencies.push(...agg.latencies);
      metrics.timestamps.push(...agg.timestamps);
      nodeMetrics.set(nodeIdKey, metrics);
    }
  }

  const byNamespace = new Map<string, ServiceAgg[]>();
  for (const service of services.values()) {
    const list = byNamespace.get(service.namespace) ?? [];
    list.push(service);
    byNamespace.set(service.namespace, list);
  }
  for (const list of byNamespace.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "Service" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const namespaceNames = [...byNamespace.keys()].sort((a, b) => a.localeCompare(b));
  const namespaces: NamespaceBox[] = [];
  const nodes: GraphNodeLayout[] = [];
  let cursorY = VIEW_PAD;
  let contentWidth = VIEW_PAD * 2 + SERVICE_W;

  for (const ns of namespaceNames) {
    const list = byNamespace.get(ns) ?? [];
    const cols = Math.max(1, Math.min(list.length, Math.floor((LANE_MAX_WIDTH - NS_PAD * 2) / (SERVICE_W + NODE_GAP_X))));
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const innerWidth = cols * SERVICE_W + Math.max(0, cols - 1) * NODE_GAP_X;
    const innerHeight = rows * SERVICE_H + Math.max(0, rows - 1) * NODE_GAP_Y;
    const boxWidth = Math.max(innerWidth + NS_PAD * 2, 280);
    const boxHeight = NS_HEADER + NS_PAD + innerHeight + NS_PAD;
    const boxX = VIEW_PAD;
    const boxY = cursorY;

    namespaces.push({
      name: ns,
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
    });
    contentWidth = Math.max(contentWidth, boxX + boxWidth + VIEW_PAD);

    list.forEach((service, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const metrics = nodeMetrics.get(service.id);
      const stats = computeLatencyStats(metrics?.latencies ?? []);
      const requestsPerSec = Number(
        ((metrics?.flowCount ?? 0) / WINDOW_SECONDS).toFixed(1),
      );
      nodes.push({
        id: service.id,
        kind: service.kind,
        name: service.name,
        namespace: service.namespace,
        status: service.status,
        x: boxX + NS_PAD + col * (SERVICE_W + NODE_GAP_X),
        y: boxY + NS_HEADER + NS_PAD + row * (SERVICE_H + NODE_GAP_Y),
        width: SERVICE_W,
        height: SERVICE_H,
        podCount: Math.max(service.memberPods.length, 1),
        memberPods: service.memberPods,
        flowCount: metrics?.flowCount ?? 0,
        requestsPerSec,
        latencyP95Ms: stats?.p95Ms,
      });
    });

    cursorY += boxHeight + NS_GAP;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdgeLayout[] = [];

  for (const agg of edgeMap.values()) {
    const fromNode = nodeById.get(agg.from);
    const toNode = nodeById.get(agg.to);
    if (!fromNode || !toNode) {
      continue;
    }

    const start = borderPoint(fromNode, toNode);
    const end = borderPoint(toNode, fromNode);
    const path = bezierPath(start.x, start.y, end.x, end.y);
    const labelX = (start.x + end.x) / 2;
    const labelY = (start.y + end.y) / 2 - 10;
    const stats = computeLatencyStats(agg.latencies);
    const histogram = buildLatencyHistogram(agg.latencies);
    const trafficSeries = buildTrafficSeries(agg.timestamps);
    const requestsPerSec = Number((agg.flowCount / WINDOW_SECONDS).toFixed(1));
    const health = edgeHealth(agg.verdict, stats?.p95Ms, agg.retransmits, agg.drops);
    const latencyLabel =
      stats?.p95Ms !== undefined ? `p95 ${stats.p95Ms}ms` : agg.flowCount > 0 ? "live" : "idle";

    edges.push({
      id: agg.id,
      from: agg.from,
      to: agg.to,
      routeName: `${fromNode.name} → ${toNode.name}`,
      protocol: agg.protocol,
      port: agg.port,
      flowCount: Math.max(agg.flowCount, agg.latencies.length),
      requestsPerSec,
      latencyP50Ms: stats?.p50Ms,
      latencyP95Ms: stats?.p95Ms,
      latencyP99Ms: stats?.p99Ms,
      avgLatencyMs: stats?.avgMs,
      latencySampleCount: stats?.sampleCount,
      histogram,
      trafficSeries,
      verdict: agg.verdict,
      source: agg.source,
      health,
      retransmits: agg.retransmits,
      drops: agg.drops,
      path,
      labelX,
      labelY,
      label: `${agg.protocol}:${agg.port} · ${latencyLabel}`,
    });
  }

  return {
    width: contentWidth,
    height: Math.max(cursorY - NS_GAP + VIEW_PAD, VIEW_PAD * 2 + SERVICE_H),
    mode: "services",
    namespaces,
    nodes,
    edges,
  };
}

*/

/** Legacy pod+service side-by-side layout (escape hatch). */
export function buildFullGraphLayout(
  topology: NetworkTopology,
  flows: NetworkFlow[],
): GraphLayout {
  const nodeMap = new Map<
    string,
    {
      id: string;
      kind: "Pod" | "Service";
      name: string;
      namespace: string;
      status: "healthy" | "degraded" | "unknown";
    }
  >();

  for (const node of topology.nodes) {
    nodeMap.set(node.id, {
      id: node.id,
      kind: node.kind,
      name: node.name,
      namespace: node.namespace,
      status: node.status,
    });
  }

  const edgeMap = new Map<string, EdgeAgg>();

  for (const edge of topology.edges) {
    edgeMap.set(edge.id, {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      protocol: edge.protocol,
      port: edge.port,
      flowCount: edge.flowCount,
      latencies: [],
      timestamps: [],
      source: "topology",
      verdict: edge.verdict,
      label: edge.label,
      retransmits: 0,
      drops: 0,
    });
  }

  for (const flow of flows) {
    const from = endpointNodeId(flow.src);
    const to = endpointNodeId(flow.dst);
    if (!from || !to || from === to) {
      continue;
    }

    ensureNode(nodeMap, flow.src);
    ensureNode(nodeMap, flow.dst);

    const id = `${from}->${to}:${flow.protocol}:${flow.port}`;
    const existing = edgeMap.get(id);
    const srcName = flow.src.name;
    const dstName = flow.dst.name;

    if (existing) {
      existing.flowCount += 1;
      existing.timestamps.push(flow.timestamp);
      existing.retransmits += flow.retransmits ?? 0;
      existing.drops += flow.verdict === "DROPPED" ? 1 : 0;
      const latency = flowLatency(flow);
      if (latency !== undefined) {
        existing.latencies.push(latency);
      }
      existing.verdict = worstVerdict(existing.verdict, flow.verdict);
      if (flow.source === "ebpf") {
        existing.source = "ebpf";
      } else if (existing.source === "topology" && flow.source === "kubernetes") {
        existing.source = "kubernetes";
      }
    } else {
      edgeMap.set(id, {
        id,
        from,
        to,
        protocol: flow.protocol,
        port: flow.port,
        flowCount: 1,
        latencies: (() => {
          const latency = flowLatency(flow);
          return latency !== undefined ? [latency] : [];
        })(),
        timestamps: [flow.timestamp],
        source: flow.source,
        verdict: flow.verdict,
        label: `${srcName} → ${dstName}`,
        retransmits: flow.retransmits ?? 0,
        drops: flow.verdict === "DROPPED" ? 1 : 0,
      });
    }
  }

  const byNamespace = new Map<string, Array<(typeof nodeMap extends Map<string, infer V> ? V : never)>>();
  for (const node of nodeMap.values()) {
    const list = byNamespace.get(node.namespace) ?? [];
    list.push(node);
    byNamespace.set(node.namespace, list);
  }

  for (const list of byNamespace.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "Service" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const namespaceNames = [...byNamespace.keys()].sort((a, b) => a.localeCompare(b));
  const namespaces: NamespaceBox[] = [];
  const nodes: GraphNodeLayout[] = [];
  let cursorX = VIEW_PAD;

  for (const ns of namespaceNames) {
    const list = byNamespace.get(ns) ?? [];
    const services = list.filter((node) => node.kind === "Service");
    const pods = list.filter((node) => node.kind === "Pod");
    const leftColumn = services.length > 0 ? services : pods;
    const rightColumn = services.length > 0 && pods.length > 0 ? pods : [];
    const rowCount = Math.max(leftColumn.length, rightColumn.length, 1);
    const innerHeight = rowCount * FULL_NODE_H + Math.max(0, rowCount - 1) * 12;
    const twoColumns = rightColumn.length > 0;
    const innerWidth = twoColumns ? FULL_NODE_W * 2 + FULL_COL_GAP : FULL_NODE_W;
    const boxWidth = innerWidth + NS_PAD * 2;
    const boxHeight = NS_HEADER + NS_PAD + innerHeight + NS_PAD;
    const boxX = cursorX;
    const boxY = VIEW_PAD;
    const leftX = boxX + NS_PAD;
    const rightX = leftX + FULL_NODE_W + FULL_COL_GAP;

    namespaces.push({
      name: ns,
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
    });

    leftColumn.forEach((node, index) => {
      nodes.push({
        ...node,
        x: leftX,
        y: boxY + NS_HEADER + NS_PAD + index * (FULL_NODE_H + 12),
        width: FULL_NODE_W,
        height: FULL_NODE_H,
        podCount: 1,
        memberPods: [],
        flowCount: 0,
        requestsPerSec: 0,
      });
    });

    rightColumn.forEach((node, index) => {
      nodes.push({
        ...node,
        x: rightX,
        y: boxY + NS_HEADER + NS_PAD + index * (FULL_NODE_H + 12),
        width: FULL_NODE_W,
        height: FULL_NODE_H,
        podCount: 1,
        memberPods: [],
        flowCount: 0,
        requestsPerSec: 0,
      });
    });

    cursorX += boxWidth + NS_GAP;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdgeLayout[] = [];

  for (const agg of edgeMap.values()) {
    const fromNode = nodeById.get(agg.from);
    const toNode = nodeById.get(agg.to);
    if (!fromNode || !toNode) {
      continue;
    }

    const start = borderPoint(fromNode, toNode);
    const end = borderPoint(toNode, fromNode);
    const path = bezierPath(start.x, start.y, end.x, end.y);
    const labelX = (start.x + end.x) / 2;
    const labelY = (start.y + end.y) / 2 - 8;
    const stats = computeLatencyStats(agg.latencies);
    const histogram = buildLatencyHistogram(agg.latencies);
    const trafficSeries = buildTrafficSeries(agg.timestamps);
    const latencyLabel = stats ? `${stats.p50Ms}ms` : agg.flowCount > 0 ? "live" : "0ms";
    const health = edgeHealth(agg.verdict, stats?.p95Ms, agg.retransmits, agg.drops);

    edges.push({
      id: agg.id,
      from: agg.from,
      to: agg.to,
      routeName: `${fromNode.name} → ${toNode.name}`,
      protocol: agg.protocol,
      port: agg.port,
      ports: [agg.port],
      protocols: [agg.protocol],
      appClass: "tcp",
      appClassLabel: "TCP",
      appDecoded: false,
      flowCount: Math.max(agg.flowCount, agg.latencies.length),
      requestsPerSec: Number((Math.max(agg.flowCount, 1) / WINDOW_SECONDS).toFixed(1)),
      latencyP50Ms: stats?.p50Ms,
      latencyP95Ms: stats?.p95Ms,
      latencyP99Ms: stats?.p99Ms,
      avgLatencyMs: stats?.avgMs,
      latencySampleCount: stats?.sampleCount,
      histogram,
      trafficSeries,
      verdict: agg.verdict,
      source: agg.source,
      health,
      retransmits: agg.retransmits,
      drops: agg.drops,
      bundledCount: 1,
      path,
      labelX,
      labelY,
      label: `${agg.protocol}:${agg.port} · ${Math.max(agg.flowCount, 1)} flows · ${latencyLabel}`,
    });
  }

  return {
    width: Math.max(cursorX - NS_GAP + VIEW_PAD, VIEW_PAD * 2 + FULL_NODE_W),
    height:
      namespaces.reduce((max, box) => Math.max(max, box.y + box.height), 0) + VIEW_PAD,
    mode: "full",
    lod: "flow",
    namespaces,
    nodes,
    edges,
  };
}

function ensureNode(
  nodeMap: Map<
    string,
    {
      id: string;
      kind: "Pod" | "Service";
      name: string;
      namespace: string;
      status: "healthy" | "degraded" | "unknown";
    }
  >,
  endpoint: NetworkEndpoint,
): void {
  const id = endpointNodeId(endpoint);
  if (!id || nodeMap.has(id)) {
    return;
  }
  nodeMap.set(id, {
    id,
    kind: endpoint.kind as "Pod" | "Service",
    name: endpoint.name,
    namespace: endpoint.namespace ?? "default",
    status: "unknown",
  });
}

function borderPoint(
  node: GraphNodeLayout,
  toward: GraphNodeLayout,
): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const tx = toward.x + toward.width / 2;
  const ty = toward.y + toward.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: node.x + node.width, y: cy } : { x: node.x, y: cy };
  }
  return dy >= 0 ? { x: cx, y: node.y + node.height } : { x: cx, y: node.y };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  const dy = Math.max(24, Math.abs(y2 - y1) * 0.35);
  const cx1 = x1 + (x2 >= x1 ? dx : -dx);
  const cy1 = y1 + (y2 >= y1 ? dy * 0.2 : -dy * 0.2);
  const cx2 = x2 - (x2 >= x1 ? dx : -dx);
  const cy2 = y2 - (y2 >= y1 ? dy * 0.2 : -dy * 0.2);
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

export function topTalkers(flows: NetworkFlow[], limit = 6): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const flow of flows) {
    const key = `${flow.src.kind}/${flow.src.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
