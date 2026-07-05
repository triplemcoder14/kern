import type { NetworkSnapshot } from "../types/network";

export function filterNetworkSnapshot(
  snapshot: NetworkSnapshot,
  namespace: string,
): NetworkSnapshot {
  if (namespace === "all") {
    return snapshot;
  }

  const nodes = snapshot.topology.nodes.filter((node) => node.namespace === namespace);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = snapshot.topology.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  const flows = snapshot.flows.filter(
    (flow) => flow.src.namespace === namespace || flow.dst.namespace === namespace,
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
