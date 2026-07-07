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
import { HotPathStack } from "./profiler/HotPathStack";
import { InsightCards } from "./profiler/InsightCards";
import { InvestigationPanel, type InvestigationTarget } from "./profiler/InvestigationPanel";

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
  const width = 520;
  const sorted = [...frames].sort((a, b) => a.depth - b.depth);
  const height = Math.max(sorted.length, 1) * rowHeight + 8;

  return (
    <div className="profile-flamegraph-wrap">
      <span className="profile-panel-label">{label}</span>
      <svg className="profile-flamegraph" viewBox={`0 0 ${width} ${height}`} aria-hidden>
        {sorted.map((frame) => {
          const y = 4 + frame.depth * rowHeight;
          const blockWidth = Math.max(120, frame.width * (width - 16));
          const x = 8;
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
                {frame.label.length > 48 ? `${frame.label.slice(0, 46)}…` : frame.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PodTable({ pods, onSelect }: { pods: PodConsumer[]; onSelect: (target: InvestigationTarget) => void }) {
  if (pods.length === 0) {
    return <div className="profile-log-empty">No pod memory consumers from agent yet.</div>;
  }

  return (
    <div className="profile-table-wrap">
      <div className="profile-table-head profile-table-head-memory">
        <span>Pod</span>
        <span>Namespace</span>
        <span>RSS</span>
        <span>CPU</span>
      </div>
      {pods.map((pod) => (
        <button
          key={`${pod.namespace}/${pod.pod}`}
          type="button"
          className="profile-table-row profile-table-row-memory profile-table-row-button"
          onClick={() => onSelect({ kind: "pod", namespace: pod.namespace, pod: pod.pod, cpuPercent: pod.cpuPercent, rssMb: pod.rssMb })}
        >
          <span>{pod.pod}</span>
          <span>{pod.namespace}</span>
          <span>{pod.rssMb !== undefined ? `${pod.rssMb}MB` : "—"}</span>
          <span>{pod.cpuPercent !== undefined ? `${pod.cpuPercent.toFixed(1)}%` : "—"}</span>
        </button>
      ))}
    </div>
  );
}

function ProcessTable({
  processes,
  onSelect,
}: {
  processes: ProcessSample[];
  onSelect: (target: InvestigationTarget) => void;
}) {
  if (processes.length === 0) {
    return null;
  }

  return (
    <div className="profile-table-wrap">
      <div className="profile-table-head profile-table-head-procs">
        <span>Process</span>
        <span>PID</span>
        <span>CPU</span>
        <span>RSS</span>
      </div>
      {processes.slice(0, 8).map((proc) => (
        <button
          key={proc.pid}
          type="button"
          className="profile-table-row profile-table-row-procs profile-table-row-button"
          onClick={() =>
            onSelect({
              kind: "process",
              pid: proc.pid,
              name: proc.name,
              namespace: proc.namespace,
              pod: proc.pod,
            })
          }
        >
          <span>{proc.pod ? `${proc.namespace}/${proc.pod}` : proc.name}</span>
          <span>{proc.pid}</span>
          <span>{proc.cpuPercent !== undefined ? `${proc.cpuPercent.toFixed(1)}%` : "—"}</span>
          <span>{proc.rssMb !== undefined ? `${proc.rssMb}MB` : "—"}</span>
        </button>
      ))}
    </div>
  );
}

function HotspotList({
  hotspots,
  onSelect,
}: {
  hotspots: KernelHotspot[];
  onSelect: (target: InvestigationTarget) => void;
}) {
  if (hotspots.length === 0) {
    return null;
  }
  return (
    <div className="profile-hotspots">
      <span className="profile-panel-label">Top kernel functions</span>
      {hotspots.map((hotspot) => (
        <button
          key={hotspot.function}
          type="button"
          className="profile-hotspot-row profile-hotspot-row-button"
          onClick={() =>
            onSelect({
              kind: "kernel",
              function: hotspot.function,
              share: hotspot.share,
              meaning: hotspot.meaning,
            })
          }
        >
          <span className="profile-hotspot-fn">{hotspot.function}</span>
          <span className="profile-hotspot-share">{(hotspot.share * 100).toFixed(0)}%</span>
          <span className="profile-hotspot-meaning">{hotspot.meaning ?? "Kernel path"}</span>
        </button>
      ))}
    </div>
  );
}

function MemoryMapBar({
  usedMb,
  totalMb,
  cacheMb,
  slabMb,
}: {
  usedMb?: number;
  totalMb?: number;
  cacheMb?: number;
  slabMb?: number;
}) {
  if (!totalMb || totalMb <= 0) {
    return null;
  }
  const usedPct = Math.min(100, ((usedMb ?? 0) / totalMb) * 100);
  const cachePct = Math.min(100 - usedPct, ((cacheMb ?? 0) / totalMb) * 100);
  const slabPct = Math.min(100 - usedPct - cachePct, ((slabMb ?? 0) / totalMb) * 100);

  return (
    <div className="profile-memory-map">
      <div className="profile-memory-map-head">
        <strong>{Math.round(totalMb / 1024)} GB node memory</strong>
        <span>{usedMb ?? 0} / {totalMb} MB used</span>
      </div>
      <div className="profile-memory-map-bar" aria-hidden>
        <span className="profile-memory-seg profile-memory-rss" style={{ width: `${usedPct}%` }} />
        <span className="profile-memory-seg profile-memory-cache" style={{ width: `${cachePct}%` }} />
        <span className="profile-memory-seg profile-memory-slab" style={{ width: `${slabPct}%` }} />
      </div>
      <div className="profile-memory-map-legend">
        <span>RSS</span>
        <span>Cache</span>
        <span>Slab</span>
        <span>Free</span>
      </div>
    </div>
  );
}

function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="profile-log-empty">No pressure events on this node in the current sample.</div>;
  }
  return (
    <div className="profile-timeline profile-timeline-narrative">
      {events.map((event, index) => (
        <div key={`${event.timestamp}-${event.title}`} className="profile-timeline-item">
          {index > 0 ? <span className="profile-timeline-connector" aria-hidden>↓</span> : null}
          <div className={`profile-timeline-row profile-timeline-${event.severity}`}>
            <span className="profile-timeline-time">
              {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="profile-timeline-title">{event.title}</span>
            <span className="profile-timeline-detail">{event.detail ?? event.severity}</span>
          </div>
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

function networkMetricsOnly(metrics: ProfileMetric[]): ProfileMetric[] {
  return metrics.filter((metric) => ["P50", "P95", "Drops", "Flows/s"].includes(metric.label));
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
  const [investigationTarget, setInvestigationTarget] = useState<InvestigationTarget | null>(null);
  const { profile, loading, error } = useNodeProfile(connected, selectedNode);

  const activeNode = profile.selected?.name ?? selectedNode ?? profile.nodes[0]?.name;
  const detail = profile.selected;
  const selectedStackLabel = investigationTarget?.kind === "stack" ? investigationTarget.label : undefined;

  const subtitle = useMemo(() => {
    if (!connected) {
      return "Connect a cluster to investigate node kernel behavior";
    }
    if (loading && profile.nodes.length === 0) {
      return "Sampling node pressure, consumers, and inferred hot paths…";
    }
    return "Kernel investigation — hotspots, consumers, pressure, and timeline";
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
        <div className="profile-layout profile-layout-investigation">
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
                    onClick={() => {
                      setSelectedNode(node.name);
                      setInvestigationTarget(null);
                    }}
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
                    <span className="profile-breadcrumb">
                      {detail.name}
                      {investigationTarget?.kind === "pod"
                        ? ` › ${investigationTarget.namespace}/${investigationTarget.pod}`
                        : investigationTarget?.kind === "kernel"
                          ? ` › ${investigationTarget.function}`
                          : investigationTarget?.kind === "stack"
                            ? ` › ${investigationTarget.label}`
                            : ""}
                    </span>
                  </div>
                  <div className="profile-toolbar-right">
                    <span className="profile-toolbar-sample">Sample {detail.sampleSeconds}s</span>
                    <span className={`profile-live${detail.agentLive ? " on" : ""}`}>
                      {detail.agentLive ? "live agent" : detail.cpuPercent !== undefined ? "metrics-server" : "derived"}
                    </span>
                  </div>
                </div>

                <div className="profile-inferred-banner">
                  Live PSI and memory from the agent. CPU stacks and kernel functions are inferred until eBPF sampling lands.
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

                {activeTab === "overview" ? (
                  <>
                    <InsightCards detail={detail} onSelect={setInvestigationTarget} />
                    <HotPathStack
                      frames={detail.cpuStack}
                      label="CPU hot path (inferred)"
                      onSelect={setInvestigationTarget}
                      selectedLabel={selectedStackLabel}
                    />
                    <TimelineList events={detail.timeline.slice(0, 5)} />
                  </>
                ) : null}

                {activeTab === "cpu" ? (
                  <>
                    <HotPathStack
                      frames={detail.cpuStack}
                      label="CPU hot path"
                      onSelect={setInvestigationTarget}
                      selectedLabel={selectedStackLabel}
                    />
                    <HotspotList hotspots={detail.kernelHotspots} onSelect={setInvestigationTarget} />
                    <div className="profile-overview-card profile-overview-wide">
                      <span className="profile-panel-label">Top pods</span>
                      <PodTable pods={detail.topPods} onSelect={setInvestigationTarget} />
                      <span className="profile-panel-label">Processes</span>
                      <ProcessTable processes={detail.topProcesses} onSelect={setInvestigationTarget} />
                    </div>
                  </>
                ) : null}

                {activeTab === "memory" ? (
                  <>
                    <MemoryMapBar
                      usedMb={detail.memoryUsedMb}
                      totalMb={detail.memoryTotalMb}
                      cacheMb={detail.memoryDetail.cacheMb}
                      slabMb={detail.memoryDetail.slabMb}
                    />
                    <div className="profile-memory-grid">
                      <div className="profile-overview-card">
                        <span className="profile-panel-label">Pressure</span>
                        <div className="profile-kv">
                          <span>Memory PSI</span>
                          <span>{psiBadge(detail.psi.memoryLevel)}</span>
                        </div>
                        <div className="profile-kv">
                          <span>Major faults/min</span>
                          <span>{detail.memoryDetail.majorFaultsPerMin ?? "—"}</span>
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
                        <span className="profile-panel-label">Kernel memory health</span>
                        <div className="profile-kv"><span>Slab growth</span><span>{detail.kernelMemory.slabGrowth ?? "—"}</span></div>
                        <div className="profile-kv"><span>Dentry cache</span><span>{detail.kernelMemory.dentryCache ?? "—"}</span></div>
                        <div className="profile-kv"><span>TCP buffers</span><span>{detail.kernelMemory.tcpBuffers ?? "—"}</span></div>
                        <div className="profile-kv"><span>Page reclaim</span><span>{detail.kernelMemory.pageReclaim ?? "—"}</span></div>
                      </div>
                      <div className="profile-overview-card profile-overview-wide">
                        <span className="profile-panel-label">Top memory pods</span>
                        <PodTable pods={detail.topPods} onSelect={setInvestigationTarget} />
                      </div>
                    </div>
                  </>
                ) : null}

                {activeTab === "network" ? (
                  <>
                    <div className="profile-metrics">
                      {networkMetricsOnly(detail.metrics).map((metric: ProfileMetric) => (
                        <div key={metric.label} className="profile-metric">
                          <span className="profile-metric-label">{metric.label}</span>
                          <span className={`profile-metric-value profile-metric-${metric.tone}`}>
                            {metric.value}
                          </span>
                          <Sparkline values={metric.sparkline} tone={metric.tone === "neutral" ? undefined : metric.tone} />
                        </div>
                      ))}
                    </div>
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

          {detail ? (
            <InvestigationPanel
              detail={detail}
              target={investigationTarget}
              onClear={() => setInvestigationTarget(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
