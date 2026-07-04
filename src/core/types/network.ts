export type FlowVerdict = "OK" | "DROPPED" | "TIMEOUT" | "RETRY" | "UNKNOWN";
export type FlowSource = "ebpf" | "kubernetes" | "inferred";

export interface NetworkEndpoint {
  kind: "Pod" | "Service" | "External" | "Node";
  name: string;
  namespace?: string;
  ip?: string;
}

export interface NetworkFlow {
  id: string;
  timestamp: string;
  source: FlowSource;
  src: NetworkEndpoint;
  dst: NetworkEndpoint;
  protocol: "TCP" | "UDP" | "ICMP" | "UNKNOWN";
  port: number;
  verdict: FlowVerdict;
  latencyMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
}

export interface NetworkNode {
  id: string;
  kind: "Pod" | "Service";
  name: string;
  namespace: string;
  ip: string;
  status: "healthy" | "degraded" | "unknown";
  ports: number[];
}

export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  protocol: string;
  port: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  latencyAvgMs?: number;
  latencySampleCount?: number;
  verdict: FlowVerdict;
  flowCount: number;
}

export interface NetworkTopology {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  updatedAt: string;
}

export interface NetworkSnapshot {
  topology: NetworkTopology;
  flows: NetworkFlow[];
  ebpf: EbpfCollectorStatus;
}

export interface EbpfCollectorStatus {
  connected: boolean;
  collectorUrl: string;
  mode?: string;
  programsAttached?: number;
  flowsPerSecond?: number;
  podsIndexed?: number;
  message?: string;
}

export interface EbpfFlowPayload {
  timestamp: string;
  src_ip: string;
  dst_ip: string;
  src_pod?: string;
  dst_pod?: string;
  src_namespace?: string;
  dst_namespace?: string;
  protocol: string;
  port: number;
  latency_ms?: number;
  verdict?: string;
  bytes_sent?: number;
  bytes_received?: number;
}
