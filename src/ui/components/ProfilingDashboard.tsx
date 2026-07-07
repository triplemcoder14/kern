import { useMemo, useState } from "react";
import { flameColor } from "../../core/network/flame-colors";
import type {
  KernelHotspot,
  NodeHealth,
  NodeProfileSummary,
  PodConsumer,
  ProcessSample,
  ProfileLogLine,
  ProfileMetric,
  ProfileStackFrame,
  TimelineEvent,
} from "../../core/types/profiling";
import { PageHeader } from "./PageHeader";
import { useNodeProfile } from "../hooks/useNodeProfile";

interface ProfilingDashboardProps {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
}

type ProfilerTab = "overview" | "cpu" | "memory" | "network" | "timeline";

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

function psiBadge(level?: string): string {
  if (level === "critical") {
    return "Critical";
  }
  if (level === "warn") {
    return "High";
  }
  return "Normal";
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

function FlameStack({ frames, label }: { frames: ProfileStackFrame[]; label: string }) {
  const rowHeight = 22;
  const width = 360;
  const depthRows = Math.max(...frames.map((frame) => frame.depth), 0) + 1;
  const height = depthRows * rowHeight + 8;

  return (
    <div className="profile-flamegraph-wrap">
      <span className="profile-panel-label">{label}</span>
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
    </div>
  );
}

function ConsumerTable({
  pods,
  processes,
}: {
  pods: PodConsumer[];
  processes: ProcessSample[];
}) {
  if (pods.length === 0 && processes.length === 0) {
    return <div className="profile-log-empty">No process samples from agent yet.</div>;
  }

  return (
    <div className="profile-table-wrap">
      {pods.length > 0 ? (
        <>
          <div className="profile-table-head profile-table-head-pods">
            <span>Pod</span>
            <span>CPU</span>
            <span>RSS</span>
          </div>
          {pods.map((pod) => (
            <div key={`${pod.namespace}/${pod.pod}`} className="profile-table-row profile-table-row-pods">
              <span>{pod.namespace}/{pod.pod}</span>
              <span>{pod.cpuPercent !== undefined ? `${pod.cpuPercent.toFixed(1)}%` : "—"}</span>
              <span>{pod.rssMb !== undefined ? `${pod.rssMb}MB` : "—"}</span>
            </div>
          ))}
        </>
      ) : null}
      {processes.length > 0 ? (
        <>
          <div className="profile-table-head profile-table-head-procs">
            <span>Process</span>
            <span>PID</span>
            <span>CPU</span>
            <span>RSS</span>
          </div>
          {processes.slice(0, 8).map((proc) => (
            <div key={proc.pid} className="profile-table-row profile-table-row-procs">
              <span>{proc.pod ? `${proc.namespace}/${proc.pod}` : proc.name}</span>
              <span>{proc.pid}</span>
              <span>{proc.cpuPercent !== undefined ? `${proc.cpuPercent.toFixed(1)}%` : "—"}</span>
              <span>{proc.rssMb !== undefined ? `${proc.rssMb}MB` : "—"}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function HotspotList({ hotspots }: { hotspots: KernelHotspot[] }) {
  if (hotspots.length === 0) {
    return null;
  }
  return (
    <div className="profile-hotspots">
      <span className="profile-panel-label">Kernel hotspots</span>
      {hotspots.map((hotspot) => (
        <div key={hotspot.function} className="profile-hotspot-row">
          <span className="profile-hotspot-fn">{hotspot.function}</span>
          <span className="profile-hotspot-share">{(hotspot.share * 100).toFixed(0)}%</span>
          <span className="profile-hotspot-meaning">{hotspot.meaning ?? "Kernel path"}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="profile-log-empty">No pressure events on this node in the current sample.</div>;
  }
  return (
    <div className="profile-timeline">
      {events.map((event) => (
        <div key={`${event.timestamp}-${event.title}`} className={`profile-timeline-row profile-timeline-${event.severity}`}>
          <span className="profile-timeline-time">
            {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className="profile-timeline-title">{event.title}</span>
          <span className="profile-timeline-detail">{event.detail ?? event.severity}</span>
        </div>
      ))}
    </div>
  );
}

function NetworkLog({ lines }: { lines: ProfileLogLine[] }) {
  return (
    <div className="profile-events">
      <div className="profile-events-head">
        <span>Time</span>
        <span>Sev</span>
        <span>Event</span>
        <span>Value</span>
      </div>
      {lines.length === 0 ? (
        <div className="profile-log-empty">No network pressure signals on this node.</div>
      ) : (
        lines.map((line) => (
          <div key={`${line.time}-${line.event}-${line.value}`} className="profile-log-row">
            <span className="profile-log-time">{line.time}</span>
            <span className={`profile-log-sev profile-log-${line.tone}`}>{line.severity}</span>
            <span className="profile-log-msg">{line.event}</span>
            <span className={`profile-log-val profile-log-${line.tone}`}>{line.value}</span>
          </div>
        ))
      )}
    </div>
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
  const [activeTab, setActiveTab] = useState<ProfilerTab>("overview");
  const { profile, loading, error } = useNodeProfile(connected, selectedNode);

  const activeNode = profile.selected?.name ?? selectedNode ?? profile.nodes[0]?.name;
  const detail = profile.selected;

  const subtitle = useMemo(() => {
    if (!connected) {
      return "Connect a cluster to profile nodes from the kernel up";
    }
    if (loading && profile.nodes.length === 0) {
      return "Sampling node metrics, PSI, and process stacks…";
    }
    return "Live node profiler — CPU stacks, memory pressure, network paths, timeline";
  }, [connected, loading, profile.nodes.length]);

  const tabs: Array<{ id: ProfilerTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "cpu", label: "CPU" },
    { id: "memory", label: "Memory" },
    { id: "network", label: "Network" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="profile-page">
      <PageHeader
        title="Profiler"
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
            <div className="panel-header">Cluster nodes</div>
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
                      {node.cpuPercent !== undefined ? `CPU ${node.cpuPercent.toFixed(0)}%` : "CPU —"}
                      {node.memoryUsedMb !== undefined && node.memoryTotalMb
                        ? ` · Mem ${Math.round((node.memoryUsedMb / node.memoryTotalMb) * 100)}%`
                        : ""}
                      {node.psiCpuLevel && node.psiCpuLevel !== "normal"
                        ? ` · PSI ${psiBadge(node.psiCpuLevel)}`
                        : ""}
                      {node.p95Ms !== undefined ? ` · p95 ${Math.round(node.p95Ms)}ms` : ""}
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
                        {detail.load1 !== undefined ? ` · load ${detail.load1.toFixed(2)}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="profile-toolbar-right">
                    <span className="profile-toolbar-sample">Sample {detail.sampleSeconds}s</span>
                    <span className={`profile-live${detail.agentLive ? " on" : ""}`}>
                      {detail.agentLive ? "live agent" : detail.cpuPercent !== undefined ? "metrics-server" : "derived"}
                    </span>
                  </div>
                </div>

                <div className="profile-tabs" role="tablist">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      className={`profile-tab${activeTab === tab.id ? " profile-tab-active" : ""}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
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

                {activeTab === "overview" ? (
                  <>
                    <div className="profile-overview-grid">
                      <div className="profile-overview-card">
                        <span className="profile-panel-label">Pressure (PSI)</span>
                        <div className="profile-kv">
                          <span>CPU</span>
                          <span className={`profile-kv-val profile-kv-${detail.psi.cpuLevel === "critical" ? "bad" : detail.psi.cpuLevel === "warn" ? "warn" : "ok"}`}>
                            {psiBadge(detail.psi.cpuLevel)}
                            {detail.psi.cpuAvg10 !== undefined ? ` · ${detail.psi.cpuAvg10.toFixed(1)}` : ""}
                          </span>
                        </div>
                        <div className="profile-kv">
                          <span>Memory</span>
                          <span className={`profile-kv-val profile-kv-${detail.psi.memoryLevel === "critical" ? "bad" : detail.psi.memoryLevel === "warn" ? "warn" : "ok"}`}>
                            {psiBadge(detail.psi.memoryLevel)}
                            {detail.psi.memoryAvg10 !== undefined ? ` · ${detail.psi.memoryAvg10.toFixed(1)}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="profile-overview-card">
                        <span className="profile-panel-label">Top consumers</span>
                        <ConsumerTable pods={detail.topPods.slice(0, 5)} processes={[]} />
                      </div>
                    </div>
                    <FlameStack frames={detail.cpuStack} label="CPU flame stack (inferred)" />
                    <TimelineList events={detail.timeline.slice(0, 4)} />
                  </>
                ) : null}

                {activeTab === "cpu" ? (
                  <>
                    <FlameStack frames={detail.cpuStack} label="CPU flame stack" />
                    <HotspotList hotspots={detail.kernelHotspots} />
                    <ConsumerTable pods={detail.topPods} processes={detail.topProcesses} />
                  </>
                ) : null}

                {activeTab === "memory" ? (
                  <div className="profile-memory-grid">
                    <div className="profile-overview-card">
                      <span className="profile-panel-label">Host memory</span>
                      <div className="profile-kv">
                        <span>Used</span>
                        <span>{detail.memoryUsedMb ?? "—"} / {detail.memoryTotalMb ?? "—"} MB</span>
                      </div>
                      <div className="profile-kv">
                        <span>Cache</span>
                        <span>{detail.memoryDetail.cacheMb !== undefined ? `${detail.memoryDetail.cacheMb} MB` : "—"}</span>
                      </div>
                      <div className="profile-kv">
                        <span>Slab</span>
                        <span>{detail.memoryDetail.slabMb !== undefined ? `${detail.memoryDetail.slabMb} MB` : "—"}</span>
                      </div>
                      <div className="profile-kv">
                        <span>Swap used</span>
                        <span>{detail.memoryDetail.swapUsedMb !== undefined ? `${detail.memoryDetail.swapUsedMb} MB` : "—"}</span>
                      </div>
                      <div className="profile-kv">
                        <span>Reclaim</span>
                        <span>{detail.memoryDetail.reclaimActivity ?? "—"}</span>
                      </div>
                    </div>
                    <div className="profile-overview-card">
                      <span className="profile-panel-label">Kernel memory</span>
                      <div className="profile-kv"><span>Slab growth</span><span>{detail.kernelMemory.slabGrowth ?? "—"}</span></div>
                      <div className="profile-kv"><span>Dentry cache</span><span>{detail.kernelMemory.dentryCache ?? "—"}</span></div>
                      <div className="profile-kv"><span>TCP buffers</span><span>{detail.kernelMemory.tcpBuffers ?? "—"}</span></div>
                      <div className="profile-kv"><span>Page reclaim</span><span>{detail.kernelMemory.pageReclaim ?? "—"}</span></div>
                      <div className="profile-kv">
                        <span>Major faults/min</span>
                        <span>{detail.memoryDetail.majorFaultsPerMin ?? "—"}</span>
                      </div>
                    </div>
                    <div className="profile-overview-card profile-overview-wide">
                      <span className="profile-panel-label">Top memory pods</span>
                      <ConsumerTable pods={detail.topPods} processes={detail.topProcesses} />
                    </div>
                  </div>
                ) : null}

                {activeTab === "network" ? (
                  <>
                    <FlameStack frames={detail.stack} label="Network flame stack" />
                    <NetworkLog lines={detail.log} />
                  </>
                ) : null}

                {activeTab === "timeline" ? <TimelineList events={detail.timeline} /> : null}
              </>
            ) : (
              <div className="profile-empty-inner">
                {loading ? "Loading node profile…" : "Select a node to inspect kernel-level profile."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
