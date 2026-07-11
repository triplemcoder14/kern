import type { K8sNodeResourceMetrics, K8sNodeSummary } from "../k8s-api/client";
import type { MonitorEvent } from "../types/monitoring";
import type { NetworkFlow, NetworkSnapshot } from "../types/network";
import type {
  AgentProfilePayload,
  KernelHotspot,
  KernelMemory,
  MemoryDetail,
  NodeHealth,
  NodeProfileDetail,
  NodeProfileSummary,
  PodConsumer,
  ProcessSample,
  ProfileLogLine,
  ProfileMetric,
  ProfileSnapshot,
  ProfileStackFrame,
  PSILevel,
  PSISnapshot,
  TimelineEvent,
} from "../types/profiling";

export function deriveNodesFromPods(
  pods: Array<{ nodeName: string }>,
): K8sNodeSummary[] {
  const names = [...new Set(pods.map((pod) => pod.nodeName).filter(Boolean))].sort();
  return names.map((name) => ({
    name,
    internalIPs: [],
    ready: true,
  }));
}

function normalizePSILevel(value?: string): PSILevel {
  if (value === "warn" || value === "critical") {
    return value;
  }
  return "normal";
}

function mapPSI(agent?: AgentProfilePayload): PSISnapshot {
  return {
    cpuLevel: normalizePSILevel(agent?.psi?.cpu_level),
    memoryLevel: normalizePSILevel(agent?.psi?.memory_level),
    cpuAvg10: agent?.psi?.cpu_avg10,
    memoryAvg10: agent?.psi?.memory_avg10,
  };
}

function mapMemoryDetail(agent?: AgentProfilePayload): MemoryDetail {
  return {
    cacheMb: agent?.memory_detail?.cache_mb,
    slabMb: agent?.memory_detail?.slab_mb,
    buffersMb: agent?.memory_detail?.buffers_mb,
    swapUsedMb: agent?.memory_detail?.swap_used_mb,
    reclaimActivity: agent?.memory_detail?.reclaim_activity,
    majorFaultsPerMin: agent?.memory_detail?.major_faults_per_min,
    oomEvents: agent?.memory_detail?.oom_events,
  };
}

function mapKernelMemory(agent?: AgentProfilePayload): KernelMemory {
  return {
    slabGrowth: agent?.kernel_memory?.slab_growth,
    dentryCache: agent?.kernel_memory?.dentry_cache,
    tcpBuffers: agent?.kernel_memory?.tcp_buffers,
    pageReclaim: agent?.kernel_memory?.page_reclaim,
  };
}

function mapTopPods(agent?: AgentProfilePayload): PodConsumer[] {
  return (agent?.top_pods ?? []).map((pod) => ({
    namespace: pod.namespace,
    pod: pod.pod,
    cpuPercent: pod.cpu_percent,
    rssMb: pod.rss_mb,
    cacheMb: pod.cache_mb,
    pageFaultsPerMin: pod.page_faults_per_min,
  }));
}

function mapTopProcesses(agent?: AgentProfilePayload): ProcessSample[] {
  return (agent?.top_processes ?? []).map((proc) => ({
    pid: proc.pid,
    name: proc.name,
    namespace: proc.namespace,
    pod: proc.pod,
    cpuPercent: proc.cpu_percent,
    rssMb: proc.rss_mb,
  }));
}

function mapKernelHotspots(agent?: AgentProfilePayload): KernelHotspot[] {
  return (agent?.kernel_hotspots ?? []).map((hotspot) => ({
    function: hotspot.function,
    share: hotspot.share,
    meaning: hotspot.meaning,
  }));
}

function mapTimeline(agent?: AgentProfilePayload): TimelineEvent[] {
  return (agent?.timeline ?? []).map((event) => ({
    timestamp: event.timestamp,
    title: event.title,
    detail: event.detail,
    severity: event.severity === "crit" ? "crit" : event.severity === "warn" ? "warn" : "info",
  }));
}

function psiTone(level: PSILevel): "ok" | "warn" | "bad" {
  if (level === "critical") {
    return "bad";
  }
  if (level === "warn") {
    return "warn";
  }
  return "ok";
}

