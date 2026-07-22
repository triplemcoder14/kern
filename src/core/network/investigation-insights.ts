import { inferProtocolClass, protocolClassLabel, resolveProtocolClass, type ProtocolClass } from "./protocol-class";
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
  sourceIp?: string;
  server: string;
  serverNamespace?: string;
  query: string;
  type: string;
  responseCode: string;
  answers: string[];
  txid?: number;
  latencyMs?: number;
  verdict: FlowVerdict;
  path?: string;
  decoded: boolean;
  reason?: string;
  suggestion?: string;
  searchExpansion?: string[];
  searchExpanded?: boolean;
  resolutionPath?: string[];
  resolutionStatus?: "Succeeded" | "Failed" | "Unknown";
  analysisVerdict?: DnsAnalysisVerdict;
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
  httpMethod?: string;
  httpPath?: string;
  httpStatus?: number;
  grpcMethod?: string;
  grpcStatus?: number;
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
  return (
    Boolean(flow.dnsQuery || flow.dnsTxid || flow.dnsRcode) ||
    flow.port === 53 ||
    inferProtocolClass(flow.port, flow.protocol) === "dns"
  );
}

function isFailed(verdict: FlowVerdict): boolean {
  return verdict === "DROPPED" || verdict === "TIMEOUT" || verdict === "RETRY";
}

