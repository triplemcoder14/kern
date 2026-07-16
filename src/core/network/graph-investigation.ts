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
} from "./latency";
import type {
  GraphEdgeHealth,
  GraphEdgeLayout,
  GraphLayout,
  GraphLod,
  GraphMemberPod,
  GraphNodeKind,
  GraphNodeLayout,
  NamespaceBox,
} from "./graph-model";
import {
  protocolClassLabel,
  resolveProtocolClass,
  type ProtocolClass,
} from "./protocol-class";

function truncateNodeName(name: string, max = 24): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max - 1)}…`;
}

function workloadBaseName(podName: string): string {
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

const SERVICE_W = 208;
const SERVICE_H = 92;
const POD_W = 168;
const POD_H = 44;
const NS_NODE_W = 240;
const NS_NODE_H = 110;
const NS_PAD = 20;
const NS_HEADER = 28;
const NS_GAP = 40;
const NODE_GAP_X = 20;
const NODE_GAP_Y = 16;
const VIEW_PAD = 28;
const LANE_MAX_WIDTH = 1180;
const WINDOW_SECONDS = 15;
const BUNDLE_NS_THRESHOLD = 4;

interface EdgeAgg {
  id: string;
  from: string;
  to: string;
  protocol: string;
  port: number;
  ports: number[];
  protocols: string[];
  appClass: ProtocolClass;
  appDecoded: boolean;
  appVotes: Partial<Record<ProtocolClass, number>>;
  flowCount: number;
  latencies: number[];
  timestamps: string[];
  source: FlowSource | "topology";
  verdict: FlowVerdict;
  label: string;
  retransmits: number;
  drops: number;
  bundledCount: number;
}

interface ServiceAgg {
  id: string;
  kind: Exclude<GraphNodeKind, "Namespace" | "Pod"> | "Service" | "Workload";
  name: string;
  namespace: string;
  status: GraphNodeLayout["status"];
  memberPods: GraphMemberPod[];
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

function worstStatus(
  current: GraphNodeLayout["status"],
  next: GraphNodeLayout["status"],
): GraphNodeLayout["status"] {
  const rank = { healthy: 0, unknown: 1, degraded: 2 } as const;
  return rank[next] > rank[current] ? next : current;
}

function dominantAppClass(votes: Partial<Record<ProtocolClass, number>>): ProtocolClass {
  let best: ProtocolClass = "tcp";
  let bestCount = -1;
  for (const [key, count] of Object.entries(votes) as Array<[ProtocolClass, number]>) {
    if ((count ?? 0) > bestCount) {
      best = key;
      bestCount = count ?? 0;
    }
  }
  return best;
}

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
      owner.memberPods.push({ id: node.id, name: node.name, status: node.status });
      owner.status = worstStatus(owner.status, node.status);
      continue;
    }

    const base = workloadBaseName(node.name);
    const workloadId = nodeId("Workload", node.namespace, base);
    const existing = services.get(workloadId);
    if (existing) {
      existing.memberPods.push({ id: node.id, name: node.name, status: node.status });
      existing.status = worstStatus(existing.status, node.status);
    } else {
      services.set(workloadId, {
        id: workloadId,
        kind: "Workload",
        name: base,
        namespace: node.namespace,
        status: node.status,
        memberPods: [{ id: node.id, name: node.name, status: node.status }],
      });
    }
  }

  return services;
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
      bucket.memberPods.push({ id: rawId, name: podName, status: "unknown" });
    }
    return workloadId;
  }
  return rawId;
}

function noteAppClass(agg: EdgeAgg, appClass: ProtocolClass, decoded: boolean): void {
  agg.appVotes[appClass] = (agg.appVotes[appClass] ?? 0) + 1;
  agg.appClass = dominantAppClass(agg.appVotes);
  if (decoded) {
    agg.appDecoded = true;
  }
}

function ingestFlowEdge(
  edgeMap: Map<string, EdgeAgg>,
  from: string,
  to: string,
  flow: NetworkFlow,
  fromName: string,
  toName: string,
  keyExtra: string,
): void {
  const id = `${from}->${to}:${keyExtra}`;
  const drops = flow.verdict === "DROPPED" ? 1 : 0;
  const retransmits = flow.retransmits ?? 0;
  const appClass = resolveProtocolClass(flow);
  const decoded = Boolean(
    flow.dnsQuery || flow.httpMethod || flow.httpPath || flow.httpStatus !== undefined || flow.grpcMethod || flow.grpcStatus !== undefined,
  );
  const existing = edgeMap.get(id);

  if (existing) {
    existing.flowCount += 1;
    existing.timestamps.push(flow.timestamp);
    existing.retransmits += retransmits;
    existing.drops += drops;
    if (!existing.ports.includes(flow.port)) {
      existing.ports.push(flow.port);
    }
    if (!existing.protocols.includes(flow.protocol)) {
      existing.protocols.push(flow.protocol);
    }
    noteAppClass(existing, appClass, decoded);
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
    return;
  }

  edgeMap.set(id, {
    id,
    from,
    to,
    protocol: flow.protocol,
    port: flow.port,
    ports: [flow.port],
    protocols: [flow.protocol],
    appClass,
    appDecoded: decoded,
    appVotes: { [appClass]: 1 },
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
    bundledCount: 1,
  });
}

function bundlePairEdges(edgeMap: Map<string, EdgeAgg>): Map<string, EdgeAgg> {
  const bundled = new Map<string, EdgeAgg>();
  for (const agg of edgeMap.values()) {
    const key = `${agg.from}->${agg.to}`;
    const existing = bundled.get(key);
    if (!existing) {
      bundled.set(key, { ...agg, id: key, bundledCount: 1, appVotes: { ...agg.appVotes } });
      continue;
    }
    existing.flowCount += agg.flowCount;
    existing.latencies.push(...agg.latencies);
    existing.timestamps.push(...agg.timestamps);
    existing.retransmits += agg.retransmits;
    existing.drops += agg.drops;
    existing.bundledCount += 1;
    existing.verdict = worstVerdict(existing.verdict, agg.verdict);
    for (const port of agg.ports) {
      if (!existing.ports.includes(port)) {
        existing.ports.push(port);
      }
    }
    for (const protocol of agg.protocols) {
      if (!existing.protocols.includes(protocol)) {
        existing.protocols.push(protocol);
      }
    }
    for (const [cls, votes] of Object.entries(agg.appVotes) as Array<[ProtocolClass, number]>) {
      existing.appVotes[cls] = (existing.appVotes[cls] ?? 0) + votes;
    }
    existing.appClass = dominantAppClass(existing.appVotes);
    existing.appDecoded = existing.appDecoded || agg.appDecoded;
    if (agg.source === "ebpf") {
      existing.source = "ebpf";
    }
  }
  return bundled;
}

/** Fan-in: many targets in same namespace → one trunk edge per namespace, then synthetic fans kept as pair edges if few. */
function bundleNamespaceFanIn(
  edgeMap: Map<string, EdgeAgg>,
  nodeNamespace: Map<string, string>,
): Map<string, EdgeAgg> {
  const bySourceNs = new Map<string, EdgeAgg[]>();
  for (const edge of edgeMap.values()) {
    const toNs = nodeNamespace.get(edge.to);
    if (!toNs) {
      continue;
    }
    const key = `${edge.from}=>${toNs}`;
    const list = bySourceNs.get(key) ?? [];
    list.push(edge);
    bySourceNs.set(key, list);
  }

  const keep = new Map<string, EdgeAgg>();
  const consumed = new Set<string>();

  for (const [key, group] of bySourceNs) {
    if (group.length < BUNDLE_NS_THRESHOLD) {
      continue;
    }
    const [from, toNs] = key.split("=>");
    if (!from || !toNs) {
      continue;
    }
    // Prefer keeping the heaviest edge and marking others as bundled into it visually
    // by merging into a single edge toward the first target, labeled as namespace bundle.
    const primary = [...group].sort((a, b) => b.flowCount - a.flowCount)[0];
    if (!primary) {
      continue;
    }
    const merged: EdgeAgg = {
      ...primary,
      id: `${from}->ns:${toNs}`,
      to: primary.to,
      label: `${from.split("/").pop()} → ${toNs} (${group.length})`,
      bundledCount: group.length,
      ports: [...new Set(group.flatMap((edge) => edge.ports))],
      protocols: [...new Set(group.flatMap((edge) => edge.protocols))],
      flowCount: group.reduce((sum, edge) => sum + edge.flowCount, 0),
      latencies: group.flatMap((edge) => edge.latencies),
      timestamps: group.flatMap((edge) => edge.timestamps),
      retransmits: group.reduce((sum, edge) => sum + edge.retransmits, 0),
      drops: group.reduce((sum, edge) => sum + edge.drops, 0),
      appVotes: {},
      appClass: primary.appClass,
      appDecoded: group.some((edge) => edge.appDecoded),
    };
    for (const edge of group) {
      consumed.add(edge.id);
      for (const [cls, votes] of Object.entries(edge.appVotes) as Array<[ProtocolClass, number]>) {
        merged.appVotes[cls] = (merged.appVotes[cls] ?? 0) + votes;
      }
      merged.verdict = worstVerdict(merged.verdict, edge.verdict);
    }
    merged.appClass = dominantAppClass(merged.appVotes);
    keep.set(merged.id, merged);
  }

  for (const edge of edgeMap.values()) {
    if (!consumed.has(edge.id)) {
      keep.set(edge.id, edge);
    }
  }
  return keep;
}

function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pullX?: number,
  pullY?: number,
): string {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  const dy = Math.max(24, Math.abs(y2 - y1) * 0.35);
  let cx1 = x1 + (x2 >= x1 ? dx : -dx);
  let cy1 = y1 + (y2 >= y1 ? dy * 0.2 : -dy * 0.2);
  let cx2 = x2 - (x2 >= x1 ? dx : -dx);
  let cy2 = y2 - (y2 >= y1 ? dy * 0.2 : -dy * 0.2);
  if (pullX !== undefined && pullY !== undefined) {
    cx1 = (cx1 + pullX) / 2;
    cy1 = (cy1 + pullY) / 2;
    cx2 = (cx2 + pullX) / 2;
    cy2 = (cy2 + pullY) / 2;
  }
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
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

function materializeEdges(
  edgeMap: Map<string, EdgeAgg>,
  nodeById: Map<string, GraphNodeLayout>,
  nsCenters: Map<string, { x: number; y: number }>,
): GraphEdgeLayout[] {
  const edges: GraphEdgeLayout[] = [];
  for (const agg of edgeMap.values()) {
    const fromNode = nodeById.get(agg.from);
    const toNode = nodeById.get(agg.to);
    if (!fromNode || !toNode) {
      continue;
    }
    const start = borderPoint(fromNode, toNode);
    const end = borderPoint(toNode, fromNode);
    const pull = nsCenters.get(toNode.namespace);
    const path = bezierPath(start.x, start.y, end.x, end.y, pull?.x, pull?.y);
    const stats = computeLatencyStats(agg.latencies);
    const health = edgeHealth(agg.verdict, stats?.p95Ms, agg.retransmits, agg.drops);
    const requestsPerSec = Number((agg.flowCount / WINDOW_SECONDS).toFixed(1));
    const appLabel = protocolClassLabel(agg.appClass, agg.appDecoded);
    const latencyLabel =
      stats?.p95Ms !== undefined ? `p95 ${stats.p95Ms}ms` : agg.flowCount > 0 ? "live" : "idle";
    const bundleHint = agg.bundledCount > 1 ? ` · ${agg.bundledCount} routes` : "";

    edges.push({
      id: agg.id,
      from: agg.from,
      to: agg.to,
      routeName: `${fromNode.name} → ${toNode.name}`,
      protocol: agg.protocol,
      port: agg.port,
      ports: agg.ports,
      protocols: agg.protocols,
      appClass: agg.appClass,
      appClassLabel: appLabel,
      appDecoded: agg.appDecoded,
      flowCount: Math.max(agg.flowCount, agg.latencies.length),
      requestsPerSec,
      latencyP50Ms: stats?.p50Ms,
      latencyP95Ms: stats?.p95Ms,
      latencyP99Ms: stats?.p99Ms,
      avgLatencyMs: stats?.avgMs,
      latencySampleCount: stats?.sampleCount,
      histogram: buildLatencyHistogram(agg.latencies),
      trafficSeries: buildTrafficSeries(agg.timestamps),
      verdict: agg.verdict,
      source: agg.source,
      health,
      retransmits: agg.retransmits,
      drops: agg.drops,
      bundledCount: agg.bundledCount,
      path,
      labelX: (start.x + end.x) / 2,
      labelY: (start.y + end.y) / 2 - 10,
      label: `${appLabel} · ${latencyLabel}${bundleHint}`,
    });
  }
  return edges;
}

function collectServiceEdges(
  topology: NetworkTopology,
  flows: NetworkFlow[],
  ownership: Map<string, string>,
  services: Map<string, ServiceAgg>,
  options: { bundlePairs: boolean; bundleNamespaces: boolean },
): Map<string, EdgeAgg> {
  let edgeMap = new Map<string, EdgeAgg>();

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
    const fromName = services.get(from)?.name ?? flow.src.name;
    const toName = services.get(to)?.name ?? flow.dst.name;
    ingestFlowEdge(
      edgeMap,
      from,
      to,
      flow,
      fromName,
      toName,
      `${flow.protocol}:${flow.port}`,
    );
  }

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
    const appClass = resolveProtocolClass({ port: edge.port, protocol: edge.protocol });
    edgeMap.set(id, {
      id,
      from,
      to,
      protocol: edge.protocol,
      port: edge.port,
      ports: [edge.port],
      protocols: [edge.protocol],
      appClass,
      appDecoded: false,
      appVotes: { [appClass]: 1 },
      flowCount: edge.flowCount,
      latencies: [],
      timestamps: [],
      source: "topology",
      verdict: edge.verdict,
      label: edge.label,
      retransmits: 0,
      drops: 0,
      bundledCount: 1,
    });
  }

  if (options.bundlePairs) {
    edgeMap = bundlePairEdges(edgeMap);
  }

  if (options.bundleNamespaces) {
    const nodeNamespace = new Map<string, string>();
    for (const service of services.values()) {
      nodeNamespace.set(service.id, service.namespace);
    }
    edgeMap = bundleNamespaceFanIn(edgeMap, nodeNamespace);
  }

  return edgeMap;
}

function layoutServiceLanes(
  services: Map<string, ServiceAgg>,
  edgeMap: Map<string, EdgeAgg>,
  options: { compact: boolean; expandPods: boolean },
): { namespaces: NamespaceBox[]; nodes: GraphNodeLayout[]; width: number; height: number; nsCenters: Map<string, { x: number; y: number }> } {
  const nodeW = options.compact ? 160 : SERVICE_W;
  const nodeH = options.compact ? 64 : SERVICE_H;
  const nodeMetrics = new Map<string, { flowCount: number; latencies: number[] }>();
  for (const agg of edgeMap.values()) {
    for (const id of [agg.from, agg.to]) {
      const metrics = nodeMetrics.get(id) ?? { flowCount: 0, latencies: [] };
      metrics.flowCount += agg.flowCount;
      metrics.latencies.push(...agg.latencies);
      nodeMetrics.set(id, metrics);
    }
  }

  const byNamespace = new Map<string, ServiceAgg[]>();
  for (const service of services.values()) {
    const list = byNamespace.get(service.namespace) ?? [];
    list.push(service);
    byNamespace.set(service.namespace, list);
  }
  for (const list of byNamespace.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const namespaceNames = [...byNamespace.keys()].sort((a, b) => a.localeCompare(b));
  const namespaces: NamespaceBox[] = [];
  const nodes: GraphNodeLayout[] = [];
  const nsCenters = new Map<string, { x: number; y: number }>();
  let cursorY = VIEW_PAD;
  let contentWidth = VIEW_PAD * 2 + nodeW;

  for (const ns of namespaceNames) {
    const list = byNamespace.get(ns) ?? [];
    const cols = Math.max(
      1,
      Math.min(list.length, Math.floor((LANE_MAX_WIDTH - NS_PAD * 2) / (nodeW + NODE_GAP_X))),
    );
    let innerHeight = 0;
    const positions: Array<{ service: ServiceAgg; x: number; y: number }> = [];

    list.forEach((service, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = NS_PAD + col * (nodeW + NODE_GAP_X);
      let y = NS_HEADER + NS_PAD + row * (nodeH + NODE_GAP_Y);
      const podExtra =
        options.expandPods && service.memberPods.length > 0
          ? service.memberPods.length * (POD_H + 8) + 12
          : 0;
      // Stagger pod expansion vertically within cell
      if (options.expandPods) {
        y = NS_HEADER + NS_PAD + row * (nodeH + NODE_GAP_Y + Math.min(podExtra, 120));
      }
      positions.push({ service, x, y });
      innerHeight = Math.max(innerHeight, y - NS_HEADER + nodeH + podExtra);
    });

    const innerWidth = cols * nodeW + Math.max(0, cols - 1) * NODE_GAP_X;
    const boxWidth = Math.max(innerWidth + NS_PAD * 2, 280);
    const boxHeight = NS_PAD + innerHeight + NS_PAD;
    const boxX = VIEW_PAD;
    const boxY = cursorY;

    namespaces.push({ name: ns, x: boxX, y: boxY, width: boxWidth, height: boxHeight });
    nsCenters.set(ns, { x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });
    contentWidth = Math.max(contentWidth, boxX + boxWidth + VIEW_PAD);

    for (const item of positions) {
      const metrics = nodeMetrics.get(item.service.id);
      const stats = computeLatencyStats(metrics?.latencies ?? []);
      const serviceNode: GraphNodeLayout = {
        id: item.service.id,
        kind: item.service.kind === "Workload" ? "Workload" : "Service",
        name: item.service.name,
        namespace: item.service.namespace,
        status: item.service.status,
        x: boxX + item.x,
        y: boxY + item.y,
        width: nodeW,
        height: nodeH,
        podCount: Math.max(item.service.memberPods.length, 1),
        memberPods: item.service.memberPods,
        flowCount: metrics?.flowCount ?? 0,
        requestsPerSec: Number(((metrics?.flowCount ?? 0) / WINDOW_SECONDS).toFixed(1)),
        latencyP95Ms: stats?.p95Ms,
      };
      nodes.push(serviceNode);

      if (options.expandPods) {
        item.service.memberPods.forEach((pod, podIndex) => {
          nodes.push({
            id: pod.id,
            kind: "Pod",
            name: truncateNodeName(pod.name, 28),
            namespace: item.service.namespace,
            status: pod.status,
            x: boxX + item.x + 16,
            y: boxY + item.y + nodeH + 10 + podIndex * (POD_H + 8),
            width: POD_W,
            height: POD_H,
            podCount: 1,
            memberPods: [pod],
            flowCount: 0,
            requestsPerSec: 0,
          });
        });
      }
    }

    cursorY += boxHeight + NS_GAP;
  }

  return {
    namespaces,
    nodes,
    width: contentWidth,
    height: Math.max(cursorY - NS_GAP + VIEW_PAD, VIEW_PAD * 2 + nodeH),
    nsCenters,
  };
}

function buildClusterLayout(
  services: Map<string, ServiceAgg>,
  edgeMap: Map<string, EdgeAgg>,
): GraphLayout {
  const nsStats = new Map<
    string,
    { services: number; pods: number; flowCount: number; latencies: number[]; status: GraphNodeLayout["status"] }
  >();
  for (const service of services.values()) {
    const stats = nsStats.get(service.namespace) ?? {
      services: 0,
      pods: 0,
      flowCount: 0,
      latencies: [],
      status: "healthy" as const,
    };
    stats.services += 1;
    stats.pods += service.memberPods.length;
    stats.status = worstStatus(stats.status, service.status);
    nsStats.set(service.namespace, stats);
  }

  const rolled = new Map<string, EdgeAgg>();
  for (const edge of edgeMap.values()) {
    const fromNs = services.get(edge.from)?.namespace;
    const toNs = services.get(edge.to)?.namespace;
    if (!fromNs || !toNs || fromNs === toNs) {
      if (fromNs) {
        const stats = nsStats.get(fromNs);
        if (stats) {
          stats.flowCount += edge.flowCount;
          stats.latencies.push(...edge.latencies);
        }
      }
      continue;
    }
    const id = `Namespace/${fromNs}->Namespace/${toNs}`;
    const existing = rolled.get(id);
    if (existing) {
      existing.flowCount += edge.flowCount;
      existing.latencies.push(...edge.latencies);
      existing.timestamps.push(...edge.timestamps);
      existing.retransmits += edge.retransmits;
      existing.drops += edge.drops;
      existing.bundledCount += edge.bundledCount;
      existing.verdict = worstVerdict(existing.verdict, edge.verdict);
      for (const [cls, votes] of Object.entries(edge.appVotes) as Array<[ProtocolClass, number]>) {
        existing.appVotes[cls] = (existing.appVotes[cls] ?? 0) + votes;
      }
      existing.appClass = dominantAppClass(existing.appVotes);
      continue;
    }
    rolled.set(id, {
      ...edge,
      id,
      from: `Namespace/${fromNs}/${fromNs}`,
      to: `Namespace/${toNs}/${toNs}`,
      label: `${fromNs} → ${toNs}`,
      appVotes: { ...edge.appVotes },
    });
  }

  const names = [...nsStats.keys()].sort((a, b) => a.localeCompare(b));
  const cols = Math.max(1, Math.min(names.length, 4));
  const nodes: GraphNodeLayout[] = [];
  const namespaces: NamespaceBox[] = [];
  const nsCenters = new Map<string, { x: number; y: number }>();

  names.forEach((ns, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = VIEW_PAD + col * (NS_NODE_W + 48);
    const y = VIEW_PAD + row * (NS_NODE_H + 56);
    const stats = nsStats.get(ns)!;
    const latency = computeLatencyStats(stats.latencies);
    const id = `Namespace/${ns}/${ns}`;
    nodes.push({
      id,
      kind: "Namespace",
      name: ns,
      namespace: ns,
      status: stats.status,
      x,
      y,
      width: NS_NODE_W,
      height: NS_NODE_H,
      podCount: stats.pods,
      memberPods: [],
      flowCount: stats.flowCount,
      requestsPerSec: Number((stats.flowCount / WINDOW_SECONDS).toFixed(1)),
      latencyP95Ms: latency?.p95Ms,
    });
    nsCenters.set(ns, { x: x + NS_NODE_W / 2, y: y + NS_NODE_H / 2 });
  });

  const width =
    VIEW_PAD * 2 + cols * NS_NODE_W + Math.max(0, cols - 1) * 48;
  const rows = Math.max(1, Math.ceil(names.length / cols));
  const height = VIEW_PAD * 2 + rows * NS_NODE_H + Math.max(0, rows - 1) * 56;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return {
    width,
    height,
    mode: "services",
    lod: "cluster",
    namespaces,
    nodes,
    edges: materializeEdges(rolled, nodeById, nsCenters),
  };
}

function collectFlowEdges(
  flows: NetworkFlow[],
  ownership: Map<string, string>,
  services: Map<string, ServiceAgg>,
): { nodes: Map<string, GraphNodeLayout>; edgeMap: Map<string, EdgeAgg> } {
  const nodes = new Map<string, GraphNodeLayout>();
  const edgeMap = new Map<string, EdgeAgg>();

  const ensure = (endpoint: NetworkEndpoint) => {
    const id = endpointNodeId(endpoint);
    if (!id) {
      return null;
    }
    if (!nodes.has(id)) {
      const owner = ownership.get(id);
      const service = owner ? services.get(owner) : undefined;
      nodes.set(id, {
        id,
        kind: endpoint.kind === "Service" ? "Service" : "Pod",
        name: endpoint.name,
        namespace: endpoint.namespace ?? "default",
        status: service?.status ?? "unknown",
        x: 0,
        y: 0,
        width: POD_W,
        height: POD_H,
        podCount: 1,
        memberPods:
          endpoint.kind === "Pod"
            ? [{ id, name: endpoint.name, status: "unknown" }]
            : [],
        flowCount: 0,
        requestsPerSec: 0,
      });
    }
    return id;
  };

  for (const flow of flows) {
    const from = ensure(flow.src);
    const to = ensure(flow.dst);
    if (!from || !to || from === to) {
      continue;
    }
    ingestFlowEdge(
      edgeMap,
      from,
      to,
      flow,
      flow.src.name,
      flow.dst.name,
      `${flow.protocol}:${flow.port}`,
    );
  }

  return { nodes, edgeMap };
}

function layoutFlowNodes(
  nodeMap: Map<string, GraphNodeLayout>,
): { namespaces: NamespaceBox[]; nodes: GraphNodeLayout[]; width: number; height: number; nsCenters: Map<string, { x: number; y: number }> } {
  const byNamespace = new Map<string, GraphNodeLayout[]>();
  for (const node of nodeMap.values()) {
    const list = byNamespace.get(node.namespace) ?? [];
    list.push(node);
    byNamespace.set(node.namespace, list);
  }
  for (const list of byNamespace.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const namespaceNames = [...byNamespace.keys()].sort((a, b) => a.localeCompare(b));
  const namespaces: NamespaceBox[] = [];
  const nodes: GraphNodeLayout[] = [];
  const nsCenters = new Map<string, { x: number; y: number }>();
  let cursorY = VIEW_PAD;
  let contentWidth = VIEW_PAD * 2 + POD_W;

  for (const ns of namespaceNames) {
    const list = byNamespace.get(ns) ?? [];
    const cols = Math.max(
      1,
      Math.min(list.length, Math.floor((LANE_MAX_WIDTH - NS_PAD * 2) / (POD_W + NODE_GAP_X))),
    );
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const innerWidth = cols * POD_W + Math.max(0, cols - 1) * NODE_GAP_X;
    const innerHeight = rows * POD_H + Math.max(0, rows - 1) * NODE_GAP_Y;
    const boxWidth = Math.max(innerWidth + NS_PAD * 2, 280);
    const boxHeight = NS_HEADER + NS_PAD + innerHeight + NS_PAD;
    const boxX = VIEW_PAD;
    const boxY = cursorY;
    namespaces.push({ name: ns, x: boxX, y: boxY, width: boxWidth, height: boxHeight });
    nsCenters.set(ns, { x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });
    contentWidth = Math.max(contentWidth, boxX + boxWidth + VIEW_PAD);

    list.forEach((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      nodes.push({
        ...node,
        x: boxX + NS_PAD + col * (POD_W + NODE_GAP_X),
        y: boxY + NS_HEADER + NS_PAD + row * (POD_H + NODE_GAP_Y),
        width: POD_W,
        height: POD_H,
      });
    });
    cursorY += boxHeight + NS_GAP;
  }

  return {
    namespaces,
    nodes,
    width: contentWidth,
    height: Math.max(cursorY - NS_GAP + VIEW_PAD, VIEW_PAD * 2 + POD_H),
    nsCenters,
  };
}

export function buildInvestigationLayout(
  topology: NetworkTopology,
  flows: NetworkFlow[],
  lod: GraphLod = "service",
): GraphLayout {
  const ownership = buildPodOwnership(topology);
  const services = buildServiceAggregates(topology, ownership);

  if (lod === "flow") {
    const { nodes: nodeMap, edgeMap } = collectFlowEdges(flows, ownership, services);
    const laid = layoutFlowNodes(nodeMap);
    const nodeById = new Map(laid.nodes.map((node) => [node.id, node]));
    return {
      width: laid.width,
      height: laid.height,
      mode: "services",
      lod,
      namespaces: laid.namespaces,
      nodes: laid.nodes,
      edges: materializeEdges(edgeMap, nodeById, laid.nsCenters),
    };
  }

  const edgeMap = collectServiceEdges(topology, flows, ownership, services, {
    bundlePairs: lod !== "pod",
    bundleNamespaces: lod === "namespace" || lod === "service",
  });

  if (lod === "cluster") {
    return buildClusterLayout(services, edgeMap);
  }

  const laid = layoutServiceLanes(services, edgeMap, {
    compact: lod === "namespace",
    expandPods: lod === "pod",
  });
  const nodeById = new Map(laid.nodes.map((node) => [node.id, node]));

  // At pod LOD, also wire pod-level edges when flow endpoints resolve to pods.
  let edges = edgeMap;
  if (lod === "pod") {
    const { edgeMap: flowEdges } = collectFlowEdges(flows, ownership, services);
    edges = new Map([...edgeMap, ...flowEdges]);
  }

  return {
    width: laid.width,
    height: laid.height,
    mode: "services",
    lod,
    namespaces: laid.namespaces,
    nodes: laid.nodes,
    edges: materializeEdges(edges, nodeById, laid.nsCenters),
  };
}
