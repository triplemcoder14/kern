export type NodeHealth = "ok" | "warn" | "bad" | "unknown";

export interface NodeProfileSummary {
  name: string;
  zone?: string;
  cpuCores?: number;
  health: NodeHealth;
  p95Ms?: number;
  drops: number;
  agentLive: boolean;
}

export interface ProfileMetric {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  sparkline: number[];
}

export interface ProfileStackFrame {
  label: string;
  depth: number;
  width: number;
  offset: number;
  heat: number;
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
  sampleSeconds: number;
  metrics: ProfileMetric[];
  stack: ProfileStackFrame[];
  log: ProfileLogLine[];
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
  network?: {
    p50_ms?: number;
    p95_ms?: number;
    drops?: number;
    flows_per_second?: number;
    stack?: ProfileStackFrame[];
    log?: ProfileLogLine[];
  };
}
