import type { GraphEdgeLayout } from "../../core/network/graph-model";
import { flameColor, valueHeat } from "../../core/network/flame-colors";
import type { LatencyHistogram } from "../../core/network/latency";
import { LatencyHistogramChart, TrafficSparkline } from "./LatencyHistogramChart";

interface EdgeDistributionProps {
  histogram: LatencyHistogram | null;
  trafficSeries: number[];
  width?: number;
  height?: number;
}

function EdgeDistribution({ histogram, trafficSeries, width = 120, height = 36 }: EdgeDistributionProps) {
  if (histogram && histogram.stats.sampleCount > 0) {
    return <LatencyHistogramChart histogram={histogram} width={width} height={height} compact />;
  }

  const hasTraffic = trafficSeries.some((value) => value > 0);
  if (hasTraffic) {
    return <TrafficSparkline series={trafficSeries} width={width} height={height} compact />;
  }

  return <span className="edge-dist-empty">awaiting samples</span>;
}

interface EdgeLatencyBoardProps {
  edges: GraphEdgeLayout[];
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
}

function formatMs(value?: number): string {
  return value !== undefined ? `${value}ms` : "—";
}

export function EdgeLatencyBoard({ edges, selectedEdgeId, onSelectEdge }: EdgeLatencyBoardProps) {
  const ranked = [...edges]
    .filter((edge) => edge.flowCount > 0)
    .sort(
      (a, b) =>
        (b.latencyP99Ms ?? 0) - (a.latencyP99Ms ?? 0) ||
        b.flowCount - a.flowCount,
    )
    .slice(0, 12);

  if (ranked.length === 0) {
    return (
      <section className="panel edge-latency-panel">
        <div className="panel-header">
          EDGE LATENCY
          <span className="panel-meta">p50 / p95 / p99</span>
        </div>
        <div className="empty-state">No edge metrics yet — generate traffic between pods</div>
      </section>
    );
  }

  const hasLatency = ranked.some((edge) => edge.latencySampleCount && edge.latencySampleCount > 0);
  const maxP99 = Math.max(...ranked.map((edge) => edge.latencyP99Ms ?? 0), 1);

  return (
    <section className="panel edge-latency-panel">
      <div className="panel-header">
        EDGE LATENCY
        <span className="panel-meta">
          {ranked.length} active routes
          {!hasLatency ? " · traffic only (redeploy agent for latency_ms)" : ""}
        </span>
      </div>
      <div className="edge-latency-table-wrap">
        <table className="edge-latency-table">
          <thead>
            <tr>
              <th>ROUTE</th>
              <th>P50</th>
              <th>P95</th>
              <th>P99</th>
              <th>FLOWS</th>
              <th>TREND</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((edge) => (
              <tr
                key={edge.id}
                className={selectedEdgeId === edge.id ? "selected" : ""}
                onClick={() => onSelectEdge(edge.id)}
              >
                <td className="edge-route-cell">
                  <div className="edge-route-name">{edge.routeName}</div>
                  <div className="edge-route-sub">
                    {edge.protocol}:{edge.port} · {edge.source.toUpperCase()}
                  </div>
                </td>
                <td>{formatMs(edge.latencyP50Ms)}</td>
                <td>{formatMs(edge.latencyP95Ms)}</td>
                <td
                  style={
                    edge.latencyP99Ms !== undefined && edge.latencyP99Ms > 0
                      ? { color: flameColor(valueHeat(edge.latencyP99Ms, maxP99), 1) }
                      : undefined
                  }
                  className={
                    edge.latencyP99Ms !== undefined && edge.latencyP99Ms > 500 ? "latency-hot" : ""
                  }
                >
                  {formatMs(edge.latencyP99Ms)}
                </td>
                <td>{edge.flowCount}</td>
                <td>
                  <EdgeDistribution histogram={edge.histogram} trafficSeries={edge.trafficSeries} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
