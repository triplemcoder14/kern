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
const STORE_FLUSH_MS = 3_000;

export class MonitorPersistenceImpl implements MonitorPersistence {
  private readonly snapshots: SnapshotStore;
  private writeQueue: Promise<void> = Promise.resolve();
  private memoryStore: StoreShape | null = null;
  private storeDirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.memoryStore) {
      return this.memoryStore;
    }
    const raw = await this.store.readText(MONITOR_STORE_KEY);
    if (!raw) {
      this.memoryStore = { ...EMPTY_STORE };
      return this.memoryStore;
    }
    const parsed = { ...EMPTY_STORE, ...JSON.parse(raw) } as StoreShape;
    const normalized = this.normalizeStore(parsed);
    this.memoryStore = normalized;
    if (
      normalized.events.length !== parsed.events.length ||
      normalized.incidents.length !== parsed.incidents.length
    ) {
      this.storeDirty = true;
      this.scheduleFlush();
    }
    return this.memoryStore;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushStore();
    }, STORE_FLUSH_MS);
  }

  private async flushStore(): Promise<void> {
    if (!this.storeDirty || !this.memoryStore) {
      return;
    }
    await this.enqueue(async () => {
      if (!this.memoryStore || !this.storeDirty) {
        return;
      }
      const normalized = this.normalizeStore(this.memoryStore);
      this.memoryStore = normalized;
      await this.store.writeText(MONITOR_STORE_KEY, JSON.stringify(normalized, null, 2));
      this.storeDirty = false;
    });
  }

  private touchStore(mutator: (store: StoreShape) => void): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      mutator(store);
      this.storeDirty = true;
      this.scheduleFlush();
    });
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
    return this.touchStore((store) => {
      store.connection = config;
    }).then(() => this.flushStore());
  }

  loadConnectionConfig(): Promise<SavedConnectionConfig | null> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      return store.connection;
    });
  }

  clearConnectionConfig(): Promise<void> {
    return this.touchStore((store) => {
      store.connection = null;
    }).then(() => this.flushStore());
  }

  saveMonitorEvent(event: MonitorEvent): Promise<void> {
    return this.touchStore((store) => {
      const index = store.events.findIndex((item) => item.id === event.id);
      if (index >= 0) {
        store.events[index] = event;
      } else {
        store.events.unshift(event);
      }
      store.events = trimMonitorEvents(store.events);
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
    return this.touchStore((store) => {
      const index = store.incidents.findIndex((item) => item.id === incident.id);
      if (index >= 0) {
        store.incidents[index] = incident;
      } else {
        store.incidents.unshift(incident);
      }
    });
  }

  loadOpenIncidents(): Promise<Incident[]> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      return store.incidents.filter((incident) => incident.status === "open");
    });
  }

  resolveIncidentInDb(incidentId: string): Promise<void> {
    return this.touchStore((store) => {
      const incident = store.incidents.find((item) => item.id === incidentId);
      if (!incident) {
        return;
      }
      incident.status = "resolved";
      incident.updatedAt = new Date().toISOString();
    }).then(() => this.flushStore());
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
