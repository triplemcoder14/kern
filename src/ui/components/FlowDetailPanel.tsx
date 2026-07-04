import { useMemo } from "react";
import { topTalkers, type GraphEdgeLayout, type GraphNodeLayout } from "../../core/network/graph-model";
import type { NetworkFlow } from "../../core/types/network";
import { LatencyHistogramChart, TrafficSparkline } from "./LatencyHistogramChart";

interface FlowDetailPanelProps {
  edge: GraphEdgeLayout | null;
  flows: NetworkFlow[];
  edges: GraphEdgeLayout[];
  nodeById: Map<string, GraphNodeLayout>;
  onSelectEdge: (id: string) => void;
}

function nodeLabel(node: GraphNodeLayout | undefined): string {
  if (!node) {
    return "unknown";
  }
  return `${node.kind}/${node.name}`;
}

export function FlowDetailPanel({
  edge,
  flows,
  edges,
  nodeById,
  onSelectEdge,
}: FlowDetailPanelProps) {
  const edgeFlows = useMemo(() => {
    if (!edge) {
      return [];
    }
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) {
      return [];
    }
    return flows.filter(
      (flow) =>
        flow.src.name === from.name &&
        flow.dst.name === to.name &&
        flow.port === edge.port,
    );
  }, [edge, flows, nodeById]);

  const talkers = useMemo(() => topTalkers(flows), [flows]);

  if (!edge) {
    return (
      <aside className="flow-detail">
        <div className="flow-detail-title">FLOW DETAILS</div>
        <div className="flow-detail-empty">Select a connection in the graph</div>
        <div className="flow-detail-section">
          <div className="flow-detail-heading">ACTIVE ROUTES</div>
          {edges.slice(0, 8).map((item) => (
            <button
              key={item.id}
              type="button"
              className="flow-detail-link"
              onClick={() => onSelectEdge(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  const rps = edgeFlows.length > 0 ? (edgeFlows.length / 15).toFixed(1) : "0.0";

  return (
    <aside className="flow-detail">
      <div className="flow-detail-title">FLOW DETAILS</div>

      <div className="flow-detail-route">
        {nodeLabel(from)} → {nodeLabel(to)}
      </div>

      <div className="flow-detail-metrics">
        <div className="metric-card">
          <span className="metric-label">P50</span>
          <span className="metric-value">{edge.latencyP50Ms !== undefined ? `${edge.latencyP50Ms}ms` : "—"}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">P95</span>
          <span className="metric-value">{edge.latencyP95Ms !== undefined ? `${edge.latencyP95Ms}ms` : "—"}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">P99</span>
          <span className="metric-value">{edge.latencyP99Ms !== undefined ? `${edge.latencyP99Ms}ms` : "—"}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">FLOWS</span>
          <span className="metric-value">{edge.flowCount}</span>
        </div>
        <div className="metric-card wide">
          <span className="metric-label">RATE · AVG</span>
          <span className="metric-value">
            {rps}/s
            {edge.avgLatencyMs !== undefined ? ` · ${edge.avgLatencyMs}ms avg` : ""}
          </span>
        </div>
        <div className="metric-card wide">
          <span className="metric-label">SOURCE</span>
          <span className="metric-value">{edge.source.toUpperCase()}</span>
        </div>
      </div>

      <div className="flow-detail-section">
        <div className="flow-detail-heading">LATENCY DISTRIBUTION</div>
        <LatencyHistogramChart histogram={edge.histogram} />
      </div>

      <TrafficSparkline series={edge.trafficSeries} />

      <div className="flow-detail-section">
        <div className="flow-detail-heading">TOP TALKERS</div>
        <div className="talker-list">
          {talkers.map((talker) => {
            const max = talkers[0]?.count ?? 1;
            const width = Math.max(8, Math.round((talker.count / max) * 100));
            return (
              <div key={talker.name} className="talker-row">
                <span className="talker-name">{talker.name}</span>
                <span className="talker-bar-wrap">
                  <span className="talker-bar" style={{ width: `${width}%` }} />
                </span>
                <span className="talker-count">{talker.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flow-detail-section">
        <div className="flow-detail-heading">RECENT ON THIS LINK</div>
        {edgeFlows.length === 0 ? (
          <div className="flow-detail-empty">No sampled packets on this link yet</div>
        ) : (
          edgeFlows.slice(0, 6).map((flow) => (
            <div key={flow.id} className="flow-detail-row">
              <span>{flow.verdict}</span>
              <span>
                {flow.protocol}:{flow.port}
                {flow.latencyMs !== undefined ? ` · ${flow.latencyMs}ms` : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
