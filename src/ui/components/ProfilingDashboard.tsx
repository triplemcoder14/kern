import { useMemo, useState } from "react";
import { flameColor, flameShareTone } from "../../core/network/flame-colors";
import type {
  KernelHotspot,
  NodeHealth,
  NodeProfileSummary,
  PodConsumer,
  ProcessSample,
  ProfileLogLine,
  ProfileMetric,
  ProfileStackSource,
  TimelineEvent,
} from "../../core/types/profiling";
import { PageHeader } from "./PageHeader";
import { useNodeProfile } from "../hooks/useNodeProfile";
import { MemoryWorkspace } from "./memory/MemoryWorkspace";
import { InsightCards } from "./profiler/InsightCards";
import { InvestigationPanel, type InvestigationTarget } from "./profiler/InvestigationPanel";
import { TraceFlameStack } from "./profiler/TraceFlameStack";

interface ProfilingDashboardProps {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
}

type ProfilerTab = "overview" | "cpu" | "memory" | "network" | "timeline";

function stackSourceBanner(source?: ProfileStackSource, hasCpuFrames?: boolean): string {
  if (source === "ebpf" && hasCpuFrames) {
    return "Live PSI and memory from the agent. CPU flame stacks from eBPF sampling.";
  }
  if (source === "proc" && hasCpuFrames) {
    return "Live PSI and memory from the agent. CPU stacks sampled from /proc.";
  }
  if (source === "ebpf" && !hasCpuFrames) {
    return "Live PSI and memory from the agent. eBPF sampler is attached — waiting for the first CPU stack frames.";
  }
  return "Live PSI and memory from the agent. Waiting for eBPF stack samples on this node.";
}

function cpuStackLabel(source?: ProfileStackSource): string {
  if (source === "ebpf") {
    return "Node performance flamegraph (eBPF)";
  }
  if (source === "proc") {
    return "Node performance flamegraph (/proc)";
  }
  return "Node performance flamegraph";
}

/** Keep root + frames belonging to pods in the selected Kubernetes namespace. */
function scopeCpuFrames<T extends { depth: number; offset: number; width: number; namespace?: string; label: string }>(
  frames: T[],
  namespace: string,
): T[] {
  if (!namespace || namespace === "all") {
    return frames;
  }
  const pods = frames.filter(
    (frame) => frame.depth === 1 && frame.namespace === namespace,
  );
  if (pods.length === 0) {
    return frames.filter((frame) => frame.depth === 0 || frame.label === "all");
  }
  return frames.filter((frame) => {
    if (frame.depth === 0 || frame.label === "all") {
      return true;
    }
    return pods.some(
      (pod) =>
        frame.offset >= pod.offset - 0.0001 &&
        frame.offset + frame.width <= pod.offset + pod.width + 0.0001,
    );
  });
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

function PodTable({ pods, onSelect }: { pods: PodConsumer[]; onSelect: (target: InvestigationTarget) => void }) {
  if (pods.length === 0) {
    return <div className="profile-log-empty">No memory consumers on this node yet.</div>;
  }

  return (
    <div className="profile-table-wrap">
      <div className="profile-table-head profile-table-head-memory">
        <span>Pod</span>
        <span>Namespace</span>
        <span>RSS</span>
        <span>Cache</span>
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
          <span>{pod.cacheMb !== undefined ? `${pod.cacheMb}MB` : "—"}</span>
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
      {hotspots.map((hotspot) => {
        const pct = hotspot.share * 100;
        const tone = flameShareTone(pct);
        return (
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
            <span
              className={`profile-hotspot-share profile-hotspot-share-${tone}`}
              style={{ color: flameColor(Math.min(1, hotspot.share * 2.2)) }}
            >
              {pct.toFixed(0)}%
            </span>
            <span className="profile-hotspot-meaning">{hotspot.meaning ?? "Kernel path"}</span>
          </button>
        );
      })}
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

  const scopedPods = useMemo(() => {
    if (!detail) {
      return [];
    }
    if (!namespace || namespace === "all") {
      return detail.topPods;
    }
    return detail.topPods.filter((pod) => pod.namespace === namespace);
  }, [detail, namespace]);

  const scopedContainers = useMemo(() => {
    if (!detail) {
      return [];
    }
    const containers = detail.topContainers ?? [];
    if (!namespace || namespace === "all") {
      return containers;
    }
    return containers.filter((container) => container.namespace === namespace);
  }, [detail, namespace]);

  const scopedProcesses = useMemo(() => {
    if (!detail) {
      return [];
    }
    if (!namespace || namespace === "all") {
      return detail.topProcesses;
    }
    return detail.topProcesses.filter((proc) => proc.namespace === namespace);
  }, [detail, namespace]);

  const scopedCpuStack = useMemo(() => {
    if (!detail) {
      return [];
    }
    return scopeCpuFrames(detail.cpuStack, namespace);
  }, [detail, namespace]);

  const scopedNetworkStack = useMemo(() => {
    if (!detail) {
      return [];
    }
    if (!namespace || namespace === "all") {
      return detail.stack;
    }
    return detail.stack.filter(
      (frame) => frame.depth <= 1 || frame.namespace === namespace,
    );
  }, [detail, namespace]);

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
            <div className="profile-nodes-list" role="listbox" aria-label="Cluster nodes">
              {profile.nodes.length === 0 ? (
                <p className="profile-nodes-empty">{loading ? "Loading nodes…" : "No nodes found"}</p>
              ) : (
                profile.nodes.map((node: NodeProfileSummary) => (
                  <button
                    key={node.name}
                    type="button"
                    role="option"
                    aria-selected={activeNode === node.name}
                    className={`profile-node${activeNode === node.name ? " profile-node-active" : ""}`}
                    onClick={() => {
                      setSelectedNode(node.name);
                      setInvestigationTarget(null);
                    }}
                  >
                    <span className="profile-node-row">
                      <span className={`profile-health profile-health-${node.health}`} aria-hidden />
                      <span className="profile-node-name">{node.name}</span>
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
                  {stackSourceBanner(detail.stackSource, scopedCpuStack.length > 0)}
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
                    <TraceFlameStack
                      frames={scopedCpuStack}
                      label={cpuStackLabel(detail.stackSource)}
                      variant="cpu"
                      onSelect={setInvestigationTarget}
                      selectedLabel={selectedStackLabel}
                    />
                    <TimelineList events={detail.timeline.slice(0, 5)} />
                  </>
                ) : null}

                {activeTab === "cpu" ? (
                  <>
                    <TraceFlameStack
                      frames={scopedCpuStack}
                      label={cpuStackLabel(detail.stackSource)}
                      variant="cpu"
                      onSelect={setInvestigationTarget}
                      selectedLabel={selectedStackLabel}
                    />
                    <HotspotList hotspots={detail.kernelHotspots} onSelect={setInvestigationTarget} />
                    <div className="profile-overview-card profile-overview-wide">
                      <span className="profile-panel-label">Top pods</span>
                      <PodTable pods={scopedPods} onSelect={setInvestigationTarget} />
                      <span className="profile-panel-label">Processes</span>
                      <ProcessTable processes={scopedProcesses} onSelect={setInvestigationTarget} />
                    </div>
                  </>
                ) : null}

                {activeTab === "memory" ? (
                  <MemoryWorkspace
                    detail={detail}
                    pods={scopedPods}
                    containers={scopedContainers}
                    processes={scopedProcesses}
                    namespace={namespace}
                    onInvestigate={setInvestigationTarget}
                    investigationTarget={investigationTarget}
                  />
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
                    <TraceFlameStack frames={scopedNetworkStack} label="Network flame graph" variant="network" />
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
