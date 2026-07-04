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

export interface GraphNodeLayout {
  id: string;
  kind: "Pod" | "Service";
  name: string;
  namespace: string;
  status: "healthy" | "degraded" | "unknown";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdgeLayout {
  id: string;
  from: string;
  to: string;
  routeName: string;
  protocol: string;
  port: number;
  flowCount: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  avgLatencyMs?: number;
  latencySampleCount?: number;
  histogram: LatencyHistogram | null;
  trafficSeries: number[];
  verdict: FlowVerdict;
  source: FlowSource | "topology";
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
  namespaces: NamespaceBox[];
  nodes: GraphNodeLayout[];
  edges: GraphEdgeLayout[];
}

const NODE_W = 172;
const NODE_H = 46;
const NS_PAD = 18;
const NS_HEADER = 30;
const NS_GAP = 48;
const NODE_GAP = 12;
const COL_GAP = 56;
const VIEW_PAD = 28;

export function truncateNodeName(name: string, max = 24): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max - 1)}…`;
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
}

export function buildGraphLayout(
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
      });
    }
  }

  const byNamespace = new Map<string, typeof nodeMap extends Map<string, infer V> ? V[] : never>();
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
    const innerHeight = rowCount * NODE_H + Math.max(0, rowCount - 1) * NODE_GAP;
    const twoColumns = rightColumn.length > 0;
    const innerWidth = twoColumns ? NODE_W * 2 + COL_GAP : NODE_W;
    const boxWidth = innerWidth + NS_PAD * 2;
    const boxHeight = NS_HEADER + NS_PAD + innerHeight + NS_PAD;
    const boxX = cursorX;
    const boxY = VIEW_PAD;
    const leftX = boxX + NS_PAD;
    const rightX = leftX + NODE_W + COL_GAP;

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
        y: boxY + NS_HEADER + NS_PAD + index * (NODE_H + NODE_GAP),
        width: NODE_W,
        height: NODE_H,
      });
    });

    rightColumn.forEach((node, index) => {
      nodes.push({
        ...node,
        x: rightX,
        y: boxY + NS_HEADER + NS_PAD + index * (NODE_H + NODE_GAP),
        width: NODE_W,
        height: NODE_H,
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

    edges.push({
      id: agg.id,
      from: agg.from,
      to: agg.to,
      routeName: `${fromNode.name} → ${toNode.name}`,
      protocol: agg.protocol,
      port: agg.port,
      flowCount: Math.max(agg.flowCount, agg.latencies.length),
      latencyP50Ms: stats?.p50Ms,
      latencyP95Ms: stats?.p95Ms,
      latencyP99Ms: stats?.p99Ms,
      avgLatencyMs: stats?.avgMs,
      latencySampleCount: stats?.sampleCount,
      histogram,
      trafficSeries,
      verdict: agg.verdict,
      source: agg.source,
      path,
      labelX,
      labelY,
      label: `${agg.protocol}:${agg.port} · ${Math.max(agg.flowCount, 1)} flows · ${latencyLabel}`,
    });
  }

  const contentWidth = Math.max(cursorX - NS_GAP + VIEW_PAD, VIEW_PAD * 2 + NODE_W);
  const contentHeight =
    namespaces.reduce((max, box) => Math.max(max, box.y + box.height), 0) + VIEW_PAD;

  return { width: contentWidth, height: contentHeight, namespaces, nodes, edges };
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
