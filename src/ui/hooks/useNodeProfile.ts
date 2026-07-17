import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileSnapshot } from "../../core/types/profiling";
import { fetchProfileSnapshot } from "../../lib/profile-api";

const EMPTY_PROFILE: ProfileSnapshot = {
  nodes: [],
  updatedAt: "",
};

export function useNodeProfile(connected: boolean, selectedNode?: string) {
  const [profile, setProfile] = useState<ProfileSnapshot>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasNodesRef = useRef(false);

  useEffect(() => {
    hasNodesRef.current = profile.nodes.length > 0;
  }, [profile.nodes.length]);

  const refresh = useCallback(async () => {
    if (!connected) {
      setProfile(EMPTY_PROFILE);
      setLoading(false);
      return;
    }
    // setLoading(true);
    // Soft refresh: keep current profile visible while switching nodes / polling.
    if (!hasNodesRef.current) {
      setLoading(true);
    }
    setError(null);
    try {
      const snapshot = await fetchProfileSnapshot(selectedNode);
      setProfile(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [connected, selectedNode]);

  useEffect(() => {
    void refresh();
    if (!connected) {
      return undefined;
    }
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [connected, refresh]);

  return { profile, loading, error, refresh };
}
