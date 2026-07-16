import type { NetworkSnapshot } from "../src/core/types/network";
import { retentionPolicy } from "./retention";
import type { ObjectStore } from "./object-store";
import type { SnapshotQuery, StoredNetworkSnapshot } from "./types";

const SNAPSHOT_PREFIX = "network-snapshots/";
const LEGACY_SNAPSHOT_FILE = "network-snapshots.jsonl";

export class SnapshotStore {
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: StoredNetworkSnapshot[] = [];
  private loaded = false;

  constructor(private readonly store: ObjectStore) {}

  private maxSnapshots(): number {
    return retentionPolicy().maxSnapshots;
  }

  private maxSnapshotFlows(): number {
    return retentionPolicy().maxSnapshotFlows;
  }

  private snapshotKey(savedAt: string): string {
    return `${SNAPSHOT_PREFIX}${savedAt.replace(/[:.]/g, "-")}.json`;
  }

  private async loadLegacyJsonl(): Promise<StoredNetworkSnapshot[]> {
    const raw = await this.store.readText(LEGACY_SNAPSHOT_FILE);
    if (!raw) {
      return [];
    }
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredNetworkSnapshot)
      .slice(0, this.maxSnapshots());
  }

  private async pruneDisk(keptKeys: Set<string>): Promise<void> {
    const keys = await this.store.listKeys(SNAPSHOT_PREFIX);
    const sorted = keys.sort((a, b) => b.localeCompare(a));
    const stale = sorted.slice(this.maxSnapshots()).filter((key) => !keptKeys.has(key));

    await Promise.all(stale.map((key) => this.store.deleteKey(key)));

    if (sorted.length > 0) {
      await this.store.deleteKey(LEGACY_SNAPSHOT_FILE);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const keys = await this.store.listKeys(SNAPSHOT_PREFIX);
    if (keys.length === 0) {
      this.cache = await this.loadLegacyJsonl();
      this.loaded = true;
      return;
    }

    const sorted = keys.sort((a, b) => b.localeCompare(a)).slice(0, this.maxSnapshots());
    const rows = await Promise.all(
      sorted.map(async (key) => {
        const raw = await this.store.readText(key);
        if (!raw) {
          return null;
        }
        return JSON.parse(raw) as StoredNetworkSnapshot;
      }),
    );

    this.cache = rows.filter((row): row is StoredNetworkSnapshot => row !== null);
    this.loaded = true;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  save(snapshot: NetworkSnapshot): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record: StoredNetworkSnapshot = {
        savedAt: new Date().toISOString(),
        flowCount: snapshot.flows.length,
        edgeCount: snapshot.topology.edges.length,
        nodeCount: snapshot.topology.nodes.length,
        snapshot: {
          ...snapshot,
          flows: snapshot.flows.slice(0, this.maxSnapshotFlows()),
        },
      };

      this.cache.unshift(record);
      this.cache = this.cache.slice(0, this.maxSnapshots());

      const keptKeys = new Set(this.cache.map((row) => this.snapshotKey(row.savedAt)));
      await this.store.writeText(this.snapshotKey(record.savedAt), JSON.stringify(record));
      await this.pruneDisk(keptKeys);
    });
  }

  async recent(query: SnapshotQuery = {}): Promise<StoredNetworkSnapshot[]> {
    await this.ensureLoaded();
    const limit = query.limit ?? 30;
    let rows = this.cache;
    if (query.since) {
      const sinceMs = new Date(query.since).getTime();
      rows = rows.filter((row) => new Date(row.savedAt).getTime() >= sinceMs);
    }
    return rows.slice(0, limit);
  }

  async latest(): Promise<StoredNetworkSnapshot | null> {
    const rows = await this.recent({ limit: 1 });
    return rows[0] ?? null;
  }

  async previous(): Promise<StoredNetworkSnapshot | null> {
    const rows = await this.recent({ limit: 2 });
    return rows[1] ?? null;
  }
}
