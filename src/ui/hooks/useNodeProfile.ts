import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeProfileSummary, ProfileSnapshot } from "../../core/types/profiling";
import {
  mergeProfileSnapshots,
  prefetchAllNodeProfiles,
  prefetchProfileSnapshot,
  readCachedProfile,
} from "../../lib/profile-api";
import {
  normalizeProfileSnapshot,
  provisionalDetailFromSummary,
} from "../../lib/profile-cache";

const EMPTY_PROFILE: ProfileSnapshot = {
  nodes: [],
  updatedAt: "",
};

function nodeNamesMatch(a?: string, b?: string): boolean {
  if (!a?.trim() || !b?.trim()) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a.split(".")[0] === b.split(".")[0];
}

function seedProfile(connected: boolean, selectedNode?: string): ProfileSnapshot {
  if (!connected) {
    return EMPTY_PROFILE;
  }
  return normalizeProfileSnapshot(
    readCachedProfile(selectedNode) ?? readCachedProfile() ?? EMPTY_PROFILE,
  );
}

function paintForNode(
  selectedNode: string | undefined,
  current: ProfileSnapshot,
): ProfileSnapshot {
  const cached = selectedNode ? readCachedProfile(selectedNode) : null;
  if (cached?.selected && nodeNamesMatch(cached.selected.name, selectedNode)) {
    return normalizeProfileSnapshot({
      ...cached,
      nodes: cached.nodes.length > 0 ? cached.nodes : current.nodes,
    });
  }

  const nodes = current.nodes.length > 0 ? current.nodes : readCachedProfile()?.nodes ?? [];
  const summary = selectedNode
    ? nodes.find((node) => nodeNamesMatch(node.name, selectedNode))
    : undefined;

  if (summary) {
    return normalizeProfileSnapshot({
      nodes,
      podPlacements: current.podPlacements ?? readCachedProfile()?.podPlacements,
      selected: provisionalDetailFromSummary(summary),
      updatedAt: new Date().toISOString(),
    });
  }

  return normalizeProfileSnapshot({
    ...current,
    nodes,
    selected: undefined,
  });
}

function holdDetailDuringSwitch(
  next: ProfileSnapshot,
  previous: ProfileSnapshot,
  selectedNode?: string,
): ProfileSnapshot {
  const safeNext = normalizeProfileSnapshot(next);
  const safePrev = normalizeProfileSnapshot(previous);

  if (selectedNode && safePrev.selected && !nodeNamesMatch(safePrev.selected.name, selectedNode)) {
    return safeNext;
  }

  const merged = mergeProfileSnapshots(safeNext, safePrev);
  if (merged.selected) {
    return merged;
  }
  if (safePrev.selected && nodeNamesMatch(safePrev.selected.name, selectedNode)) {
    return {
      ...merged,
      nodes: merged.nodes.length > 0 ? merged.nodes : safePrev.nodes,
      podPlacements: merged.podPlacements ?? safePrev.podPlacements,
      selected: safePrev.selected,
    };
  }
  return merged;
}

export function useNodeProfile(
  connected: boolean,
  selectedNode?: string,
  options?: { paused?: boolean },
) {
  const [profile, setProfile] = useState<ProfileSnapshot>(() =>
    seedProfile(connected, selectedNode),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profileRef = useRef(profile);
  const paused = Boolean(options?.paused);
  const requestGen = useRef(0);
  const prefetchedNodesKey = useRef("");

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Instant paint on node switch: cache hit or provisional sidebar metrics — never blank.
  useEffect(() => {
    if (!connected) {
      setProfile(EMPTY_PROFILE);
      setLoading(false);
      return;
    }
    const painted = paintForNode(selectedNode, profileRef.current);
    setProfile(painted);
    const hasRealDetail =
      Boolean(painted.selected) &&
      (painted.selected!.sampleSeconds > 0 ||
        painted.selected!.cpuStack.length > 0 ||
        painted.selected!.topPods.length > 0 ||
        painted.selected!.topProcesses.length > 0);
    setLoading(Boolean(selectedNode) && !hasRealDetail);
  }, [connected, selectedNode]);

  // Keep every sidebar node warm so the next click is instant.
  useEffect(() => {
    if (!connected || profile.nodes.length === 0) {
      return;
    }
    const key = profile.nodes.map((node) => node.name).join("|");
    if (key === prefetchedNodesKey.current) {
      return;
    }
    prefetchedNodesKey.current = key;
    prefetchAllNodeProfiles(profile.nodes.map((node: NodeProfileSummary) => node.name));
  }, [connected, profile.nodes]);

  const refresh = useCallback(async () => {
    if (!connected) {
      setProfile(EMPTY_PROFILE);
      setLoading(false);
      return;
    }
    const gen = ++requestGen.current;
    setError(null);
    setProfile(paintForNode(selectedNode, profileRef.current));

    try {
      const snapshot = await prefetchProfileSnapshot(selectedNode);
      if (gen !== requestGen.current) {
        return;
      }
      if (selectedNode && !snapshot.selected) {
        setProfile((prev) => paintForNode(selectedNode, prev));
        return;
      }
      setProfile((prev) => holdDetailDuringSwitch(snapshot, prev, selectedNode));
    } catch (err) {
      if (gen !== requestGen.current) {
        return;
      }
      if (!profileRef.current.selected) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      }
    } finally {
      if (gen === requestGen.current) {
        setLoading(false);
      }
    }
  }, [connected, selectedNode]);

  useEffect(() => {
    void refresh();
    if (!connected || paused) {
      return undefined;
    }
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [connected, refresh, paused]);

  return { profile, loading, error, refresh };
}
