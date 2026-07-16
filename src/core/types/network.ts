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
  firstSeen?: string;
  lastSeen?: string;
  path?: string;
  source: FlowSource;
  src: NetworkEndpoint;
  dst: NetworkEndpoint;
  protocol: "TCP" | "UDP" | "ICMP" | "UNKNOWN";
  port: number;
  verdict: FlowVerdict;
  latencyMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
  retransmits?: number;
  tcpState?: string;
  tcpEvent?: string;
  dnsQuery?: string;
  dnsType?: string;
  dnsRcode?: string;
  dnsAnswers?: string[];
  dnsTxid?: number;
  httpMethod?: string;
  httpPath?: string;
  httpStatus?: number;
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
  servicesIndexed?: number;
  message?: string;
}

export interface EbpfFlowPayload {
  timestamp: string;
  first_seen?: string;
  last_seen?: string;
  path?: string;
  src_ip: string;
  dst_ip: string;
  src_pod?: string;
  dst_pod?: string;
  src_namespace?: string;
  dst_namespace?: string;
  src_service?: string;
  src_service_namespace?: string;
  dst_service?: string;
  dst_service_namespace?: string;
  protocol: string;
  port: number;
  latency_ms?: number;
  verdict?: string;
  bytes_sent?: number;
  bytes_received?: number;
  retransmits?: number;
  tcp_state?: string;
  tcp_event?: string;
  dns_query?: string;
  dns_type?: string;
  dns_rcode?: string;
  dns_answers?: string[];
  dns_txid?: number;
  http_method?: string;
  http_path?: string;
  http_status?: number;
}