function dnsResponseCode(flow: NetworkFlow): string {
  if (flow.dnsRcode) {
    return flow.dnsRcode;
  }
  switch (flow.verdict) {
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

const CLUSTER_SEARCH = ".svc.cluster.local";
const CLUSTER_LOCAL = ".cluster.local";

/** Detect resolver search-path double-append and suggest the intended FQDN. */
export function dnsSearchExpansion(query: string): {
  expansion: string[];
  suggestion?: string;
} | null {
  const q = query.trim().toLowerCase().replace(/\.$/, "");
  if (!q) {
    return null;
  }
  const doubledSvc = `${CLUSTER_SEARCH}${CLUSTER_SEARCH}`;
  if (q.endsWith(doubledSvc)) {
    const once = q.slice(0, -CLUSTER_SEARCH.length);
    const base = once.endsWith(CLUSTER_SEARCH)
      ? once.slice(0, -CLUSTER_SEARCH.length)
      : once;
    return {
      expansion: [base || q, once, q],
      suggestion: once.includes(".") ? once : `${base}${CLUSTER_SEARCH}`,
    };
  }
  // ndots / search list can also append bare "cluster.local" onto an FQDN.
  const doubledCluster = `${CLUSTER_LOCAL}${CLUSTER_LOCAL}`;
  if (q.endsWith(doubledCluster) && q.includes(CLUSTER_SEARCH)) {
    const once = q.slice(0, -CLUSTER_LOCAL.length);
    return {
      expansion: [once.replace(CLUSTER_SEARCH, "") || once, once, q],
      suggestion: once,
    };
  }
  return null;
}

export type DnsAnalysisVerdict =
  | "Succeeded"
  | "Failed"
  | "Configuration issue"
  | "Transient failure"
  | "Expected";

export function dnsAnalysisVerdict(
  code: string,
  searchExpanded: boolean,
): DnsAnalysisVerdict {
  if (code === "NOERROR" || code.startsWith("NOERROR")) {
    return "Succeeded";
  }
  if (searchExpanded && code === "NXDOMAIN") {
    return "Configuration issue";
  }
  if (code === "NXDOMAIN") {
    return "Failed";
  }
  if (code === "TIMEOUT" || code.startsWith("TIMEOUT") || code === "SERVFAIL" || code.startsWith("SERVFAIL")) {
    return "Transient failure";
  }
  return "Failed";
}

export function dnsResolutionStatus(code: string): "Succeeded" | "Failed" | "Unknown" {
  if (code === "NOERROR" || code.startsWith("NOERROR")) {
    return "Succeeded";
  }
  if (!code || code === "—" || code === "UNKNOWN*") {
    return "Unknown";
  }
  return "Failed";
}

export function dnsFailureReason(code: string, query: string): {
  reason?: string;
  suggestion?: string;
  searchExpansion?: string[];
} {
  const search = dnsSearchExpansion(query);
  if (code === "NXDOMAIN") {
    if (search) {
      return {
        reason:
          "The resolver appended the cluster search domain onto a name that already ended in .svc.cluster.local, so the final hostname does not exist.",
        suggestion: search.suggestion
          ? `Did you mean ${search.suggestion}?`
          : undefined,
        searchExpansion: search.expansion,
      };
    }
    return {
      reason: "The requested hostname does not exist in DNS.",
      suggestion: query.includes(CLUSTER_SEARCH)
        ? undefined
        : `If this is a cluster service, try ${query.replace(/\.$/, "")}${CLUSTER_SEARCH}`,
    };
  }
  if (code === "SERVFAIL" || code.startsWith("SERVFAIL")) {
    return { reason: "The DNS server failed to answer (SERVFAIL)." };
  }
  if (code === "TIMEOUT" || code.startsWith("TIMEOUT")) {
    return { reason: "No DNS response was observed before the lookup timed out." };
  }
  return {};
}

export function dnsResolutionPath(row: {
  source: string;
  server: string;
  responseCode: string;
  answers: string[];
}): string[] {
  const steps = [row.source || "client", row.server || "DNS server"];
  if (row.responseCode && row.responseCode !== "—") {
    steps.push(row.responseCode);
  }
  if (row.answers.length > 0) {
    steps.push(row.answers[0]);
  }
  return steps;
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

function isDnsFailure(flow: NetworkFlow): boolean {
  if (isFailed(flow.verdict)) {
    return true;
  }
  const code = flow.dnsRcode;
  return code === "NXDOMAIN" || code === "SERVFAIL" || code === "REFUSED" || code === "FORMERR";
}

export function buildDnsSummary(flows: NetworkFlow[]): DnsSummary {
  const dns = flows.filter(isDnsFlow);
  const failures = dns.filter(isDnsFailure);
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
    .map((flow, index) => {
      const decoded = Boolean(flow.dnsQuery || flow.dnsRcode || flow.dnsTxid);
      const responseCode = dnsResponseCode(flow);
      const query = flow.dnsQuery || "—";
      const failure = dnsFailureReason(responseCode, query === "—" ? "" : query);
      const searchExpanded = Boolean(failure.searchExpansion?.length);
      const source = flow.src.name || flow.src.ip || "—";
      const server = flow.dst.name || flow.dst.ip || "—";
      return {
        id: `${flow.id}#${flow.timestamp}#${index}`,
        timestamp: flow.timestamp,
        source,
        sourceNamespace: flow.src.namespace,
        sourceIp: flow.src.ip,
        server,
        serverNamespace: flow.dst.namespace,
        query,
        type: flow.dnsType || (decoded ? "—" : "—"),
        responseCode,
        answers: flow.dnsAnswers ?? [],
        txid: flow.dnsTxid,
        latencyMs: flow.latencyMs,
        verdict: flow.verdict,
        path: flow.path,
        decoded,
        reason: failure.reason,
        suggestion: failure.suggestion,
        searchExpansion: failure.searchExpansion,
        searchExpanded,
        resolutionPath: dnsResolutionPath({
          source,
          server,
          responseCode,
          answers: flow.dnsAnswers ?? [],
        }),
        resolutionStatus: dnsResolutionStatus(responseCode),
        analysisVerdict: dnsAnalysisVerdict(responseCode, searchExpanded),
      };
    });
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
    const cls = resolveProtocolClass(flow);
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
    const decoded = bucket.some(
      (flow) =>
        Boolean(flow.httpMethod || flow.httpPath || flow.httpStatus !== undefined) ||
        Boolean(flow.grpcMethod || flow.grpcStatus !== undefined) ||
        Boolean(flow.dnsQuery),
    );
    return {
      id,
      label: protocolClassLabel(id, decoded),
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
    .filter((flow) => appClass === "all" || resolveProtocolClass(flow) === appClass)
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((flow, index) => ({
      id: `${flow.id}#${flow.timestamp}#${index}`,
      timestamp: flow.timestamp,
      source: flow.src.name,
      sourceNamespace: flow.src.namespace,
      destination: flow.dst.name,
      destinationNamespace: flow.dst.namespace,
      protocol: flow.protocol,
      port: flow.port,
      appClass: resolveProtocolClass(flow),
      latencyMs: flow.latencyMs,
      verdict: flow.verdict,
      bytesSent: flow.bytesSent,
      bytesReceived: flow.bytesReceived,
      path: flow.path,
      httpMethod: flow.httpMethod,
      httpPath: flow.httpPath,
      httpStatus: flow.httpStatus,
      grpcMethod: flow.grpcMethod,
      grpcStatus: flow.grpcStatus,
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
    .map((flow, index) => ({
      id: `${flow.id}#${flow.timestamp}#${index}`,
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