function formatPSI(level: PSILevel, avg10?: number): string {
  if (avg10 !== undefined) {
    return `${level} (${avg10.toFixed(1)})`;
  }
  return level;
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

function cpuPercentFromMetrics(node: K8sNodeSummary, metrics?: K8sNodeResourceMetrics): number | undefined {
  if (!metrics?.cpuUsageNano || !node.cpuCores || node.cpuCores <= 0) {
    return undefined;
  }
  return Math.min(100, (metrics.cpuUsageNano / (node.cpuCores * 1_000_000_000)) * 100);
}

function memoryFromMetrics(
  node: K8sNodeSummary,
  metrics?: K8sNodeResourceMetrics,
): { usedMb?: number; totalMb?: number } {
  const usedMb = metrics?.memoryUsedKi ? Math.round(metrics.memoryUsedKi / 1024) : undefined;
  const totalMb = node.memoryTotalMb;
  return { usedMb, totalMb };
}

function resolveAgentForNode(
  node: K8sNodeSummary,
  agentProfiles: Map<string, AgentProfilePayload>,
  nodeMetrics: Map<string, K8sNodeResourceMetrics>,
): { agent?: AgentProfilePayload; agentLive: boolean } {
  const agent = agentProfiles.get(node.name);
  if (agent?.sampled_at) {
    return { agent, agentLive: true };
  }

  const metrics = nodeMetrics.get(node.name);
  const cpuPercent = cpuPercentFromMetrics(node, metrics);
  const memory = memoryFromMetrics(node, metrics);
  if (cpuPercent === undefined && memory.usedMb === undefined) {
    return { agent: undefined, agentLive: false };
  }

  return {
    agent: {
      node_name: node.name,
      zone: node.zone,
      cpu_cores: node.cpuCores,
      cpu_percent: cpuPercent,
      memory_used_mb: memory.usedMb,
      memory_total_mb: memory.totalMb,
      health: deriveHealth({ p50: undefined, p95: undefined, drops: 0, flowsPerSecond: 0 }, cpuPercent, node.ready),
      sampled_at: new Date().toISOString(),
    },
    agentLive: false,
  };
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
  node: K8sNodeSummary,
  flows: NetworkFlow[],
  events: MonitorEvent[],
  agent?: AgentProfilePayload,
  agentLive = false,
): NodeProfileDetail {
  const metrics = networkMetrics(flows, agent?.network);
  const cpuPercent = agent?.cpu_percent;
  const health = agent?.health
    ? normalizeHealth(agent.health)
    : deriveHealth(metrics, cpuPercent, node.ready);

  const latencies = flows
    .map((flow) => flow.latencyMs)
    .filter((value): value is number => value !== undefined);

  const profileMetrics: ProfileMetric[] = [];

  if (cpuPercent !== undefined) {
    profileMetrics.push({
      label: "CPU",
      value: `${cpuPercent.toFixed(1)}%`,
      tone: cpuPercent >= 85 ? "warn" : "ok",
      sparkline: buildSparkline([cpuPercent, cpuPercent * 0.95, cpuPercent * 1.02, cpuPercent, cpuPercent * 0.98, cpuPercent]),
    });
  }

  if (agent?.memory_used_mb !== undefined && agent.memory_total_mb !== undefined) {
    const memoryPct = agent.memory_total_mb > 0
      ? (agent.memory_used_mb / agent.memory_total_mb) * 100
      : 0;
    profileMetrics.push({
      label: "Memory",
      value: `${Math.round(memoryPct)}%`,
      tone: memoryPct >= 90 ? "warn" : "ok",
      sparkline: buildSparkline([memoryPct, memoryPct * 0.98, memoryPct * 1.01, memoryPct, memoryPct, memoryPct]),
    });
  }

  const psi = mapPSI(agent);
  const memoryDetail = mapMemoryDetail(agent);
  const kernelMemory = mapKernelMemory(agent);
  const topPods = mapTopPods(agent);
  const topProcesses = mapTopProcesses(agent);
  const kernelHotspots = mapKernelHotspots(agent);
  const timeline = mapTimeline(agent);
  const cpuStack = agent?.cpu_stack && agent.cpu_stack.length > 0
    ? agent.cpu_stack
    : buildStack(flows, agent?.network?.stack);
  const stackSource = agent?.stack_source ?? "inferred";

  if (psi.cpuLevel !== "normal" || psi.memoryLevel !== "normal") {
    profileMetrics.push(
      {
        label: "PSI CPU",
        value: formatPSI(psi.cpuLevel, psi.cpuAvg10),
        tone: psiTone(psi.cpuLevel),
        sparkline: buildSparkline([psi.cpuAvg10 ?? 0, psi.cpuAvg10 ?? 0, psi.cpuAvg10 ?? 0, psi.cpuAvg10 ?? 0, psi.cpuAvg10 ?? 0, psi.cpuAvg10 ?? 0]),
      },
      {
        label: "PSI Mem",
        value: formatPSI(psi.memoryLevel, psi.memoryAvg10),
        tone: psiTone(psi.memoryLevel),
        sparkline: buildSparkline([psi.memoryAvg10 ?? 0, psi.memoryAvg10 ?? 0, psi.memoryAvg10 ?? 0, psi.memoryAvg10 ?? 0, psi.memoryAvg10 ?? 0, psi.memoryAvg10 ?? 0]),
      },
    );
  }

  if (memoryDetail.slabMb !== undefined) {
    profileMetrics.push({
      label: "Slab",
      value: `${memoryDetail.slabMb}MB`,
      tone: (memoryDetail.slabMb ?? 0) >= 1024 ? "warn" : "ok",
      sparkline: buildSparkline([memoryDetail.slabMb, memoryDetail.slabMb, memoryDetail.slabMb, memoryDetail.slabMb, memoryDetail.slabMb, memoryDetail.slabMb]),
    });
  }

  profileMetrics.push(
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
  );

  return {
    name: node.name,
    zone: agent?.zone ?? node.zone,
    cpuCores: agent?.cpu_cores ?? node.cpuCores,
    health,
    agentLive,
    cpuPercent,
    memoryUsedMb: agent?.memory_used_mb,
    memoryTotalMb: agent?.memory_total_mb ?? node.memoryTotalMb,
    load1: agent?.load_1,
    sampleSeconds: 3,
    metrics: profileMetrics,
    stack: buildStack(flows, agent?.network?.stack),
    cpuStack,
    stackSource,
    log: buildLog(flows, events, agent?.network?.log),
    psi,
    memoryDetail,
    kernelMemory,
    topPods,
    topProcesses,
    kernelHotspots,
    timeline,
  };
}

export function buildProfileSnapshot(input: {
  nodes: K8sNodeSummary[];
  pods: PodOnNode[];
  network: NetworkSnapshot;
  events: MonitorEvent[];
  agentProfiles?: Map<string, AgentProfilePayload>;
  nodeMetrics?: Map<string, K8sNodeResourceMetrics>;
  selectedNode?: string;
}): ProfileSnapshot {
  const podMap = podsOnNodeMap(input.pods);
  const agentProfiles = input.agentProfiles ?? new Map<string, AgentProfilePayload>();
  const nodeMetrics = input.nodeMetrics ?? new Map<string, K8sNodeResourceMetrics>();

  const summaries: NodeProfileSummary[] = input.nodes.map((node) => {
    const nodeFlows = flowsForNode(input.network.flows, podMap.get(node.name) ?? new Set());
    const { agent, agentLive } = resolveAgentForNode(node, agentProfiles, nodeMetrics);
    const metrics = networkMetrics(nodeFlows, agent?.network);
    const health = agent?.health
      ? normalizeHealth(agent.health)
      : deriveHealth(metrics, agent?.cpu_percent, node.ready);

    const psi = mapPSI(agent);

    return {
      name: node.name,
      zone: agent?.zone ?? node.zone,
      cpuCores: agent?.cpu_cores ?? node.cpuCores,
      health,
      p95Ms: metrics.p95,
      drops: metrics.drops,
      agentLive,
      cpuPercent: agent?.cpu_percent,
      memoryUsedMb: agent?.memory_used_mb,
      memoryTotalMb: agent?.memory_total_mb ?? node.memoryTotalMb,
      psiCpuLevel: psi.cpuLevel,
      psiMemoryLevel: psi.memoryLevel,
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
    const { agent, agentLive } = resolveAgentForNode(selectedRow, agentProfiles, nodeMetrics);
    selected = buildDetail(selectedRow, nodeFlows, input.events, agent, agentLive);
  }

  return {
    nodes: summaries,
    selected,
    updatedAt: new Date().toISOString(),
  };
}
