import type {
  K8sNodeResourceMetrics,
  K8sNodeSummary,
  K8sPodMemoryStat,
  K8sPodMetricSummary,
} from "../k8s-api/client";
import type { MonitorEvent } from "../types/monitoring";
import type { NetworkFlow, NetworkSnapshot } from "../types/network";
import type {
  AgentProfilePayload,
  ContainerConsumer,
  KernelHotspot,
  KernelMemory,
  MemoryDetail,
  MemoryRssSource,
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
    workingSetMb: pod.working_set_mb,
    anonymousMb: pod.anonymous_mb,
    cacheMb: pod.cache_mb,
    majorFaults: pod.major_faults ?? pod.page_faults_per_min,
    minorFaults: pod.minor_faults,
    pageFaultsPerMin: pod.page_faults_per_min,
    memoryLimitMb: pod.memory_limit_mb,
    rssSource: pod.rss_mb !== undefined ? ("cgroup" as const) : undefined,
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

const previousRssByKey = new Map<string, number>();

function attachGrowth<T>(
  items: T[],
  keyOf: (item: T) => string,
  rssOf: (item: T) => number | undefined,
): Array<T & { growthMb?: number }> {
  return items.map((item) => {
    const key = keyOf(item);
    const rss = rssOf(item);
    const prev = previousRssByKey.get(key);
    const growthMb = prev !== undefined && rss !== undefined ? rss - prev : undefined;
    if (rss !== undefined) {
      previousRssByKey.set(key, rss);
    }
    return { ...item, growthMb };
  });
}

function kiToMb(ki?: number): number | undefined {
  if (ki === undefined) {
    return undefined;
  }
  return Math.max(0, Math.round(ki / 1024));
}

function enrichPodWithMetrics(
  pod: PodConsumer,
  metricsByKey: Map<string, K8sPodMetricSummary>,
  statsByKey: Map<string, K8sPodMemoryStat>,
  limitByKey: Map<string, number | undefined>,
): PodConsumer {
  const key = `${pod.namespace}/${pod.pod}`;
  const metric = metricsByKey.get(key);
  const stats = statsByKey.get(key);
  const metricsMb = kiToMb(metric?.memoryUsedKi);
  const limitMb = pod.memoryLimitMb ?? limitByKey.get(key);

  let rssMb = pod.rssMb ?? stats?.rssMb;
  let workingSetMb = pod.workingSetMb ?? stats?.workingSetMb ?? metricsMb;
  let rssSource: MemoryRssSource | undefined = pod.rssSource;

  if (rssMb === undefined && workingSetMb !== undefined) {
    rssMb = workingSetMb;
    rssSource = stats ? "metrics" : metricsMb !== undefined ? "metrics" : rssSource;
  } else if (rssMb === undefined && metricsMb !== undefined) {
    rssMb = metricsMb;
    rssSource = "metrics";
  } else if (rssMb !== undefined && !rssSource) {
    rssSource = "cgroup";
  } else if (rssMb === undefined) {
    rssSource = "unknown";
  }

  if (workingSetMb === undefined && metricsMb !== undefined) {
    workingSetMb = metricsMb;
  }
  if (workingSetMb === undefined && rssMb !== undefined) {
    workingSetMb = rssMb;
  }

  return {
    ...pod,
    rssMb,
    workingSetMb,
    memoryLimitMb: limitMb,
    rssSource,
  };
}

/** Prefer agent cgroup pods; fall back to attributed processes, then kubelet stats / metrics inventory. Never invent equal shares. */
function resolveMemoryConsumers(
  agentPods: PodConsumer[],
  processes: ProcessSample[],
  inventory: PodOnNode[],
  podMetrics: K8sPodMetricSummary[],
  podStats: K8sPodMemoryStat[],
  memoryUsedMb: number | undefined,
  nodeName: string,
): PodConsumer[] {
  const metricsByKey = new Map<string, K8sPodMetricSummary>(
    podMetrics.map((metric) => [`${metric.namespace}/${metric.name}`, metric]),
  );
  const statsByKey = new Map<string, K8sPodMemoryStat>(
    podStats.map((stat) => [`${stat.namespace}/${stat.name}`, stat]),
  );
  const limitByKey = new Map<string, number | undefined>(
    inventory.map((pod) => [`${pod.namespace}/${pod.name}`, pod.memoryLimitMb]),
  );

  const sortByRss = (items: PodConsumer[]) =>
    [...items].sort((a, b) => (b.workingSetMb ?? b.rssMb ?? 0) - (a.workingSetMb ?? a.rssMb ?? 0));

  const enrich = (pod: PodConsumer) => enrichPodWithMetrics(pod, metricsByKey, statsByKey, limitByKey);

  if (agentPods.length > 0) {
    return attachGrowth(
      sortByRss(agentPods.map(enrich)).slice(0, 16),
      (pod) => `pod:${pod.namespace}/${pod.pod}`,
      (pod) => pod.workingSetMb ?? pod.rssMb,
    );
  }

  const byPod = new Map<string, PodConsumer>();
  for (const proc of processes) {
    if (!proc.pod) {
      continue;
    }
    const key = `${proc.namespace ?? ""}/${proc.pod}`;
    const current = byPod.get(key) ?? {
      namespace: proc.namespace ?? "default",
      pod: proc.pod,
      rssMb: 0,
      cpuPercent: 0,
      rssSource: "proc" as const,
    };
    current.rssMb = (current.rssMb ?? 0) + (proc.rssMb ?? 0);
    current.cpuPercent = (current.cpuPercent ?? 0) + (proc.cpuPercent ?? 0);
    byPod.set(key, current);
  }
  if (byPod.size > 0) {
    return attachGrowth(
      sortByRss([...byPod.values()].map(enrich)).slice(0, 16),
      (pod) => `pod:${pod.namespace}/${pod.pod}`,
      (pod) => pod.workingSetMb ?? pod.rssMb,
    );
  }

  // Inventory + kubelet stats / metrics-server — real per-pod values, never nodeUsed/N.
  if (inventory.length > 0) {
    const fromInventory = inventory.map((pod) => {
      const key = `${pod.namespace}/${pod.name}`;
      const stats = statsByKey.get(key);
      const metric = metricsByKey.get(key);
      const metricsMb = kiToMb(metric?.memoryUsedKi);
      const rssMb = stats?.rssMb ?? metricsMb;
      const workingSetMb = stats?.workingSetMb ?? metricsMb ?? stats?.rssMb;
      return {
        namespace: pod.namespace,
        pod: pod.name,
        rssMb,
        workingSetMb,
        memoryLimitMb: pod.memoryLimitMb,
        rssSource: (rssMb !== undefined || workingSetMb !== undefined
          ? "metrics"
          : "unknown") as MemoryRssSource,
      };
    });
    return attachGrowth(
      sortByRss(fromInventory).slice(0, 16),
      (pod) => `pod:${pod.namespace}/${pod.pod}`,
      (pod) => pod.workingSetMb ?? pod.rssMb,
    );
  }

  const hostProcs = processes
    .filter((proc) => (proc.rssMb ?? 0) > 0)
    .sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0))
    .slice(0, 10)
    .map((proc) => ({
      namespace: "node",
      pod: proc.name,
      rssMb: proc.rssMb,
      workingSetMb: proc.rssMb,
      cpuPercent: proc.cpuPercent,
      rssSource: "proc" as const,
    }));
  if (hostProcs.length > 0) {
    return attachGrowth(
      hostProcs,
      (pod) => `proc:${pod.pod}`,
      (pod) => pod.rssMb,
    );
  }

  if (memoryUsedMb !== undefined && memoryUsedMb > 0) {
    return [
      {
        namespace: "node",
        pod: nodeName,
        rssMb: memoryUsedMb,
        workingSetMb: memoryUsedMb,
        rssSource: "unknown",
      },
    ];
  }

  return [];
}

