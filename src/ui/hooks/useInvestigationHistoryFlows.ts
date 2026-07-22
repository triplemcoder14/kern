import { useEffect, useState } from "react";
import {
  filterFlowsForInvestigation,
  mergeFlowsById,
  type ServiceInvestigationFocus,
} from "../../core/network/investigation-scope";
import type { NetworkFlow } from "../../core/types/network";
import type { InvestigationFocus } from "../investigation/types";
import { investigationWindowMs } from "../investigation/types";

interface StoredNetworkSnapshot {
  savedAt: string;
  snapshot?: {
    flows?: NetworkFlow[];
  };
}

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

/**
 * Loads retained network snapshot history for the investigation window and
 * merges it with the live flow buffer (deduped by flow id).
 */
export function useInvestigationHistoryFlows(
  investigation: InvestigationFocus | null | undefined,
  liveFlows: NetworkFlow[],
): { flows: NetworkFlow[]; historyLoading: boolean } {
  const [historical, setHistorical] = useState<NetworkFlow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!investigation) {
      setHistorical([]);
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    const windowMs = investigationWindowMs(investigation.window);
    const sinceIso = new Date(Date.now() - windowMs).toISOString();
    const focus: ServiceInvestigationFocus = {
      name: investigation.name,
      namespace: investigation.namespace,
      memberPods: investigation.memberPods,
      windowMs,
    };

    setHistoryLoading(true);
    void (async () => {
      try {
        const response = await fetch(`${apiBase()}/api/monitor/snapshots/history`, {
          credentials: "include",
        });
        if (!response.ok) {
          if (!cancelled) {
            setHistorical([]);
          }
          return;
        }
        const rows = (await response.json()) as StoredNetworkSnapshot[];
        const fromHistory: NetworkFlow[] = [];
        for (const row of rows) {
          const savedAt = Date.parse(row.savedAt);
          if (Number.isFinite(savedAt) && savedAt < Date.parse(sinceIso)) {
            continue;
          }
          for (const flow of row.snapshot?.flows ?? []) {
            fromHistory.push(flow);
          }
        }
        if (!cancelled) {
          setHistorical(filterFlowsForInvestigation(fromHistory, focus));
        }
      } catch {
        if (!cancelled) {
          setHistorical([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-fetch when the investigation identity or window changes — not on every live tick.
  }, [
    investigation?.name,
    investigation?.namespace,
    investigation?.window,
    investigation?.startedAt,
    investigation?.memberPods?.join(","),
  ]);

  if (!investigation) {
    return { flows: liveFlows, historyLoading: false };
  }

  const focus: ServiceInvestigationFocus = {
    name: investigation.name,
    namespace: investigation.namespace,
    memberPods: investigation.memberPods,
    windowMs: investigationWindowMs(investigation.window),
  };
  const liveScoped = filterFlowsForInvestigation(liveFlows, focus);
  // Live updates keep appending; history is the retained window baseline.
  const flows = investigation.live
    ? mergeFlowsById(historical, liveScoped)
    : mergeFlowsById(historical);

  return { flows, historyLoading };
}
