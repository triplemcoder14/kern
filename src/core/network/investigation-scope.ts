import type { NetworkEndpoint, NetworkFlow, NetworkSnapshot } from "../types/network";

/** Structural focus used to narrow network data to one service investigation. */
export interface ServiceInvestigationFocus {
  name: string;
  namespace: string;
  memberPods?: string[];
  /** Lookback window in ms. When set, only flows in [now - windowMs, now] are kept. */
  windowMs?: number;
}

function endpointMatchesFocus(
  endpoint: NetworkEndpoint,
  focus: ServiceInvestigationFocus,
): boolean {
  if (focus.namespace && endpoint.namespace && endpoint.namespace !== focus.namespace) {
    return false;
  }
  if (endpoint.name === focus.name) {
    return true;
  }
  if (focus.memberPods?.includes(endpoint.name)) {
    return true;
  }
  // Workload pods often look like elasticsearch-6d4b69bcff-abc12
  if (endpoint.name.startsWith(`${focus.name}-`)) {
    return true;
  }
  return false;
}

export function flowInvolvesFocus(
  flow: NetworkFlow,
  focus: ServiceInvestigationFocus,
): boolean {
  if (endpointMatchesFocus(flow.src, focus) || endpointMatchesFocus(flow.dst, focus)) {
    return true;
  }
  if (flow.path) {
    const needle = focus.namespace
      ? `${focus.namespace}/${focus.name}`
      : focus.name;
    if (flow.path.includes(needle) || flow.path.includes(focus.name)) {
      return true;
    }
  }
  return false;
}

function flowTimestampMs(flow: NetworkFlow): number {
  const raw = flow.lastSeen ?? flow.timestamp ?? flow.firstSeen;
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function flowWithinWindow(
  flow: NetworkFlow,
  windowMs: number | undefined,
  now = Date.now(),
): boolean {
  if (!windowMs || windowMs <= 0) {
    return true;
  }
  const ts = flowTimestampMs(flow);
  // Keep untimestamped flows so we don't hide live rows with incomplete clocks.
  if (ts <= 0) {
    return true;
  }
  return now - ts <= windowMs;
}

/** Deduplicate by flow id, preferring the newer timestamp. */
export function mergeFlowsById(...groups: NetworkFlow[][]): NetworkFlow[] {
  const merged = new Map<string, NetworkFlow>();
  for (const group of groups) {
    for (const flow of group) {
      const existing = merged.get(flow.id);
      if (!existing) {
        merged.set(flow.id, flow);
        continue;
      }
      if (flowTimestampMs(flow) >= flowTimestampMs(existing)) {
        merged.set(flow.id, flow);
      }
    }
  }
  return [...merged.values()].sort((a, b) => flowTimestampMs(b) - flowTimestampMs(a));
}

export function filterFlowsForInvestigation(
  flows: NetworkFlow[],
  focus: ServiceInvestigationFocus | null | undefined,
  now = Date.now(),
): NetworkFlow[] {
  if (!focus?.name) {
    return flows;
  }
  return flows.filter(
    (flow) =>
      flowInvolvesFocus(flow, focus) && flowWithinWindow(flow, focus.windowMs, now),
  );
}

/** Narrow an already namespace-scoped snapshot to one service/workload investigation. */
export function filterSnapshotForInvestigation(
  snapshot: NetworkSnapshot,
  focus: ServiceInvestigationFocus | null | undefined,
  now = Date.now(),
): NetworkSnapshot {
  if (!focus?.name) {
    return snapshot;
  }

  // Previous: service match only (no time window) — felt live-only / empty for quiet services.
  // const flows = snapshot.flows.filter((flow) => flowInvolvesFocus(flow, focus));
  const flows = filterFlowsForInvestigation(snapshot.flows, focus, now);
  const flowNodeNames = new Set<string>();
  for (const flow of flows) {
    flowNodeNames.add(flow.src.name);
    flowNodeNames.add(flow.dst.name);
  }

  const nodes = snapshot.topology.nodes.filter((node) => {
    if (node.namespace === focus.namespace && node.name === focus.name) {
      return true;
    }
    if (focus.memberPods?.includes(node.name)) {
      return true;
    }
    if (node.name.startsWith(`${focus.name}-`) && node.namespace === focus.namespace) {
      return true;
    }
    return flowNodeNames.has(node.name) && (!focus.namespace || node.namespace === focus.namespace);
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = snapshot.topology.edges.filter(
    (edge) => nodeIds.has(edge.from) || nodeIds.has(edge.to),
  );

  return {
    ...snapshot,
    topology: {
      ...snapshot.topology,
      nodes,
      edges,
    },
    flows,
  };
}