function resolveContainerConsumers(
  inventory: PodOnNode[],
  podMetrics: K8sPodMetricSummary[],
  podStats: K8sPodMemoryStat[],
): ContainerConsumer[] {
  const limitByKey = new Map<string, number | undefined>(
    inventory.map((pod) => [`${pod.namespace}/${pod.name}`, pod.memoryLimitMb]),
  );
  const nodePodKeys = new Set<string>(inventory.map((pod) => `${pod.namespace}/${pod.name}`));
  const rows: ContainerConsumer[] = [];
  const seen = new Set<string>();

  for (const stat of podStats) {
    const key = `${stat.namespace}/${stat.name}`;
    if (nodePodKeys.size > 0 && !nodePodKeys.has(key)) {
      continue;
    }
    for (const container of stat.containers ?? []) {
      const id = `${key}/${container.name}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      rows.push({
        namespace: stat.namespace,
        pod: stat.name,
        container: container.name,
        rssMb: container.rssMb,
        workingSetMb: container.workingSetMb ?? container.rssMb,
        memoryLimitMb: limitByKey.get(key),
        rssSource: container.rssMb !== undefined || container.workingSetMb !== undefined ? "metrics" : "unknown",
      });
    }
  }

  for (const metric of podMetrics) {
    const key = `${metric.namespace}/${metric.name}`;
    if (nodePodKeys.size > 0 && !nodePodKeys.has(key)) {
      continue;
    }
    for (const container of metric.containers ?? []) {
      const id = `${key}/${container.name}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const mb = kiToMb(container.memoryUsedKi);
      rows.push({
        namespace: metric.namespace,
        pod: metric.name,
        container: container.name,
        rssMb: mb,
        workingSetMb: mb,
        memoryLimitMb: limitByKey.get(key),
        rssSource: mb !== undefined ? "metrics" : "unknown",
      });
    }
  }

  return attachGrowth(
    rows
      .sort((a, b) => (b.workingSetMb ?? b.rssMb ?? 0) - (a.workingSetMb ?? a.rssMb ?? 0))
      .slice(0, 24),
    (row) => `ctr:${row.namespace}/${row.pod}/${row.container}`,
    (row) => row.workingSetMb ?? row.rssMb,
  );
}

