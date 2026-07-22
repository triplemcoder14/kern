import type { ProfileSnapshot } from "../core/types/profiling";
import {
  normalizeProfileSnapshot,
  peekProfileCache,
  putProfileCache,
  stickyMergeProfile,
} from "./profile-cache";

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

const inflight = new Map<string, Promise<ProfileSnapshot>>();

function cacheKey(nodeName?: string): string {
  return nodeName?.trim() || "__cluster__";
}

async function fetchProfileSnapshotNetwork(nodeName?: string): Promise<ProfileSnapshot> {
  const query = nodeName ? `?node=${encodeURIComponent(nodeName)}` : "";
  const response = await fetch(`${apiBase()}/api/monitor/profile${query}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load node profile (${response.status})`);
  }
  const snapshot = normalizeProfileSnapshot((await response.json()) as ProfileSnapshot);
  putProfileCache(nodeName, snapshot);
  return snapshot;
}

/** Always hits the network (joins in-flight). Updates the client cache. */
export function prefetchProfileSnapshot(nodeName?: string): Promise<ProfileSnapshot> {
  const key = cacheKey(nodeName);
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const pending = fetchProfileSnapshotNetwork(nodeName).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

/**
 * Prefer cache for an immediate return; always kick a background refresh.
 * Callers that need React state updates should still await prefetchProfileSnapshot
 * (or use useNodeProfile which does both paint + network).
 */
export async function fetchProfileSnapshot(nodeName?: string): Promise<ProfileSnapshot> {
  const cached = peekProfileCache(nodeName, { allowStale: true });
  if (cached) {
    void prefetchProfileSnapshot(nodeName).catch(() => undefined);
    return cached;
  }
  return prefetchProfileSnapshot(nodeName);
}

/** Warm every sidebar node so the next click is a cache hit. */
export function prefetchAllNodeProfiles(nodeNames: string[]): void {
  const unique = [...new Set(nodeNames.map((name) => name.trim()).filter(Boolean))];
  unique.forEach((name, index) => {
    window.setTimeout(() => {
      void prefetchProfileSnapshot(name).catch(() => undefined);
    }, index * 300);
  });
}

export function readCachedProfile(nodeName?: string): ProfileSnapshot | null {
  return peekProfileCache(nodeName, { allowStale: true });
}

export function mergeProfileSnapshots(
  next: ProfileSnapshot,
  previous: ProfileSnapshot | null | undefined,
): ProfileSnapshot {
  return stickyMergeProfile(next, previous);
}
