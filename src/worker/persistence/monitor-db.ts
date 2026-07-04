import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SavedConnectionConfig } from "../../core/types/monitor-rpc";
import type { Incident, MonitorEvent } from "../../core/types/monitoring";

interface MonitorDB extends DBSchema {
  connection: {
    key: string;
    value: SavedConnectionConfig;
  };
  events: {
    key: string;
    value: MonitorEvent;
  };
  incidents: {
    key: string;
    value: Incident;
  };
}

const DB_NAME = "port-of-k8s-monitor";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MonitorDB>> | null = null;

function getDb(): Promise<IDBPDatabase<MonitorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MonitorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("connection")) {
          db.createObjectStore("connection");
        }
        if (!db.objectStoreNames.contains("events")) {
          db.createObjectStore("events");
        }
        if (!db.objectStoreNames.contains("incidents")) {
          db.createObjectStore("incidents");
        }
      },
    });
  }
  return dbPromise;
}

export async function saveConnectionConfig(config: SavedConnectionConfig): Promise<void> {
  const db = await getDb();
  await db.put("connection", config, "active");
}

export async function loadConnectionConfig(): Promise<SavedConnectionConfig | null> {
  const db = await getDb();
  return (await db.get("connection", "active")) ?? null;
}

export async function clearConnectionConfig(): Promise<void> {
  const db = await getDb();
  await db.delete("connection", "active");
}

export async function saveMonitorEvent(event: MonitorEvent): Promise<void> {
  const db = await getDb();
  await db.put("events", event, event.id);
}

export async function loadRecentEvents(limit = 200): Promise<MonitorEvent[]> {
  const db = await getDb();
  const events = await db.getAll("events");
  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export async function saveIncident(incident: Incident): Promise<void> {
  const db = await getDb();
  await db.put("incidents", incident, incident.id);
}

export async function loadOpenIncidents(): Promise<Incident[]> {
  const db = await getDb();
  const incidents = await db.getAll("incidents");
  return incidents.filter((incident) => incident.status === "open");
}

export async function resolveIncidentInDb(incidentId: string): Promise<void> {
  const db = await getDb();
  const incident = await db.get("incidents", incidentId);
  if (!incident) {
    return;
  }
  await db.put("incidents", { ...incident, status: "resolved", updatedAt: new Date().toISOString() });
}
