import type { RetentionPolicy } from "../src/core/monitoring/retention";
import {
  DEFAULT_RETENTION_POLICY,
  retentionPolicy,
  setRuntimePolicy,
  trimMonitorEvents as trimEvents,
  trimMonitorIncidents as trimIncidents,
} from "../src/core/monitoring/retention";
import type { SavedRetentionSettings } from "../src/core/types/retention-settings";
import type { Incident, MonitorEvent } from "../src/core/types/monitoring";

export type { RetentionPolicy, SavedRetentionSettings };
export { retentionPolicy, setRuntimePolicy, DEFAULT_RETENTION_POLICY };

const HOUR_MS = 60 * 60 * 1000;

export function policyToSaved(policy: RetentionPolicy): SavedRetentionSettings {
  return {
    maxEventAgeHours: Math.round(policy.maxEventAgeMs / HOUR_MS),
    maxEvents: policy.maxEvents,
    maxIncidents: policy.maxIncidents,
    maxSnapshots: policy.maxSnapshots,
    maxFlows: policy.maxFlows,
    maxSnapshotFlows: policy.maxSnapshotFlows,
  };
}

export function savedToPolicy(
  saved: SavedRetentionSettings,
  base: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): RetentionPolicy {
  return {
    maxEvents: saved.maxEvents ?? base.maxEvents,
    maxIncidents: saved.maxIncidents ?? base.maxIncidents,
    maxEventAgeMs: Math.max(0, (saved.maxEventAgeHours ?? 0) * HOUR_MS),
    maxSnapshots: saved.maxSnapshots ?? base.maxSnapshots,
    maxFlows: saved.maxFlows ?? base.maxFlows,
    maxSnapshotFlows: saved.maxSnapshotFlows ?? base.maxSnapshotFlows,
  };
}

export function applySavedRetention(saved: SavedRetentionSettings | null): RetentionPolicy {
  if (!saved) {
    return setRuntimePolicy(DEFAULT_RETENTION_POLICY);
  }
  return setRuntimePolicy(savedToPolicy(saved));
}

export function trimMonitorEvents(events: MonitorEvent[]): MonitorEvent[] {
  return trimEvents(events, retentionPolicy());
}

export function trimMonitorIncidents(incidents: Incident[]): Incident[] {
  return trimIncidents(incidents, retentionPolicy());
}