function withProcessGrowth(processes: ProcessSample[]): ProcessSample[] {
  return attachGrowth(
    processes,
    (proc) => `pid:${proc.pid}:${proc.name}`,
    (proc) => proc.rssMb,
  );
}

function mapKernelHotspots(agent?: AgentProfilePayload): KernelHotspot[] {
  return (agent?.kernel_hotspots ?? []).map((hotspot) => ({
    function: hotspot.function,
    share: hotspot.share,
    meaning: hotspot.meaning,
    category: hotspot.category,
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
  memoryLimitMb?: number;
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

function flowBytes(flow: NetworkFlow): number {
  return (flow.bytesSent ?? 0) + (flow.bytesReceived ?? 0);
}

function endpointLabel(endpoint: NetworkFlow["dst"] | NetworkFlow["src"]): {
  label: string;
  subtitle?: string;
  namespace?: string;
  endpointKind: string;
  ip?: string;
} {
  const namespace = endpoint.namespace;
  const kind = endpoint.kind;
  const isIpOnly = /^\d{1,3}(\.\d{1,3}){3}$/.test(endpoint.name) || Boolean(endpoint.ip && endpoint.name === endpoint.ip);

  if (kind === "Service" && namespace) {
    return {
      label: endpoint.name,
      subtitle: `Service · ${namespace}`,
      namespace,
      endpointKind: kind,
      ip: endpoint.ip,
    };
  }
  if (kind === "Pod" && namespace) {
    const short = endpoint.name.length > 40 ? `${endpoint.name.slice(0, 36)}…` : endpoint.name;
    return {
      label: short,
      subtitle: `Pod · ${namespace}`,
      namespace,
      endpointKind: kind,
      ip: endpoint.ip,
    };
  }
  if (kind === "External" || isIpOnly) {
    return {
      label: endpoint.name || endpoint.ip || "external",
      subtitle: endpoint.ip && endpoint.name !== endpoint.ip ? endpoint.ip : "External",
      endpointKind: "External",
      ip: endpoint.ip ?? endpoint.name,
    };
  }
  return {
    label: endpoint.name,
    subtitle: kind,
    namespace,
    endpointKind: kind,
    ip: endpoint.ip,
  };
}

function contribution(flow: NetworkFlow): number {
  const latency = flow.latencyMs ?? 0;
  const bytes = flowBytes(flow);
  const retransmits = flow.retransmits ?? 0;
  // Prefer bytes when present; otherwise weight latency so slow flows still surface.
  return Math.max(bytes, 1) + latency * 2_000 + retransmits * 50_000;
}

function enrichAgentStack(frames: ProfileStackFrame[]): ProfileStackFrame[] {
  return frames.map((frame, index) => ({
    ...frame,
    id: frame.id ?? `agent-${index}-${frame.depth}-${frame.label}`,
    kind: frame.kind ?? (frame.depth === 0 ? "root" : "hop"),
    sharePct: frame.sharePct ?? Math.round(frame.width * 100),
  }));
}

/**
 * Build an actionable network flame:
 * network stack → protocol → destination → source workload
 */
function buildStack(flows: NetworkFlow[], agentStack?: ProfileStackFrame[]): ProfileStackFrame[] {
  if (agentStack && agentStack.length > 0) {
    return enrichAgentStack(agentStack);
  }
  if (flows.length === 0) {
    return [
      {
        id: "root",
        label: "network stack",
        depth: 0,
        width: 1,
        offset: 0,
        heat: 0.15,
        kind: "root",
        sharePct: 100,
      },
    ];
  }

  type Agg = {
    key: string;
    label: string;
    subtitle?: string;
    namespace?: string;
    endpointKind?: string;
    ip?: string;
    protocol: string;
    port: number;
    bytes: number;
    retransmits: number;
    latencyMs: number;
    flowCount: number;
    score: number;
    path?: string;
    sources: Map<
      string,
      {
        label: string;
        subtitle?: string;
        namespace?: string;
        endpointKind?: string;
        ip?: string;
        bytes: number;
        retransmits: number;
        latencyMs: number;
        flowCount: number;
        score: number;
        path?: string;
      }
    >;
  };

  const byProtocol = new Map<string, Map<string, Agg>>();
  let totalScore = 0;

  for (const flow of flows) {
    const protocol = flow.protocol === "UNKNOWN" ? "TCP" : flow.protocol;
    const dst = endpointLabel(flow.dst);
    const dstKey = `${dst.endpointKind}:${dst.namespace ?? ""}:${flow.dst.name}:${flow.port}`;
    const score = contribution(flow);
    totalScore += score;

    let endpoints = byProtocol.get(protocol);
    if (!endpoints) {
      endpoints = new Map();
      byProtocol.set(protocol, endpoints);
    }

    let agg = endpoints.get(dstKey);
    if (!agg) {
      agg = {
        key: dstKey,
        label: dst.label,
        subtitle: [dst.subtitle, `${protocol}/${flow.port}`].filter(Boolean).join(" · "),
        namespace: dst.namespace,
        endpointKind: dst.endpointKind,
        ip: dst.ip,
        protocol,
        port: flow.port,
        bytes: 0,
        retransmits: 0,
        latencyMs: 0,
        flowCount: 0,
        score: 0,
        path: flow.path,
        sources: new Map(),
      };
      endpoints.set(dstKey, agg);
    }

    agg.bytes += flowBytes(flow);
    agg.retransmits += flow.retransmits ?? 0;
    agg.latencyMs = Math.max(agg.latencyMs, flow.latencyMs ?? 0);
    agg.flowCount += 1;
    agg.score += score;
    if (flow.path) {
      agg.path = flow.path;
    }

    const src = endpointLabel(flow.src);
    if (src.endpointKind === "Pod" || src.endpointKind === "Service") {
      const srcKey = `${src.endpointKind}:${src.namespace ?? ""}:${flow.src.name}`;
      const existing = agg.sources.get(srcKey) ?? {
        label: src.label,
        subtitle: src.subtitle,
        namespace: src.namespace,
        endpointKind: src.endpointKind,
        ip: src.ip,
        bytes: 0,
        retransmits: 0,
        latencyMs: 0,
        flowCount: 0,
        score: 0,
        path: flow.path,
      };
      existing.bytes += flowBytes(flow);
      existing.retransmits += flow.retransmits ?? 0;
      existing.latencyMs = Math.max(existing.latencyMs, flow.latencyMs ?? 0);
      existing.flowCount += 1;
      existing.score += score;
      if (flow.path) {
        existing.path = flow.path;
      }
      agg.sources.set(srcKey, existing);
    }
  }

  const safeTotal = Math.max(totalScore, 1);
  const protocolEntries = [...byProtocol.entries()]
    .map(([protocol, endpoints]) => {
      const score = [...endpoints.values()].reduce((sum, item) => sum + item.score, 0);
      return { protocol, endpoints: [...endpoints.values()], score };
    })
    .sort((a, b) => b.score - a.score);

  const maxLatency = Math.max(
    ...protocolEntries.flatMap((entry) => entry.endpoints.map((item) => item.latencyMs)),
    1,
  );

  const stack: ProfileStackFrame[] = [
    {
      id: "root",
      label: "network stack",
      subtitle: `${flows.length} flows`,
      depth: 0,
      width: 1,
      offset: 0,
      heat: 0.12,
      kind: "root",
      sharePct: 100,
      flowCount: flows.length,
      bytes: flows.reduce((sum, flow) => sum + flowBytes(flow), 0),
    },
  ];

  let protocolOffset = 0;
  for (const proto of protocolEntries.slice(0, 4)) {
    const protoWidth = Math.max(0.12, proto.score / safeTotal);
    const protoShare = Math.round((proto.score / safeTotal) * 100);
    stack.push({
      id: `proto-${proto.protocol}`,
      label: proto.protocol,
      subtitle: `${proto.endpoints.length} destinations · ${protoShare}%`,
      depth: 1,
      width: protoWidth,
      offset: protocolOffset,
      heat: 0.2 + Math.min(0.35, protoShare / 100),
      kind: "protocol",
      protocol: proto.protocol,
      sharePct: protoShare,
      flowCount: proto.endpoints.reduce((sum, item) => sum + item.flowCount, 0),
      bytes: proto.endpoints.reduce((sum, item) => sum + item.bytes, 0),
      retransmits: proto.endpoints.reduce((sum, item) => sum + item.retransmits, 0),
      latencyMs: Math.max(...proto.endpoints.map((item) => item.latencyMs), 0),
    });

    const topEndpoints = [...proto.endpoints].sort((a, b) => b.score - a.score).slice(0, 6);
    const endpointScore = Math.max(
      topEndpoints.reduce((sum, item) => sum + item.score, 0),
      1,
    );
    let endpointOffset = protocolOffset;

    for (const endpoint of topEndpoints) {
      const width = Math.max(0.08, (endpoint.score / endpointScore) * protoWidth);
      const sharePct = Math.round((endpoint.score / safeTotal) * 100);
      const heat = Math.min(
        1,
        endpoint.latencyMs / maxLatency + (endpoint.retransmits > 0 ? 0.2 : 0) + sharePct / 200,
      );
      const endpointId = `dst-${proto.protocol}-${endpoint.key}`;
      stack.push({
        id: endpointId,
        label: endpoint.label,
        subtitle: endpoint.subtitle,
        depth: 2,
        width,
        offset: endpointOffset,
        heat,
        kind: endpoint.endpointKind === "Service" ? "service" : "endpoint",
        protocol: endpoint.protocol,
        port: endpoint.port,
        namespace: endpoint.namespace,
        endpointKind: endpoint.endpointKind,
        ip: endpoint.ip,
        bytes: endpoint.bytes,
        retransmits: endpoint.retransmits,
        latencyMs: endpoint.latencyMs,
        sharePct,
        path: endpoint.path,
        flowCount: endpoint.flowCount,
      });

      const topSources = [...endpoint.sources.values()].sort((a, b) => b.score - a.score).slice(0, 3);
      const sourceScore = Math.max(
        topSources.reduce((sum, item) => sum + item.score, 0),
        1,
      );
      let sourceOffset = endpointOffset;
      for (const source of topSources) {
        const sourceWidth = Math.max(0.06, (source.score / sourceScore) * width);
        stack.push({
          id: `${endpointId}-src-${source.label}`,
          label: source.label,
          subtitle: source.subtitle,
          depth: 3,
          width: sourceWidth,
          offset: sourceOffset,
          heat: Math.min(1, heat * 0.85 + (source.latencyMs / maxLatency) * 0.2),
          kind: "workload",
          protocol: endpoint.protocol,
          port: endpoint.port,
          namespace: source.namespace,
          endpointKind: source.endpointKind,
          ip: source.ip,
          bytes: source.bytes,
          retransmits: source.retransmits,
          latencyMs: source.latencyMs,
          sharePct: Math.round((source.score / safeTotal) * 100),
          path: source.path ?? endpoint.path,
          flowCount: source.flowCount,
        });
        sourceOffset += sourceWidth * 0.92;
      }

      endpointOffset += width * 0.92;
    }

    protocolOffset += protoWidth * 0.95;
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
  inventoryPods: PodOnNode[] = [],
  podMetrics: K8sPodMetricSummary[] = [],
  podStats: K8sPodMemoryStat[] = [],
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
  const topProcesses = withProcessGrowth(mapTopProcesses(agent));
  const topPods = resolveMemoryConsumers(
    mapTopPods(agent),
    topProcesses,
    inventoryPods,
    podMetrics,
    podStats,
    agent?.memory_used_mb,
    node.name,
  );
  const topContainers = resolveContainerConsumers(inventoryPods, podMetrics, podStats);
  const kernelHotspots = mapKernelHotspots(agent);
  const timeline = mapTimeline(agent);
  const cpuStack = agent?.cpu_stack && agent.cpu_stack.length > 0
    ? agent.cpu_stack
    : [];
  const stackSource = agent?.stack_source ?? (cpuStack.length > 0 ? "inferred" : undefined);

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
    topContainers,
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
  podMetrics?: K8sPodMetricSummary[];
  podStats?: K8sPodMemoryStat[];
  selectedNode?: string;
}): ProfileSnapshot {
  const podMap = podsOnNodeMap(input.pods);
  const agentProfiles = input.agentProfiles ?? new Map<string, AgentProfilePayload>();
  const nodeMetrics = input.nodeMetrics ?? new Map<string, K8sNodeResourceMetrics>();
  const podMetrics = input.podMetrics ?? [];
  const podStats = input.podStats ?? [];  const summaries: NodeProfileSummary[] = input.nodes.map((node) => {
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
    const inventory = input.pods.filter((pod) => pod.nodeName === selectedRow.name);
    selected = buildDetail(
      selectedRow,
      nodeFlows,
      input.events,
      agent,
      agentLive,
      inventory,
      podMetrics,
      podStats,
    );
  }

  return {
    nodes: summaries,
    selected,
    updatedAt: new Date().toISOString(),
  };
}
