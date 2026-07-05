import type { SavedConnectionConfig } from "../../../src/core/types/monitor-rpc";
import type { Incident, MonitorEvent } from "../../../src/core/types/monitoring";
import type { NetworkSnapshot } from "../../../src/core/types/network";
import type { MonitorPersistence } from "../../../src/worker/persistence/port";
import type { ObjectStore } from "../../../storage/object-store";
import { SnapshotStore } from "../../../storage/snapshot-store";
import { trimMonitorEvents, trimMonitorIncidents } from "../../../storage/retention";

interface StoreShape {
  connection: SavedConnectionConfig | null;
  events: MonitorEvent[];
  incidents: Incident[];
}

const EMPTY_STORE: StoreShape = {
  connection: null,
  events: [],
  incidents: [],
};

const MONITOR_STORE_KEY = "monitor-store.json";

export class MonitorPersistenceImpl implements MonitorPersistence {
  private readonly snapshots: SnapshotStore;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: ObjectStore) {
    this.snapshots = new SnapshotStore(store);
  }

  private normalizeStore(store: StoreShape): StoreShape {
    return {
      ...store,
      events: trimMonitorEvents(store.events),
      incidents: trimMonitorIncidents(store.incidents),
    };
  }

  private async readStore(): Promise<StoreShape> {
    const raw = await this.store.readText(MONITOR_STORE_KEY);
    if (!raw) {
      return { ...EMPTY_STORE };
    }
    const parsed = { ...EMPTY_STORE, ...JSON.parse(raw) } as StoreShape;
    const normalized = this.normalizeStore(parsed);
    if (
      normalized.events.length !== parsed.events.length ||
      normalized.incidents.length !== parsed.incidents.length
    ) {
      await this.store.writeText(MONITOR_STORE_KEY, JSON.stringify(normalized, null, 2));
    }
    return normalized;
  }

  private async writeStore(store: StoreShape): Promise<void> {
    const normalized = this.normalizeStore(store);
    await this.store.writeText(MONITOR_STORE_KEY, JSON.stringify(normalized, null, 2));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  saveConnectionConfig(config: SavedConnectionConfig): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      store.connection = config;
      await this.writeStore(store);
    });
  }

  loadConnectionConfig(): Promise<SavedConnectionConfig | null> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      return store.connection;
    });
  }

  clearConnectionConfig(): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      store.connection = null;
      await this.writeStore(store);
    });
  }

  saveMonitorEvent(event: MonitorEvent): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const index = store.events.findIndex((item) => item.id === event.id);
      if (index >= 0) {
        store.events[index] = event;
      } else {
        store.events.unshift(event);
      }
      store.events = trimMonitorEvents(store.events);
      await this.writeStore(store);
    });
  }

  loadRecentEvents(limit = 200): Promise<MonitorEvent[]> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      return store.events
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    });
  }

  saveIncident(incident: Incident): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const index = store.incidents.findIndex((item) => item.id === incident.id);
      if (index >= 0) {
        store.incidents[index] = incident;
      } else {
        store.incidents.unshift(incident);
      }
      await this.writeStore(store);
    });
  }

  loadOpenIncidents(): Promise<Incident[]> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      return store.incidents.filter((incident) => incident.status === "open");
    });
  }

  resolveIncidentInDb(incidentId: string): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const incident = store.incidents.find((item) => item.id === incidentId);
      if (!incident) {
        return;
      }
      incident.status = "resolved";
      incident.updatedAt = new Date().toISOString();
      await this.writeStore(store);
    });
  }

  saveNetworkSnapshot(snapshot: NetworkSnapshot): Promise<void> {
    return this.snapshots.save(snapshot);
  }

  recentSnapshots(limit = 30) {
    return this.snapshots.recent({ limit });
  }
}

/** @deprecated Use MonitorPersistenceImpl */
export class FilePersistence extends MonitorPersistenceImpl {}
