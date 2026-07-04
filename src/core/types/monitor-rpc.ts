import type { NetworkSnapshot } from "../types/network";
import type {
  ClusterConnectionConfig,
  ClusterHealthSnapshot,
  ConnectClusterInput,
  ConnectClusterResult,
  Incident,
  MonitorEvent,
} from "../types/monitoring";

export type MonitorWorkerRequest =
  | { type: "SET_ORIGIN"; origin: string; ebpfCollectorUrl?: string }
  | { type: "CONNECT"; input: ConnectClusterInput }
  | { type: "DISCONNECT" }
  | { type: "GET_SNAPSHOT" }
  | { type: "SUBSCRIBE" }
  | { type: "RESOLVE_INCIDENT"; incidentId: string };

export type MonitorWorkerEvent =
  | { type: "CONNECTED"; result: ConnectClusterResult }
  | { type: "DISCONNECTED" }
  | { type: "MONITOR_EVENT"; event: MonitorEvent }
  | { type: "INCIDENT_UPSERTED"; incident: Incident }
  | { type: "INCIDENT_RESOLVED"; incidentId: string }
  | { type: "HEALTH_UPDATE"; snapshot: ClusterHealthSnapshot }
  | { type: "MONITOR_SNAPSHOT"; events: MonitorEvent[]; incidents: Incident[] }
  | { type: "NETWORK_SNAPSHOT"; snapshot: NetworkSnapshot }
  | { type: "NAMESPACES_UPDATE"; namespaces: string[] }
  | { type: "ERROR"; message: string };

export interface MonitorWorkerResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface MonitorWorkerMessage {
  id: string;
  request: MonitorWorkerRequest;
}

export interface MonitorWorkerResponseEnvelope {
  type: "response";
  response: MonitorWorkerResponse;
}

export interface MonitorWorkerEventEnvelope {
  type: "event";
  event: MonitorWorkerEvent;
}

export type MonitorWorkerToMain = MonitorWorkerEventEnvelope | MonitorWorkerResponseEnvelope;

export interface SavedConnectionConfig extends ClusterConnectionConfig {
  savedAt: string;
}
