export type MonitorSeverity = "info" | "warning" | "critical";

export type MonitorCategory =
  | "network"
  | "workload"
  | "service"
  | "cost"
  | "incident"
  | "system";

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
