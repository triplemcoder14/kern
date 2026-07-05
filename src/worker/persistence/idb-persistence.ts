import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SavedConnectionConfig } from "../../core/types/monitor-rpc";
import type { Incident, MonitorEvent } from "../../core/types/monitoring";
import type { MonitorPersistence } from "./port";
import { trimMonitorIncidents } from "../../../storage/retention";

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

const DB_NAME = "kern-monitor";
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

async function pruneIncidentsInDb(db: IDBPDatabase<MonitorDB>): Promise<void> {
  const incidents = await db.getAll("incidents");
  const trimmed = trimMonitorIncidents(incidents);
  const keepIds = new Set(trimmed.map((incident) => incident.id));
  await Promise.all(
    incidents
      .filter((incident) => !keepIds.has(incident.id))
      .map((incident) => db.delete("incidents", incident.id)),
  );
}

export const idbPersistence: MonitorPersistence = {
  async saveConnectionConfig(config) {
    const db = await getDb();
    await db.put("connection", config, "active");
  },

  async loadConnectionConfig() {
    const db = await getDb();
    return (await db.get("connection", "active")) ?? null;
  },

  async clearConnectionConfig() {
    const db = await getDb();
    await db.delete("connection", "active");
  },

  async saveMonitorEvent(event) {
    const db = await getDb();
    await db.put("events", event, event.id);
  },

  async loadRecentEvents(limit = 200) {
    const db = await getDb();
    const events = await db.getAll("events");
    return events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  },

  async saveIncident(incident) {
    const db = await getDb();
    await db.put("incidents", incident, incident.id);
    await pruneIncidentsInDb(db);
  },

  async loadOpenIncidents() {
    const db = await getDb();
    const incidents = await db.getAll("incidents");
    return incidents.filter((incident) => incident.status === "open");
  },

  async resolveIncidentInDb(incidentId) {
    const db = await getDb();
    const incident = await db.get("incidents", incidentId);
    if (!incident) {
      return;
    }
    await db.put("incidents", { ...incident, status: "resolved", updatedAt: new Date().toISOString() });
    await pruneIncidentsInDb(db);
  },
};
