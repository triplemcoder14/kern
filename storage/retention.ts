import type { Incident, MonitorEvent } from "../src/core/types/monitoring";

export const MAX_MONITOR_EVENTS = 300;
export const MAX_MONITOR_INCIDENTS = 100;

export function trimMonitorEvents(events: MonitorEvent[]): MonitorEvent[] {
  return events.slice(0, MAX_MONITOR_EVENTS);
}

export function trimMonitorIncidents(incidents: Incident[]): Incident[] {
  const open = incidents.filter((incident) => incident.status === "open");
  const resolved = incidents
    .filter((incident) => incident.status === "resolved")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const resolvedBudget = Math.max(0, MAX_MONITOR_INCIDENTS - open.length);
  return [...open, ...resolved.slice(0, resolvedBudget)];
}
