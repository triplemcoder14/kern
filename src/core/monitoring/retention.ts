import type { Incident, MonitorEvent } from "../types/monitoring";

/** In-memory + on-disk caps for the console monitor (tune via KERN_RETENTION_* env). */
export interface RetentionPolicy {
  /** Recent events kept in RAM and monitor-store.json */
  maxEvents: number;
  /** Open incidents always kept; resolved trimmed to fit budget */
  maxIncidents: number;
  /** Drop events older than this (ms); 0 = count-only retention */
  maxEventAgeMs: number;
  /** Network snapshot files on disk */
  maxSnapshots: number;
  /** Flows per live network snapshot in RAM */
  maxFlows: number;
  /** Flows persisted inside each stored network snapshot file */
  maxSnapshotFlows: number;
}

const HOUR_MS = 60 * 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadRetentionPolicy(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  return {
    maxEvents: parsePositiveInt(env.KERN_RETENTION_EVENTS_MAX, 300),
    maxIncidents: parsePositiveInt(env.KERN_RETENTION_INCIDENTS_MAX, 100),
    maxEventAgeMs: parsePositiveInt(env.KERN_RETENTION_EVENT_AGE_HOURS, 6) * HOUR_MS,
    maxSnapshots: parsePositiveInt(env.KERN_RETENTION_SNAPSHOTS_MAX, 60),
    maxFlows: parsePositiveInt(env.KERN_RETENTION_FLOWS_MAX, 200),
    maxSnapshotFlows: parsePositiveInt(env.KERN_RETENTION_SNAPSHOT_FLOWS_MAX, 80),
  };
}

/** Default policy for browser bundle (no process.env overrides). */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = loadRetentionPolicy({});

export const MAX_MONITOR_EVENTS = DEFAULT_RETENTION_POLICY.maxEvents;
export const MAX_MONITOR_INCIDENTS = DEFAULT_RETENTION_POLICY.maxIncidents;

let runtimePolicy: RetentionPolicy | null = null;

export function retentionPolicy(): RetentionPolicy {
  if (typeof process !== "undefined" && process.env) {
    if (!runtimePolicy) {
      runtimePolicy = loadRetentionPolicy();
    }
    return runtimePolicy;
  }
  return DEFAULT_RETENTION_POLICY;
}

function eventTimestampMs(event: MonitorEvent): number {
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function trimMonitorEvents(
  events: MonitorEvent[],
  policy: RetentionPolicy = retentionPolicy(),
): MonitorEvent[] {
  const now = Date.now();
  const sorted = [...events].sort((a, b) => eventTimestampMs(b) - eventTimestampMs(a));
  const withinAge =
    policy.maxEventAgeMs > 0
      ? sorted.filter((event) => now - eventTimestampMs(event) <= policy.maxEventAgeMs)
      : sorted;
  return withinAge.slice(0, policy.maxEvents);
}

export function trimMonitorIncidents(
  incidents: Incident[],
  policy: RetentionPolicy = retentionPolicy(),
): Incident[] {
  const open = incidents.filter((incident) => incident.status === "open");
  const resolved = incidents
    .filter((incident) => incident.status === "resolved")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const resolvedBudget = Math.max(0, policy.maxIncidents - open.length);
  return [...open, ...resolved.slice(0, resolvedBudget)];
}

export function trimIncidentMap(incidents: Map<string, Incident>): void {
  const trimmed = trimMonitorIncidents([...incidents.values()]);
  const keep = new Set(trimmed.map((incident) => incident.id));
  for (const id of incidents.keys()) {
    if (!keep.has(id)) {
      incidents.delete(id);
    }
  }
}
