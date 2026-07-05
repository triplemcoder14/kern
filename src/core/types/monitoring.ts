export type MonitorSeverity = "info" | "warning" | "critical";

export type MonitorCategory =
  | "network"
  | "workload"
  | "service"
  | "cost"
  | "incident"
  | "system";

import type { FlowVerdict } from "./network";

export type NetworkTalkKind = "started" | "degraded" | "ended";

export interface NetworkTalkMeta {
  kind: NetworkTalkKind;
  talkKey: string;
  path: string;
  protocol: string;
  port: number;
  verdict: FlowVerdict;
  latencyMs?: number;
  srcKind: string;
  srcName: string;
  srcNamespace?: string;
  dstKind: string;
  dstName: string;
  dstNamespace?: string;
}

export interface MonitorEvent {
  id: string;
  timestamp: string;
  severity: MonitorSeverity;
  category: MonitorCategory;
  title: string;
  message: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
  source: string;
  networkTalk?: NetworkTalkMeta;
}

export interface Incident {
  id: string;
  openedAt: string;
  updatedAt: string;
  severity: MonitorSeverity;
  category: MonitorCategory;
  title: string;
  summary: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
  status: "open" | "resolved";
  eventIds: string[];
  alertSource?: "kubernetes" | "flow";
  ruleId?: string;
  path?: string;
  cause?: string;
}

export type ClusterHealth = "healthy" | "degraded" | "critical" | "disconnected";

export interface ClusterConnectionConfig {
  name: string;
  serverUrl: string;
  proxyUrl: string;
  ebpfCollectorUrl?: string;
  origin?: string;
  token?: string;
}

export interface ClusterHealthSnapshot {
  health: ClusterHealth;
  connected: boolean;
  clusterName: string;
  podCount: number;
  runningPods: number;
  failedPods: number;
  serviceCount: number;
  openIncidents: number;
  eventsPerMinute: number;
}

export interface ConnectClusterInput {
  kubeconfig?: string;
  proxyUrl?: string;
  ebpfCollectorUrl?: string;
  origin?: string;
  token?: string;
  clusterName?: string;
}

export interface ConnectClusterResult {
  connected: boolean;
  clusterName: string;
  serverUrl: string;
  proxyUrl: string;
}
