import { useMemo, useRef, useState } from "react";
import { filterNetworkSnapshot } from "../../core/network/scope";
import { buildGraphLayout, type GraphEdgeLayout, type GraphLod } from "../../core/network/graph-model";
import type { NetworkSnapshot } from "../../core/types/network";
import { useInvestigationLayout } from "../hooks/useInvestigationLayout";
import { useFrozenWhileSelected } from "../hooks/useStickySelection";
import { FlowDetailPanel } from "./FlowDetailPanel";
import { LiveFlowsTable } from "./LiveFlowsTable";
import { PageHeader } from "./PageHeader";
import { GraphLegend, TopologyGraph } from "./TopologyGraph";

interface TopologyDashboardProps {
  snapshot: NetworkSnapshot;
  connected: boolean;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
}

export function TopologyDashboard({
  snapshot,
  connected,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
}: TopologyDashboardProps) {
  const scoped = useMemo(() => filterNetworkSnapshot(snapshot, namespace), [snapshot, namespace]);
  const { topology, flows } = scoped;
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [lod, setLod] = useState<GraphLod>("service");
  const liveLayout = useMemo(
    () => buildGraphLayout(topology, flows, { lod }),
    [topology, flows, lod],
  );
  const investigating = selectedNodeId != null || selectedEdgeId != null;
  const layout = useInvestigationLayout(liveLayout, investigating, lod);
  const detailFlows = useFrozenWhileSelected(flows, investigating);

  const selectedEdgeLive =
    layout.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const stickyEdgeRef = useRef<GraphEdgeLayout | null>(null);
  if (selectedEdgeId == null) {
    stickyEdgeRef.current = null;
  } else if (selectedEdgeLive) {
    stickyEdgeRef.current = selectedEdgeLive;
  }
  const selectedEdge: GraphEdgeLayout | null =
    selectedEdgeId == null
      ? null
      : selectedEdgeLive ??
        (stickyEdgeRef.current?.id === selectedEdgeId ? stickyEdgeRef.current : null);

  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const podCount = topology.nodes.filter((node) => node.kind === "Pod").length;
  const serviceCount = topology.nodes.filter((node) => node.kind === "Service").length;

  return (
    <div className="topology-page">
      <PageHeader
        title="Service Topology"
        subtitle={`${podCount} pods · ${serviceCount} services · pod → service → pod paths`}
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
      />

      <div className="topology-layout">
        <section className="panel topology-graph-panel">
          <div className="panel-header panel-header-split">
            <div className="panel-header-main">
              <span>SERVICE MAP</span>
              <span className="panel-meta-inline">
                click service to investigate · hover edge for latency · double-click to expand pods
              </span>
            </div>
            <GraphLegend />
          </div>
          <TopologyGraph
            layout={layout}
            connected={connected}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            lod={lod}
            onLodChange={setLod}
            showInspectPanel={false}
          />
        </section>

        <FlowDetailPanel
          edge={selectedEdge}
          flows={detailFlows}
          edges={layout.edges}
          nodeById={nodeById}
          onSelectEdge={setSelectedEdgeId}
        />
      </div>

      <LiveFlowsTable flows={detailFlows} limit={8} title="RECENT FLOWS ON MAP" />
    </div>
  );
}
