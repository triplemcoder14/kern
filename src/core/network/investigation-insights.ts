import { inferProtocolClass, protocolClassLabel, type ProtocolClass } from "./protocol-class";
import type { FlowVerdict, NetworkFlow } from "../types/network";

const WINDOW_SECONDS = 15;

export interface DnsSummary {
  queriesPerSec: number;
  failureRate: number;
  timeouts: number;
  failures: number;
  p95LatencyMs?: number;
  topServers: Array<{ name: string; namespace?: string; count: number }>;
  topClients: Array<{ name: string; namespace?: string; count: number }>;
}

export interface DnsFlowRow {
  id: string;
  timestamp: string;
  source: string;
  sourceNamespace?: string;
  server: string;
  serverNamespace?: string;
  query: string;
  type: string;
  responseCode: string;
  latencyMs?: number;
  verdict: FlowVerdict;
  path?: string;
}

export interface ProtocolGroup {
  id: ProtocolClass;
  label: string;
  flowCount: number;
  requestsPerSec: number;
  p95LatencyMs?: number;
  errors: number;
  ports: number[];
}

export interface ProtocolFlowRow {
  id: string;
  timestamp: string;
  source: string;
  sourceNamespace?: string;
  destination: string;
  destinationNamespace?: string;
  protocol: string;
  port: number;
  appClass: ProtocolClass;
  latencyMs?: number;
  verdict: FlowVerdict;
  bytesSent?: number;
  bytesReceived?: number;
  path?: string;
}

export interface TcpHealthSummary {
  connections: number;
  drops: number;
  resets: number;
  retransmits: number;
  timeouts: number;
  retries: number;
  ok: number;
  p95LatencyMs?: number;
}

