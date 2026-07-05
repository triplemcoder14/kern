import { useMemo, useState } from "react";
import { flameColor } from "../../core/network/flame-colors";
import type { NodeHealth, NodeProfileSummary, ProfileLogLine, ProfileMetric, ProfileStackFrame } from "../../core/types/profiling";
import { PageHeader } from "./PageHeader";
import { useNodeProfile } from "../hooks/useNodeProfile";

interface ProfilingDashboardProps {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
}

function healthLabel(health: NodeHealth): string {
  if (health === "ok") {
    return "Healthy";
  }
  if (health === "warn") {
    return "Degraded";
  }
  if (health === "bad") {
    return "Critical";
  }
  return "Unknown";
}

function Sparkline({ values, tone }: { values: number[]; tone?: string }) {
  const points = values
    .map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 80},${value}`)
    .join(" ");
  return (
    <svg className={`profile-sparkline${tone ? ` profile-sparkline-${tone}` : ""}`} viewBox="0 0 80 20" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function FlameStack({ frames }: { frames: ProfileStackFrame[] }) {
  const rowHeight = 22;
  const width = 360;
  const depthRows = Math.max(...frames.map((frame) => frame.depth), 0) + 1;
  const height = depthRows * rowHeight + 8;

  return (
    <svg className="profile-flamegraph" viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {frames.map((frame) => {
        const y = 4 + frame.depth * rowHeight;
        const blockWidth = Math.max(24, frame.width * width);
        const x = frame.offset * (width - blockWidth);
        return (
          <g key={`${frame.label}-${frame.depth}-${frame.offset}`}>
            <rect
              x={x}
              y={y}
              width={blockWidth}
              height={18}
              rx={3}
              fill={flameColor(frame.heat, 0.92)}
            />
            <text x={x + 8} y={y + 12} className="profile-flame-label">
              {frame.label.length > 28 ? `${frame.label.slice(0, 26)}…` : frame.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ProfilingDashboard({
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
}: ProfilingDashboardProps) {
  const [selectedNode, setSelectedNode] = useState<string | undefined>();
  const { profile, loading, error } = useNodeProfile(connected, selectedNode);

  const activeNode = profile.selected?.name ?? selectedNode ?? profile.nodes[0]?.name;
  const detail = profile.selected;

  const subtitle = useMemo(() => {
    if (!connected) {
      return "Connect a cluster to profile nodes from the kernel up";
    }
    if (loading && profile.nodes.length === 0) {
      return "Sampling node metrics and network stacks…";
    }
    return "Live kernel-level node profiling — network paths, latency, and host pressure";
  }, [connected, loading, profile.nodes.length]);

  return (
    <div className="profile-page">
      <PageHeader
        title="Profiling"
        subtitle={subtitle}
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
      />

      {error ? <div className="profile-error panel">{error}</div> : null}

      {!connected ? (
        <div className="profile-empty panel">
          <p>Open Settings and connect your cluster to start kernel-level node profiling.</p>
        </div>
      ) : (
        <div className="profile-layout">
          <aside className="profile-nodes panel">
            <div className="panel-header">Node pool</div>
            <div className="profile-nodes-list">
              {profile.nodes.length === 0 ? (
                <p className="profile-nodes-empty">{loading ? "Loading nodes…" : "No nodes found"}</p>
              ) : (
                profile.nodes.map((node: NodeProfileSummary) => (
                  <button
                    key={node.name}
                    type="button"
                    className={`profile-node${activeNode === node.name ? " profile-node-active" : ""}`}
                    onClick={() => setSelectedNode(node.name)}
                  >
                    <span className="profile-node-row">
                      <span className={`profile-health profile-health-${node.health}`} />
                      {node.name}
                      {node.agentLive ? <span className="profile-node-live">live</span> : null}
                    </span>
                    <span className={`profile-node-meta profile-node-meta-${node.health}`}>
                      p95 {node.p95Ms !== undefined ? `${Math.round(node.p95Ms)}ms` : "—"}
                      {node.drops > 0 ? ` · ${node.drops} drops` : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="profile-main panel">
            {detail ? (
              <>
                <div className="profile-toolbar">
                  <div className="profile-toolbar-left">
                    <span className="profile-toolbar-name">{detail.name}</span>
                    <span className={`profile-badge profile-badge-${detail.health}`}>
                      {healthLabel(detail.health)}
                    </span>
                    {detail.zone ? (
                      <span className="profile-toolbar-zone">
                        {detail.zone}
                        {detail.cpuCores ? ` · ${detail.cpuCores} vCPU` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="profile-toolbar-right">
                    <span className="profile-toolbar-sample">Sample {detail.sampleSeconds}s</span>
                    <span className={`profile-live${detail.agentLive ? " on" : ""}`}>
                      {detail.agentLive ? "live agent" : "derived"}
                    </span>
                  </div>
                </div>

                <div className="profile-metrics">
                  {detail.metrics.map((metric: ProfileMetric) => (
                    <div key={metric.label} className="profile-metric">
                      <span className="profile-metric-label">{metric.label}</span>
                      <span className={`profile-metric-value profile-metric-${metric.tone}`}>
                        {metric.value}
                      </span>
                      <Sparkline values={metric.sparkline} tone={metric.tone === "neutral" ? undefined : metric.tone} />
                    </div>
                  ))}
                </div>

                {(detail.cpuPercent !== undefined || detail.memoryUsedMb !== undefined) && (
                  <div className="profile-host-stats">
                    {detail.cpuPercent !== undefined ? (
                      <span>CPU {detail.cpuPercent.toFixed(1)}%</span>
                    ) : null}
                    {detail.memoryUsedMb !== undefined && detail.memoryTotalMb !== undefined ? (
                      <span>
                        Memory {detail.memoryUsedMb} / {detail.memoryTotalMb} MB
                      </span>
                    ) : null}
                  </div>
                )}

                <div className="profile-flamegraph-wrap">
                  <span className="profile-panel-label">Network flame stack</span>
                  <FlameStack frames={detail.stack} />
                </div>

                <div className="profile-events">
                  <div className="profile-events-head">
                    <span>Time</span>
                    <span>Sev</span>
                    <span>Event</span>
                    <span>Value</span>
                  </div>
                  {detail.log.length === 0 ? (
                    <div className="profile-log-empty">No network pressure signals on this node.</div>
                  ) : (
                    detail.log.map((line: ProfileLogLine) => (
                      <div key={`${line.time}-${line.event}-${line.value}`} className="profile-log-row">
                        <span className="profile-log-time">{line.time}</span>
                        <span className={`profile-log-sev profile-log-${line.tone}`}>{line.severity}</span>
                        <span className="profile-log-msg">{line.event}</span>
                        <span className={`profile-log-val profile-log-${line.tone}`}>{line.value}</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="profile-empty-inner">
                {loading ? "Loading node profile…" : "Select a node to inspect kernel-level network profile."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
