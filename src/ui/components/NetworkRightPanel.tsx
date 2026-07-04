import { useMemo } from "react";
import { topTalkers, type GraphEdgeLayout } from "../../core/network/graph-model";
import { buildTrafficSeries } from "../../core/network/latency";
import type { Incident } from "../../core/types/monitoring";
import type { EbpfCollectorStatus, NetworkFlow } from "../../core/types/network";
import { LatencyHistogramChart, TrafficSparkline } from "./LatencyHistogramChart";

interface NetworkRightPanelProps {
  selectedEdge: GraphEdgeLayout | null;
  flows: NetworkFlow[];
  ebpf: EbpfCollectorStatus;
  incidents: Incident[];
}

export function NetworkRightPanel({
  selectedEdge,
  flows,
  ebpf,
  incidents,
}: NetworkRightPanelProps) {
  const talkers = useMemo(() => topTalkers(flows, 5), [flows]);
  const trafficSeries = useMemo(
    () => buildTrafficSeries(flows.map((flow) => flow.timestamp)),
    [flows],
  );

  const networkAlerts = incidents
    .filter((item) => item.status === "open")
    .slice(0, 4);

  const ebpfChecks = [
    { label: "Collector", ok: ebpf.connected },
    {
      label: ebpf.mode?.includes("hubble") ? "Hubble stream" : "ProcNet stream",
      ok: ebpf.connected && (ebpf.flowsPerSecond ?? 0) >= 0,
    },
    { label: "Programs", ok: ebpf.connected && (ebpf.programsAttached ?? 0) > 0 },
    { label: "Pod index", ok: ebpf.connected && (ebpf.podsIndexed ?? 0) > 0 },
  ];

  return (
    <aside className="obs-sidebar">
      {selectedEdge ? (
        <section className="obs-widget">
          <div className="obs-widget-title">SELECTED LINK</div>
          <div className="obs-widget-route">{selectedEdge.routeName}</div>
          <div className="obs-widget-metrics">
            <span>p50 {selectedEdge.latencyP50Ms ?? "—"}ms</span>
            <span>p95 {selectedEdge.latencyP95Ms ?? "—"}ms</span>
            <span>p99 {selectedEdge.latencyP99Ms ?? "—"}ms</span>
          </div>
          <LatencyHistogramChart histogram={selectedEdge.histogram} width={280} height={72} compact />
        </section>
      ) : null}

      <section className="obs-widget">
        <div className="obs-widget-title">TRAFFIC SUMMARY</div>
        <TrafficSparkline series={trafficSeries} width={280} height={56} compact />
        <div className="obs-widget-caption">
          {flows.length} flows · {ebpf.flowsPerSecond ?? 0}/s from collector
        </div>
      </section>

      <section className="obs-widget">
        <div className="obs-widget-title">TOP TALKERS</div>
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
      </section>

      <section className="obs-widget">
        <div className="obs-widget-title">RECENT ALERTS</div>
        {networkAlerts.length === 0 ? (
          <div className="obs-widget-empty">No open network alerts</div>
        ) : (
          networkAlerts.map((alert) => (
            <div key={alert.id} className="obs-alert-row">
              <div className="obs-alert-title">{alert.title}</div>
              <div className="obs-alert-sub">{alert.summary}</div>
            </div>
          ))
        )}
      </section>

      <section className="obs-widget">
        <div className="obs-widget-title">EBPF STATUS</div>
        <ul className="obs-checklist">
          {ebpfChecks.map((check) => (
            <li key={check.label} className={check.ok ? "ok" : ""}>
              <span className="obs-check-mark">{check.ok ? "✓" : "○"}</span>
              {check.label}
            </li>
          ))}
        </ul>
        <div className="obs-widget-caption">{ebpf.message ?? ebpf.collectorUrl}</div>
      </section>
    </aside>
  );
}