export interface TcpEventRow {
  id: string;
  timestamp: string;
  source: string;
  sourceNamespace?: string;
  destination: string;
  destinationNamespace?: string;
  nodeHint: string;
  reason: string;
  socketState: string;
  retransmits: number;
  bytes: number;
  latencyMs?: number;
  verdict: FlowVerdict;
  port: number;
  path?: string;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function isDnsFlow(flow: NetworkFlow): boolean {
  return flow.port === 53 || inferProtocolClass(flow.port, flow.protocol) === "dns";
}

function isFailed(verdict: FlowVerdict): boolean {
  return verdict === "DROPPED" || verdict === "TIMEOUT" || verdict === "RETRY";
}

function dnsResponseCode(verdict: FlowVerdict): string {
  switch (verdict) {
    case "OK":
      return "NOERROR*";
    case "TIMEOUT":
      return "TIMEOUT*";
    case "DROPPED":
      return "SERVFAIL*";
    case "RETRY":
      return "RETRY*";
    default:
      return "UNKNOWN*";
  }
}

function tcpReason(flow: NetworkFlow): string {
  if (flow.tcpEvent === "retransmit") {
    return "TCP retransmit";
  }
  if (flow.tcpEvent === "reset") {
    return "Connection reset";
  }
  if (flow.tcpEvent === "timeout") {
    return "Connect timeout";
  }
  if (flow.tcpEvent === "close") {
    return "Connection closed";
  }
  if (flow.tcpEvent === "established") {
    return "Established";
  }
  switch (flow.verdict) {
    case "DROPPED":
      return "Connection drop / denied";
    case "TIMEOUT":
      return "RTO / connect timeout";
    case "RETRY":
      return "Retransmit / retry";
    case "OK":
      return "Established";
    default:
      return "Unknown";
  }
}

function tcpSocketState(flow: NetworkFlow): string {
  if (flow.tcpState) {
    return flow.tcpState;
  }
  switch (flow.verdict) {
    case "OK":
      return "ESTABLISHED";
    case "TIMEOUT":
      return "SYN_SENT";
    case "RETRY":
      return "RETRANS";
    case "DROPPED":
      return "CLOSE";
    default:
      return "—";
  }
}

export function buildDnsSummary(flows: NetworkFlow[]): DnsSummary {
  const dns = flows.filter(isDnsFlow);
  const failures = dns.filter((flow) => isFailed(flow.verdict));
  const timeouts = dns.filter((flow) => flow.verdict === "TIMEOUT").length;
  const latencies = dns
    .map((flow) => flow.latencyMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);

  const servers = new Map<string, { name: string; namespace?: string; count: number }>();
  const clients = new Map<string, { name: string; namespace?: string; count: number }>();

  for (const flow of dns) {
    const serverKey = `${flow.dst.namespace ?? ""}/${flow.dst.name}`;
    const clientKey = `${flow.src.namespace ?? ""}/${flow.src.name}`;
    const server = servers.get(serverKey) ?? {
      name: flow.dst.name,
      namespace: flow.dst.namespace,
      count: 0,
    };
    server.count += 1;
    servers.set(serverKey, server);

    const client = clients.get(clientKey) ?? {
      name: flow.src.name,
      namespace: flow.src.namespace,
      count: 0,
    };
    client.count += 1;
    clients.set(clientKey, client);
  }

  return {
    queriesPerSec: Number((dns.length / WINDOW_SECONDS).toFixed(2)),
    failureRate: dns.length === 0 ? 0 : Number(((failures.length / dns.length) * 100).toFixed(1)),
    timeouts,
    failures: failures.length,
    p95LatencyMs: percentile(latencies, 95),
    topServers: [...servers.values()].sort((a, b) => b.count - a.count).slice(0, 6),
    topClients: [...clients.values()].sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

export function buildDnsRows(flows: NetworkFlow[]): DnsFlowRow[] {
  return flows
    .filter(isDnsFlow)
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((flow) => ({
      id: flow.id,
      timestamp: flow.timestamp,
      source: flow.src.name,
      sourceNamespace: flow.src.namespace,
      server: flow.dst.name,
      serverNamespace: flow.dst.namespace,
      query: flow.path?.includes("dns") ? flow.path : "— (decode pending)",
      type: "A/AAAA*",
      responseCode: dnsResponseCode(flow.verdict),
      latencyMs: flow.latencyMs,
      verdict: flow.verdict,
      path: flow.path,
    }));
}

const PROTOCOL_ORDER: ProtocolClass[] = [
  "http",
  "grpc",
  "dns",
  "postgres",
  "mysql",
  "redis",
  "kafka",
  "tcp",
  "udp",
  "other",
];

export function buildProtocolGroups(flows: NetworkFlow[]): ProtocolGroup[] {
  const groups = new Map<ProtocolClass, NetworkFlow[]>();
  for (const flow of flows) {
    const cls = inferProtocolClass(flow.port, flow.protocol);
    const bucket = groups.get(cls) ?? [];
    bucket.push(flow);
    groups.set(cls, bucket);
  }

  return PROTOCOL_ORDER.filter((id) => groups.has(id)).map((id) => {
    const bucket = groups.get(id) ?? [];
    const latencies = bucket
      .map((flow) => flow.latencyMs)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    const ports = [...new Set(bucket.map((flow) => flow.port))].sort((a, b) => a - b);
    return {
      id,
      label: protocolClassLabel(id),
      flowCount: bucket.length,
      requestsPerSec: Number((bucket.length / WINDOW_SECONDS).toFixed(2)),
      p95LatencyMs: percentile(latencies, 95),
      errors: bucket.filter((flow) => isFailed(flow.verdict)).length,
      ports,
    };
  });
}

export function buildProtocolRows(
  flows: NetworkFlow[],
  appClass: ProtocolClass | "all",
): ProtocolFlowRow[] {
  return flows
    .filter((flow) => appClass === "all" || inferProtocolClass(flow.port, flow.protocol) === appClass)
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((flow) => ({
      id: flow.id,
      timestamp: flow.timestamp,
      source: flow.src.name,
      sourceNamespace: flow.src.namespace,
      destination: flow.dst.name,
      destinationNamespace: flow.dst.namespace,
      protocol: flow.protocol,
      port: flow.port,
      appClass: inferProtocolClass(flow.port, flow.protocol),
      latencyMs: flow.latencyMs,
      verdict: flow.verdict,
      bytesSent: flow.bytesSent,
      bytesReceived: flow.bytesReceived,
      path: flow.path,
    }));
}

export function buildTcpHealthSummary(flows: NetworkFlow[]): TcpHealthSummary {
  const tcp = flows.filter((flow) => flow.protocol === "TCP");
  const latencies = tcp
    .map((flow) => flow.latencyMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);

  return {
    connections: tcp.length,
    drops: tcp.filter((flow) => flow.verdict === "DROPPED" || flow.tcpEvent === "reset").length,
    resets: tcp.filter((flow) => flow.tcpEvent === "reset").length,
    retransmits: tcp.reduce((sum, flow) => sum + (flow.retransmits ?? 0), 0),
    timeouts: tcp.filter((flow) => flow.verdict === "TIMEOUT" || flow.tcpEvent === "timeout").length,
    retries: tcp.filter((flow) => flow.tcpEvent === "retransmit" || (flow.retransmits ?? 0) > 0).length,
    ok: tcp.filter((flow) => flow.verdict === "OK").length,
    p95LatencyMs: percentile(latencies, 95),
  };
}

export function buildTcpEventRows(flows: NetworkFlow[], problemOnly = true): TcpEventRow[] {
  return flows
    .filter((flow) => flow.protocol === "TCP")
    .filter((flow) => (problemOnly ? isFailed(flow.verdict) || (flow.retransmits ?? 0) > 0 : true))
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((flow) => ({
      id: flow.id,
      timestamp: flow.timestamp,
      source: flow.src.name,
      sourceNamespace: flow.src.namespace,
      destination: flow.dst.name,
      destinationNamespace: flow.dst.namespace,
      nodeHint: flow.src.kind === "Pod" ? flow.src.namespace ?? "—" : flow.src.kind,
      reason: tcpReason(flow),
      socketState: tcpSocketState(flow),
      retransmits: flow.retransmits ?? 0,
      bytes: (flow.bytesSent ?? 0) + (flow.bytesReceived ?? 0),
      latencyMs: flow.latencyMs,
      verdict: flow.verdict,
      port: flow.port,
      path: flow.path,
    }));
}
