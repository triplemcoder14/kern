import { useMemo, useState } from "react";
import { buildGraphLayout, type GraphEdgeLayout } from "../../core/network/graph-model";
import type { Incident } from "../../core/types/monitoring";
import type { NetworkSnapshot } from "../../core/types/network";
import { EdgeLatencyBoard } from "./EdgeLatencyBoard";
import { LiveFlowsTable } from "./LiveFlowsTable";
import { NetworkObservatoryHeader } from "./NetworkObservatoryHeader";
import { NetworkRightPanel } from "./NetworkRightPanel";
import { GraphLegend, TopologyGraph } from "./TopologyGraph";

interface NetworkDashboardProps {
  snapshot: NetworkSnapshot;
  connected: boolean;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  incidents: Incident[];
}

function filterSnapshot(snapshot: NetworkSnapshot, namespace: string): NetworkSnapshot {
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

export function NetworkDashboard({
  snapshot,
  connected,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  incidents,
}: NetworkDashboardProps) {
  const scoped = useMemo(() => filterSnapshot(snapshot, namespace), [snapshot, namespace]);
  const { topology, flows, ebpf } = scoped;
  const layout = useMemo(() => buildGraphLayout(topology, flows), [topology, flows]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const selectedEdge: GraphEdgeLayout | null =
    layout.edges.find((edge) => edge.id === selectedEdgeId) ??
    layout.edges.find((edge) => edge.flowCount > 0) ??
    null;

  const podCount = topology.nodes.filter((node) => node.kind === "Pod").length;
  const serviceCount = topology.nodes.filter((node) => node.kind === "Service").length;

  return (
    <div className={`network-observatory ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <NetworkObservatoryHeader
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        flowCount={flows.length}
        routeCount={layout.edges.length}
      />

      <div className="network-obs-main">
        <section className="panel network-graph-panel">
          <div className="panel-header panel-header-split">
            <div className="panel-header-main">
              <span>SERVICE TOPOLOGY</span>
              <span className="panel-meta-inline">
                {podCount} pods · {serviceCount} services · drag to pan · scroll to zoom
              </span>
            </div>
            <div className="panel-header-actions">
              <GraphLegend />
              <button
                type="button"
                className="panel-toggle-btn"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                {sidebarOpen ? "Hide panel" : "Show panel"}
              </button>
            </div>
          </div>
          <TopologyGraph
            layout={layout}
            connected={connected}
            selectedEdgeId={selectedEdge?.id ?? null}
            onSelectEdge={setSelectedEdgeId}
          />
        </section>

        <div className="network-obs-bottom">
          <EdgeLatencyBoard
            edges={layout.edges}
            selectedEdgeId={selectedEdge?.id ?? null}
            onSelectEdge={setSelectedEdgeId}
          />
          <LiveFlowsTable flows={flows} />
        </div>
      </div>

      {sidebarOpen ? (
        <NetworkRightPanel
          selectedEdge={selectedEdge}
          flows={flows}
          ebpf={ebpf}
          incidents={incidents}
        />
      ) : null}
    </div>
  );
}
