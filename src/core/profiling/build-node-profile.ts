import type { MonitorEvent } from "../types/monitoring";
import type { NetworkFlow, NetworkSnapshot } from "../types/network";
import type {
  AgentProfilePayload,
  NodeHealth,
  NodeProfileDetail,
  NodeProfileSummary,
  ProfileLogLine,
  ProfileSnapshot,
  ProfileStackFrame,
} from "../types/profiling";

interface K8sNodeRow {
  name: string;
  zone?: string;
  cpuCores?: number;
  ready: boolean;
}

interface PodOnNode {
  namespace: string;
  name: string;
  nodeName: string;
}

function normalizeHealth(value?: string): NodeHealth {
  if (value === "ok" || value === "warn" || value === "bad") {
    return value;
  }
  return "unknown";
}

function percentile(values: number[], pct: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function flowEndpointKey(flow: NetworkFlow, side: "src" | "dst"): string {
  const endpoint = side === "src" ? flow.src : flow.dst;
  return `${endpoint.namespace ?? "default"}/${endpoint.name}`;
}

function flowsForNode(flows: NetworkFlow[], podsOnNode: Set<string>): NetworkFlow[] {
  if (podsOnNode.size === 0) {
    return flows;
  }
  return flows.filter((flow) => {
    const srcKey = flowEndpointKey(flow, "src");
    const dstKey = flowEndpointKey(flow, "dst");
    return podsOnNode.has(srcKey) || podsOnNode.has(dstKey);
  });
}

function podsOnNodeMap(pods: PodOnNode[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const pod of pods) {
    if (!pod.nodeName) {
      continue;
    }
    const set = map.get(pod.nodeName) ?? new Set<string>();
    set.add(`${pod.namespace}/${pod.name}`);
    map.set(pod.nodeName, set);
  }
  return map;
}

function networkMetrics(flows: NetworkFlow[], agentNetwork?: AgentProfilePayload["network"]): {
  p50?: number;
  p95?: number;
  drops: number;
  flowsPerSecond: number;
} {
  const latencies = flows
    .map((flow) => flow.latencyMs)
    .filter((value): value is number => value !== undefined);
  const drops = flows.filter((flow) => flow.verdict === "DROPPED" || flow.verdict === "TIMEOUT").length;

  return {
    p50: agentNetwork?.p50_ms ?? percentile(latencies, 50),
    p95: agentNetwork?.p95_ms ?? percentile(latencies, 95),
    drops: agentNetwork?.drops ?? drops,
    flowsPerSecond: agentNetwork?.flows_per_second ?? Math.max(flows.length, 0),
  };
}

function deriveHealth(
  metrics: ReturnType<typeof networkMetrics>,
  cpuPercent?: number,
  ready = true,
): NodeHealth {
  if (!ready) {
    return "bad";
  }
  if ((metrics.drops ?? 0) > 0 || (metrics.p95 ?? 0) >= 150) {
    return "warn";
  }
  if ((cpuPercent ?? 0) >= 85) {
    return "warn";
  }
  if ((metrics.p95 ?? 0) === 0 && metrics.flowsPerSecond === 0) {
    return "unknown";
  }
  return "ok";
}

function formatMs(value?: number): string {
  if (value === undefined) {
    return "—";
  }
  return `${Math.round(value)}ms`;
}

function buildSparkline(values: number[]): number[] {
  if (values.length === 0) {
    return [12, 12, 12, 12, 12, 12];
  }
  const recent = values.slice(0, 6).reverse();
  while (recent.length < 6) {
    recent.unshift(recent[0] ?? 12);
  }
  const max = Math.max(...recent, 1);
  return recent.map((value) => Math.max(4, Math.round(20 - (value / max) * 14)));
}

function buildStack(flows: NetworkFlow[], agentStack?: ProfileStackFrame[]): ProfileStackFrame[] {
  if (agentStack && agentStack.length > 0) {
    return agentStack;
  }

  const buckets = new Map<string, { latency: number; count: number }>();
  for (const flow of flows) {
    const label =
      flow.path?.split("→").pop()?.trim() ??
      `${flow.dst.kind}/${flow.dst.name}:${flow.port}`;
    const current = buckets.get(label) ?? { latency: 0, count: 0 };
    current.count += 1;
    current.latency = Math.max(current.latency, flow.latencyMs ?? 0);
    buckets.set(label, current);
  }

  const items = [...buckets.entries()]
    .sort((a, b) => b[1].latency - a[1].latency)
    .slice(0, 5);
  const maxLatency = Math.max(...items.map(([, value]) => value.latency), 1);

  const stack: ProfileStackFrame[] = [
    { label: "network stack", depth: 0, width: 1, offset: 0, heat: 0.15 },
  ];

  let offset = 0;
  for (const [index, [label, value]] of items.entries()) {
    const width = 0.35 + (value.latency / maxLatency) * 0.55;
    stack.push({
      label,
      depth: 1 + (index % 2),
      width,
      offset,
      heat: Math.min(1, value.latency / maxLatency + (value.count > 3 ? 0.1 : 0)),
    });
    offset += width * 0.55;
  }

  return stack;
}

function buildLog(flows: NetworkFlow[], events: MonitorEvent[], agentLog?: ProfileLogLine[]): ProfileLogLine[] {
  if (agentLog && agentLog.length > 0) {
    return agentLog.slice(0, 8);
  }

  const lines: ProfileLogLine[] = [];
  for (const flow of flows) {
    if (lines.length >= 5) {
      break;
    }
    if (flow.verdict === "OK" && (flow.latencyMs ?? 0) < 80) {
      continue;
    }
    lines.push({
      time: new Date(flow.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      severity: flow.verdict === "DROPPED" ? "CRIT" : "WARN",
      event: flow.path ?? `${flow.dst.name}:${flow.port}`,
      value: flow.latencyMs !== undefined ? `${flow.latencyMs}ms` : flow.verdict.toLowerCase(),
      tone: flow.verdict === "DROPPED" ? "bad" : "warn",
    });
  }

  for (const event of events) {
    if (lines.length >= 8) {
      break;
    }
    if (event.category !== "network" && event.category !== "service") {
      continue;
    }
    lines.push({
      time: new Date(event.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      severity: event.severity === "critical" ? "CRIT" : event.severity === "warning" ? "WARN" : "INFO",
      event: event.title,
      value: event.message.split("·").pop()?.trim() ?? event.severity,
      tone: event.severity === "critical" ? "bad" : event.severity === "warning" ? "warn" : "ok",
    });
  }

  return lines;
}

function buildDetail(
  node: K8sNodeRow,
  flows: NetworkFlow[],
  events: MonitorEvent[],
  agent?: AgentProfilePayload,
  agentLive = false,
): NodeProfileDetail {
  const metrics = networkMetrics(flows, agent?.network);
  const health = agent?.health
    ? normalizeHealth(agent.health)
    : deriveHealth(metrics, agent?.cpu_percent, node.ready);
  const latencies = flows
    .map((flow) => flow.latencyMs)
    .filter((value): value is number => value !== undefined);

  return {
    name: node.name,
    zone: agent?.zone ?? node.zone,
    cpuCores: agent?.cpu_cores ?? node.cpuCores,
    health,
    agentLive,
    cpuPercent: agent?.cpu_percent,
    memoryUsedMb: agent?.memory_used_mb,
    memoryTotalMb: agent?.memory_total_mb,
    sampleSeconds: 3,
    metrics: [
      {
        label: "P50",
        value: formatMs(metrics.p50),
        tone: (metrics.p50 ?? 0) >= 80 ? "warn" : "ok",
        sparkline: buildSparkline(latencies.map((value) => value)),
      },
      {
        label: "P95",
        value: formatMs(metrics.p95),
        tone: (metrics.p95 ?? 0) >= 150 ? "warn" : (metrics.p95 ?? 0) >= 80 ? "warn" : "ok",
        sparkline: buildSparkline(latencies.map((value) => value * 1.2)),
      },
      {
        label: "Drops",
        value: String(metrics.drops),
        tone: metrics.drops > 0 ? "bad" : "ok",
        sparkline: buildSparkline([metrics.drops, metrics.drops, metrics.drops, metrics.drops, metrics.drops, metrics.drops]),
      },
      {
        label: "Flows/s",
        value: metrics.flowsPerSecond >= 1000 ? `${(metrics.flowsPerSecond / 1000).toFixed(1)}k` : String(metrics.flowsPerSecond),
        tone: "neutral",
        sparkline: buildSparkline([
          metrics.flowsPerSecond,
          metrics.flowsPerSecond,
          metrics.flowsPerSecond,
          metrics.flowsPerSecond,
          metrics.flowsPerSecond,
          metrics.flowsPerSecond,
        ]),
      },
    ],
    stack: buildStack(flows, agent?.network?.stack),
    log: buildLog(flows, events, agent?.network?.log),
  };
}

export function buildProfileSnapshot(input: {
  nodes: K8sNodeRow[];
  pods: PodOnNode[];
  network: NetworkSnapshot;
  events: MonitorEvent[];
  agentProfile?: AgentProfilePayload | null;
  selectedNode?: string;
}): ProfileSnapshot {
  const podMap = podsOnNodeMap(input.pods);
  const agentNode = input.agentProfile?.node_name;
  const agentLive = Boolean(input.agentProfile?.sampled_at);

  const summaries: NodeProfileSummary[] = input.nodes.map((node) => {
    const nodeFlows = flowsForNode(input.network.flows, podMap.get(node.name) ?? new Set());
    const agentSlice =
      agentLive && agentNode === node.name ? input.agentProfile ?? undefined : undefined;
    const metrics = networkMetrics(nodeFlows, agentSlice?.network);
    const health = agentSlice?.health
      ? normalizeHealth(agentSlice.health)
      : deriveHealth(metrics, agentSlice?.cpu_percent, node.ready);

    return {
      name: node.name,
      zone: agentSlice?.zone ?? node.zone,
      cpuCores: agentSlice?.cpu_cores ?? node.cpuCores,
      health,
      p95Ms: metrics.p95,
      drops: metrics.drops,
      agentLive: agentLive && agentNode === node.name,
    };
  });

  summaries.sort((a, b) => {
    const rank = (health: NodeHealth) => (health === "warn" || health === "bad" ? 0 : 1);
    if (rank(a.health) !== rank(b.health)) {
      return rank(a.health) - rank(b.health);
    }
    return (b.p95Ms ?? 0) - (a.p95Ms ?? 0);
  });

  const selectedName =
    input.selectedNode ??
    summaries.find((node) => node.agentLive)?.name ??
    summaries[0]?.name;
  const selectedRow = input.nodes.find((node) => node.name === selectedName);
  let selected: NodeProfileDetail | undefined;

  if (selectedRow) {
    const nodeFlows = flowsForNode(input.network.flows, podMap.get(selectedRow.name) ?? new Set());
    const agentSlice =
      agentLive && agentNode === selectedRow.name ? input.agentProfile ?? undefined : undefined;
    selected = buildDetail(
      selectedRow,
      nodeFlows,
      input.events,
      agentSlice,
      Boolean(agentSlice),
    );
  }

  return {
    nodes: summaries,
    selected,
    updatedAt: new Date().toISOString(),
  };
}
