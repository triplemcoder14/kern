export type NodeHealth = "ok" | "warn" | "bad" | "unknown";

export type PSILevel = "normal" | "warn" | "critical";

export interface PSISnapshot {
  cpuLevel: PSILevel;
  memoryLevel: PSILevel;
  cpuAvg10?: number;
  memoryAvg10?: number;
}

export interface MemoryDetail {
  cacheMb?: number;
  slabMb?: number;
  buffersMb?: number;
  swapUsedMb?: number;
  reclaimActivity?: string;
  majorFaultsPerMin?: number;
  oomEvents?: number;
}

export interface KernelMemory {
  slabGrowth?: string;
  dentryCache?: string;
  tcpBuffers?: string;
  pageReclaim?: string;
}

export type MemoryRssSource = "cgroup" | "metrics" | "proc" | "unknown";

export interface PodConsumer {
  namespace: string;
  pod: string;
  cpuPercent?: number;
  /** Resident / current usage when known (cgroup or metrics). */
  rssMb?: number;
  /** Working set (usually metrics-server usage; reclaim-aware proxy). */
  workingSetMb?: number;
  anonymousMb?: number;
  cacheMb?: number;
  majorFaults?: number;
  minorFaults?: number;
  /** @deprecated Prefer majorFaults; kept for agent JSON compat. */
  pageFaultsPerMin?: number;
  memoryLimitMb?: number;
  /** Delta vs previous sample window (MB). */
  growthMb?: number;
  rssSource?: MemoryRssSource;
}

export interface ContainerConsumer {
  namespace: string;
  pod: string;
  container: string;
  workingSetMb?: number;
  rssMb?: number;
  memoryLimitMb?: number;
  growthMb?: number;
  rssSource?: MemoryRssSource;
}

export interface ProcessSample {
  pid: number;
  name: string;
  namespace?: string;
  pod?: string;
  cpuPercent?: number;
  rssMb?: number;
  growthMb?: number;
}

export interface KernelHotspot {
  function: string;
  share: number;
  meaning?: string;
  category?: string;
}

export interface TimelineEvent {
  timestamp: string;
  title: string;
  detail?: string;
  severity: "info" | "warn" | "crit";
}

export interface NodeProfileSummary {
  name: string;
  zone?: string;
  cpuCores?: number;
  health: NodeHealth;
  p95Ms?: number;
  drops: number;
  agentLive: boolean;
  cpuPercent?: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  psiCpuLevel?: PSILevel;
  psiMemoryLevel?: PSILevel;
}

export interface ProfileMetric {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  sparkline: number[];
}

export type ProfileStackSource = "proc" | "inferred" | "ebpf";

export type ProfileStackFrameKind =
  | "root"
  | "protocol"
  | "endpoint"
  | "workload"
  | "service"
  | "hop"
  | "cpu"
  | "user"
  | "app"
  | "runtime"
  | "library"
  | "kernel";

export interface ProfileStackFrame {
  id?: string;
  label: string;
  /** Secondary line: namespace, IP, offset, or port detail */
  subtitle?: string;
  depth: number;
  width: number;
  offset: number;
  heat: number;
  kind?: ProfileStackFrameKind;
  protocol?: string;
  port?: number;
  namespace?: string;
  endpointKind?: string;
  ip?: string;
  /** Mapped binary/object for CPU stack frames */
  binary?: string;
  bytes?: number;
  retransmits?: number;
  latencyMs?: number;
  /** Share of total contribution (0–100) */
  sharePct?: number;
  /** Sample count when available (CPU flame) */
  samples?: number;
  path?: string;
  flowCount?: number;
}

export interface ProfileLogLine {
  time: string;
  severity: string;
  event: string;
  value: string;
  tone: "ok" | "warn" | "bad";
}

export interface NodeProfileDetail {
  name: string;
  zone?: string;
  cpuCores?: number;
  health: NodeHealth;
  agentLive: boolean;
  cpuPercent?: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  load1?: number;
  sampleSeconds: number;
  metrics: ProfileMetric[];
  stack: ProfileStackFrame[];
  cpuStack: ProfileStackFrame[];
  stackSource?: ProfileStackSource;
  log: ProfileLogLine[];
  psi: PSISnapshot;
  memoryDetail: MemoryDetail;
  kernelMemory: KernelMemory;
  topPods: PodConsumer[];
  topContainers?: ContainerConsumer[];
  topProcesses: ProcessSample[];
  kernelHotspots: KernelHotspot[];
  timeline: TimelineEvent[];
}

export interface ProfileSnapshot {
  nodes: NodeProfileSummary[];
  selected?: NodeProfileDetail;
  updatedAt: string;
}

export interface AgentProfilePayload {
  node_name: string;
  hostname?: string;
  zone?: string;
  cpu_cores?: number;
  cpu_percent?: number;
  load_1?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
  health?: string;
  flows_per_second?: number;
  sampled_at?: string;
  psi?: {
    cpu_level?: PSILevel;
    memory_level?: PSILevel;
    cpu_avg10?: number;
    memory_avg10?: number;
  };
  memory_detail?: {
    cache_mb?: number;
    slab_mb?: number;
    buffers_mb?: number;
    swap_used_mb?: number;
    reclaim_activity?: string;
    major_faults_per_min?: number;
    oom_events?: number;
  };
  kernel_memory?: {
    slab_growth?: string;
    dentry_cache?: string;
    tcp_buffers?: string;
    page_reclaim?: string;
  };
  top_pods?: Array<{
    namespace: string;
    pod: string;
    cpu_percent?: number;
    rss_mb?: number;
    working_set_mb?: number;
    anonymous_mb?: number;
    cache_mb?: number;
    page_faults_per_min?: number;
    major_faults?: number;
    minor_faults?: number;
    memory_limit_mb?: number;
  }>;
  top_processes?: Array<{
    pid: number;
    name: string;
    namespace?: string;
    pod?: string;
    cpu_percent?: number;
    rss_mb?: number;
  }>;
  kernel_hotspots?: Array<{
    function: string;
    share: number;
    meaning?: string;
    category?: string;
  }>;
  cpu_stack?: ProfileStackFrame[];
  stack_source?: ProfileStackSource;
  timeline?: Array<{
    timestamp: string;
    title: string;
    detail?: string;
    severity: string;
  }>;
  network?: {
    p50_ms?: number;
    p95_ms?: number;
    drops?: number;
    flows_per_second?: number;
    stack?: ProfileStackFrame[];
    log?: ProfileLogLine[];
  };
}
