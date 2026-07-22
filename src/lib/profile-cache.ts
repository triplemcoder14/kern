import type {
  NodeProfileDetail,
  NodeProfileSummary,
  ProfileSnapshot,
} from "../core/types/profiling";

interface CacheEntry {
  snapshot: ProfileSnapshot;
  at: number;
}

/** Soft TTL — prefer cache; still return past this while revalidating. */
const FRESH_TTL_MS = 45_000;
const STALE_TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(nodeName?: string): string {
  return nodeName?.trim() || "__cluster__";
}

function nodeNamesMatch(a?: string, b?: string): boolean {
  if (!a?.trim() || !b?.trim()) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a.split(".")[0] === b.split(".")[0];
}

/** Guard against partial API payloads that omit array fields (crashes React render). */
export function normalizeProfileDetail(detail: NodeProfileDetail): NodeProfileDetail {
  return {
    ...detail,
    metrics: detail.metrics ?? [],
    stack: detail.stack ?? [],
    cpuStack: detail.cpuStack ?? [],
    log: detail.log ?? [],
    topPods: detail.topPods ?? [],
    topContainers: detail.topContainers ?? [],
    topProcesses: detail.topProcesses ?? [],
    kernelHotspots: detail.kernelHotspots ?? [],
    timeline: detail.timeline ?? [],
    psi: detail.psi ?? { cpuLevel: "normal", memoryLevel: "normal" },
    memoryDetail: detail.memoryDetail ?? {},
    kernelMemory: detail.kernelMemory ?? {},
  };
}

export function normalizeProfileSnapshot(snapshot: ProfileSnapshot): ProfileSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes ?? [],
    selected: snapshot.selected ? normalizeProfileDetail(snapshot.selected) : undefined,
    podPlacements: snapshot.podPlacements ?? [],
    updatedAt: snapshot.updatedAt ?? "",
  };
}

/**
 * Instant Overview paint from the sidebar row — no network wait.
 * Full pods/flame replace this as soon as the real profile arrives.
 */
export function provisionalDetailFromSummary(node: NodeProfileSummary): NodeProfileDetail {
  return normalizeProfileDetail({
    name: node.name,
    zone: node.zone,
    cpuCores: node.cpuCores,
    health: node.health,
    agentLive: node.agentLive,
    cpuPercent: node.cpuPercent,
    memoryUsedMb: node.memoryUsedMb,
    memoryTotalMb: node.memoryTotalMb,
    sampleSeconds: 0,
    metrics: [],
    stack: [],
    cpuStack: [],
    log: [],
    psi: {
      cpuLevel: node.psiCpuLevel ?? "normal",
      memoryLevel: node.psiMemoryLevel ?? "normal",
    },
    memoryDetail: {},
    kernelMemory: {},
    topPods: [],
    topProcesses: [],
    kernelHotspots: [],
    timeline: [
      {
        timestamp: new Date().toISOString(),
        title: "Loading node samples…",
        detail: "Showing live sidebar metrics while the full profile catches up.",
        severity: "info",
      },
    ],
  });
}

export function peekProfileCache(
  nodeName?: string,
  options?: { allowStale?: boolean },
): ProfileSnapshot | null {
  const entry = cache.get(cacheKey(nodeName));
  if (!entry) {
    return null;
  }
  const age = Date.now() - entry.at;
  if (age <= FRESH_TTL_MS) {
    return entry.snapshot;
  }
  if (options?.allowStale && age <= STALE_TTL_MS) {
    return entry.snapshot;
  }
  return null;
}

export function isProfileCacheFresh(nodeName?: string): boolean {
  const entry = cache.get(cacheKey(nodeName));
  if (!entry) {
    return false;
  }
  return Date.now() - entry.at <= FRESH_TTL_MS;
}

export function putProfileCache(nodeName: string | undefined, snapshot: ProfileSnapshot): void {
  const normalized = normalizeProfileSnapshot(snapshot);
  cache.set(cacheKey(nodeName), { snapshot: normalized, at: Date.now() });
  if (normalized.selected?.name && normalized.selected.name !== nodeName) {
    cache.set(cacheKey(normalized.selected.name), { snapshot: normalized, at: Date.now() });
  }
  // Keep cluster node list warm for instant sidebar + provisional paints.
  if (normalized.nodes.length > 0) {
    const cluster = cache.get(cacheKey());
    if (!cluster || normalized.nodes.length >= (cluster.snapshot.nodes?.length ?? 0)) {
      cache.set(cacheKey(), {
        snapshot: {
          nodes: normalized.nodes,
          podPlacements: normalized.podPlacements,
          updatedAt: normalized.updatedAt,
        },
        at: Date.now(),
      });
    }
  }
}

/** Keep prior flame / process samples when a refresh returns an empty agent payload. */
export function stickyMergeProfile(
  next: ProfileSnapshot,
  previous: ProfileSnapshot | null | undefined,
): ProfileSnapshot {
  const safeNext = normalizeProfileSnapshot(next);
  const safePrev = previous ? normalizeProfileSnapshot(previous) : undefined;

  if (!safePrev?.selected) {
    return safeNext;
  }
  if (!safeNext.selected) {
    return {
      ...safeNext,
      nodes: safeNext.nodes.length > 0 ? safeNext.nodes : safePrev.nodes,
      selected: safePrev.selected,
      podPlacements: safeNext.podPlacements ?? safePrev.podPlacements,
    };
  }
  if (!nodeNamesMatch(safePrev.selected.name, safeNext.selected.name)) {
    return safeNext;
  }

  const prev = safePrev.selected;
  const cur = safeNext.selected;
  return {
    ...safeNext,
    nodes: safeNext.nodes.length > 0 ? safeNext.nodes : safePrev.nodes,
    podPlacements: safeNext.podPlacements ?? safePrev.podPlacements,
    selected: normalizeProfileDetail({
      ...cur,
      cpuStack: cur.cpuStack.length > 0 ? cur.cpuStack : prev.cpuStack,
      stack: cur.stack.length > 0 ? cur.stack : prev.stack,
      stackSource: cur.cpuStack.length > 0 ? cur.stackSource : prev.stackSource ?? cur.stackSource,
      kernelHotspots:
        cur.kernelHotspots.length > 0 ? cur.kernelHotspots : prev.kernelHotspots,
      topProcesses: cur.topProcesses.length > 0 ? cur.topProcesses : prev.topProcesses,
      topPods: cur.topPods.length > 0 ? cur.topPods : prev.topPods,
      topContainers:
        (cur.topContainers?.length ?? 0) > 0 ? cur.topContainers : prev.topContainers,
      timeline: cur.timeline.length > 0 ? cur.timeline : prev.timeline,
      log: cur.log.length > 0 ? cur.log : prev.log,
    }),
  };
}
