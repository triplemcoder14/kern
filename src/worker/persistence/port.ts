import type { SavedConnectionConfig } from "../../core/types/monitor-rpc";
import type { Incident, MonitorEvent } from "../../core/types/monitoring";
import type { NetworkSnapshot } from "../../core/types/network";

export interface MonitorPersistence {
  saveConnectionConfig(config: SavedConnectionConfig): Promise<void>;
  loadConnectionConfig(): Promise<SavedConnectionConfig | null>;
  clearConnectionConfig(): Promise<void>;
  saveMonitorEvent(event: MonitorEvent): Promise<void>;
  loadRecentEvents(limit?: number): Promise<MonitorEvent[]>;
  saveIncident(incident: Incident): Promise<void>;
  loadOpenIncidents(): Promise<Incident[]>;
  resolveIncidentInDb(incidentId: string): Promise<void>;
  saveNetworkSnapshot?(snapshot: NetworkSnapshot): Promise<void>;
  recentSnapshots?(limit?: number): Promise<unknown>;
}
