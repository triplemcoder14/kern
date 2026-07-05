import type { NetworkSnapshot } from "../src/core/types/network";

export interface StoredNetworkSnapshot {
  savedAt: string;
  flowCount: number;
  edgeCount: number;
  nodeCount: number;
  snapshot: NetworkSnapshot;
}

export interface SnapshotQuery {
  limit?: number;
  since?: string;
}
