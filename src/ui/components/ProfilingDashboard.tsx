import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flameColor, flameShareTone } from "../../core/network/flame-colors";
import type {
  KernelHotspot,
  NodeHealth,
  NodeProfileDetail,
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
import type { InvestigationNextStep } from "./profiler/investigation-workflow";
import { TraceFlameStack } from "./profiler/TraceFlameStack";
import type { InvestigationFocus } from "../investigation/types";
import {
  climbInvestigation,
  drillToPod,
  drillToProcess,
  investigationLabel,
  investigationLevel,
  type InvestigationLevel,
} from "../investigation/types";
import { resolveInvestigationNode, podMatchesInvestigation } from "../investigation/resolve-node";
import { filterDetailForWorkloadFocus } from "../investigation/filter-profile-for-focus";
import { InvestigationHierarchy } from "../investigation/InvestigationHierarchy";
import { normalizeProfileDetail } from "../../lib/profile-cache";
import { prefetchProfileSnapshot } from "../../lib/profile-api";

type ProfilerTab = "overview" | "cpu" | "memory" | "network" | "timeline";

interface ProfilingDashboardProps {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  investigation?: InvestigationFocus | null;
  /** Open on this profiler tab (Investigate CPU → "cpu"). */
  initialTab?: ProfilerTab;
  /** Update drill-down level / restore stashed workload focus. */
  onInvestigationChange?: (focus: InvestigationFocus) => void;
  /** Switch to node investigation (clear workload focus). */
  onExitInvestigation?: () => void;
}

function cpuStackLabel(source?: ProfileStackSource): string {
  // if (source === "ebpf") {
  //   return "Node performance flamegraph (eBPF)";
  // }
  // if (source === "proc") {
  //   return "Node performance flamegraph (/proc)";
  // }
  // return "Node performance flamegraph";
  void source;
  return "CPU flamegraph";
}

/** Keep root + frames belonging to pods in the selected Kubernetes namespace. */
function isCpuRootLabel(label: string): boolean {
  return label === "all" || label === "Node CPU" || label === "CPU Samples";
}

function scopeCpuFrames<T extends { depth: number; offset: number; width: number; namespace?: string; label: string; subtitle?: string }>(
  frames: T[],
  namespace: string,
  workloadNames: string[] = [],
  options?: { pod?: string; pid?: number; processName?: string },
): T[] {
  if (!namespace || namespace === "all") {
    if (workloadNames.length === 0 && !options?.pod) {
      return frames;
    }
  }
  const nsFrames =
    !namespace || namespace === "all"
      ? frames
      : (() => {
          const pods = frames.filter(
            (frame) => frame.depth === 1 && frame.namespace === namespace,
          );
          if (pods.length === 0) {
            // return frames.filter((frame) => frame.depth === 0 || isCpuRootLabel(frame.label));
            // Merged eBPF pyramid has no pod lanes — keep the full stack under namespace filter.
            return frames;
          }
          return frames.filter((frame) => {
            if (frame.depth === 0 || isCpuRootLabel(frame.label)) {
              return true;
            }
            return pods.some(
              (pod) =>
                frame.offset >= pod.offset - 0.0001 &&
                frame.offset + frame.width <= pod.offset + pod.width + 0.0001,
            );
          });
        })();

  const matchesWorkload = (label: string) =>
    workloadNames.some(
      (name) => label === name || label.startsWith(`${name}-`) || label.includes(`/${name}`),
    );

  let scoped = nsFrames;
  if (workloadNames.length > 0) {
    const workloadPods = nsFrames.filter(
      (frame) => frame.depth === 1 && matchesWorkload(frame.label),
    );
    if (workloadPods.length > 0) {
      scoped = nsFrames.filter((frame) => {
        if (frame.depth === 0 || isCpuRootLabel(frame.label)) {
          return true;
        }
        return workloadPods.some(
          (pod) =>
            frame.offset >= pod.offset - 0.0001 &&
            frame.offset + frame.width <= pod.offset + pod.width + 0.0001,
        );
      });
    }
  }

  // Drill to a single pod lane when the hierarchy is at pod/process level.
  if (options?.pod) {
    const podLanes = scoped.filter(
      (frame) =>
        frame.depth === 1 &&
        (frame.label === options.pod || frame.label.startsWith(`${options.pod}-`)),
    );
    if (podLanes.length > 0) {
      scoped = scoped.filter((frame) => {
        if (frame.depth === 0 || isCpuRootLabel(frame.label)) {
          return true;
        }
        return podLanes.some(
          (pod) =>
            frame.offset >= pod.offset - 0.0001 &&
            frame.offset + frame.width <= pod.offset + pod.width + 0.0001,
        );
      });
    }
  }

  // Process drill: keep frames that mention the PID / process name when present.
  if (options?.pid !== undefined || options?.processName) {
    const pidNeedle = options.pid !== undefined ? String(options.pid) : "";
    const nameNeedle = options.processName?.toLowerCase() ?? "";
    const hits = scoped.filter((frame) => {
      if (frame.depth === 0 || isCpuRootLabel(frame.label)) {
        return false;
      }
      const blob = `${frame.label} ${frame.subtitle ?? ""}`.toLowerCase();
      if (pidNeedle && (blob.includes(`pid ${pidNeedle}`) || blob.includes(pidNeedle))) {
        return true;
      }
      if (nameNeedle && blob.includes(nameNeedle)) {
        return true;
      }
      return false;
    });
    if (hits.length > 0) {
      const keep = new Set<T>();
      for (const hit of hits) {
        keep.add(hit);
        for (const ancestor of scoped) {
          if (
            ancestor.depth < hit.depth &&
            hit.offset >= ancestor.offset - 0.0001 &&
            hit.offset + hit.width <= ancestor.offset + ancestor.width + 0.0001
          ) {
            keep.add(ancestor);
          }
        }
      }
      scoped = scoped.filter((frame) => keep.has(frame));
    }
  }

  return scoped;
}

// resolveInvestigationNode / podMatchesInvestigation live in ../investigation/resolve-node.ts

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

function nodeDegradeReason(detail: {
  health: NodeHealth;
  cpuPercent?: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  psi?: { cpuAvg10?: number; memoryAvg10?: number };
  psiCpuLevel?: string;
  psiMemoryLevel?: string;
}): { reason: string; parts: string[] } | null {
  if (detail.health === "ok") {
    return null;
  }
  const memPct =
    detail.memoryUsedMb !== undefined && detail.memoryTotalMb
      ? Math.round((detail.memoryUsedMb / detail.memoryTotalMb) * 100)
      : undefined;
  const parts: string[] = [];
  if (detail.cpuPercent !== undefined) {
    parts.push(`CPU ${detail.cpuPercent.toFixed(0)}%`);
  }
  if (memPct !== undefined) {
    parts.push(`Memory ${memPct}%`);
  }
  const psiCpu = detail.psi?.cpuAvg10;
  const psiMem = detail.psi?.memoryAvg10;
  if (psiCpu !== undefined && psiCpu >= 0.1) {
    parts.push(`PSI ${psiCpu.toFixed(2)}`);
  } else if (detail.psiCpuLevel && detail.psiCpuLevel !== "normal") {
    parts.push(`PSI ${psiBadge(detail.psiCpuLevel)}`);
  }

  let reason = "Pressure detected";
  if ((psiMem !== undefined && psiMem >= 0.2) || detail.psiMemoryLevel === "critical" || detail.psiMemoryLevel === "warn") {
    reason = "Memory pressure";
  } else if ((psiCpu !== undefined && psiCpu >= 0.2) || detail.psiCpuLevel === "critical" || detail.psiCpuLevel === "warn") {
    reason = "CPU pressure";
  } else if (memPct !== undefined && memPct >= 85) {
    reason = "High memory use";
  } else if ((detail.cpuPercent ?? 0) >= 80) {
    reason = "High CPU use";
  }

  return { reason, parts };
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

function CpuShareBar({ percent }: { percent?: number }) {
  if (percent === undefined) {
    return <span className="profile-cpu-bar-empty">—</span>;
  }
  const width = Math.max(2, Math.min(100, percent));
  const tone = flameShareTone(percent);
  return (
    <span className="profile-cpu-bar" title={`${percent.toFixed(1)}%`}>
      <span className="profile-cpu-bar-track" aria-hidden>
        <span className={`profile-cpu-bar-fill profile-cpu-bar-fill-${tone}`} style={{ width: `${width}%` }} />
      </span>
      <span className="profile-cpu-bar-label">{percent.toFixed(1)}%</span>
    </span>
  );
}

function memoryMbLabel(pod: PodConsumer): string {
  // Prefer working set when cache column would otherwise be empty dashes.
  const mb = pod.workingSetMb ?? pod.rssMb;
  return mb !== undefined ? `${mb}MB` : "—";
}

function selectionPodKey(target: InvestigationTarget | null): string | null {
  if (!target) {
    return null;
  }
  if (target.kind === "pod") {
    return `${target.namespace}/${target.pod}`;
  }
  if (target.kind === "process" && target.pod) {
    return `${target.namespace ?? ""}/${target.pod}`;
  }
  if (target.kind === "stack") {
    if (target.depth === 1) {
      return target.namespace ? `${target.namespace}/${target.label}` : target.label;
    }
    if (target.path?.includes("/")) {
      return target.path;
    }
  }
  return null;
}

function selectionPid(target: InvestigationTarget | null): number | null {
  if (!target) {
    return null;
  }
  if (target.kind === "process") {
    return target.pid;
  }
  if (target.kind === "stack" && target.depth === 2 && target.subtitle && /^\d+$/.test(target.subtitle)) {
    return Number(target.subtitle);
  }
  return null;
}

function selectionKernelFn(target: InvestigationTarget | null): string | null {
  if (!target) {
    return null;
  }
  if (target.kind === "kernel") {
    return target.function;
  }
  if (target.kind === "stack" && (target.depth ?? 0) >= 3) {
    return target.label;
  }
  return null;
}

function PodTable({
  pods,
  onSelect,
  selected,
}: {
  pods: PodConsumer[];
  onSelect: (target: InvestigationTarget) => void;
  selected: InvestigationTarget | null;
}) {
  if (pods.length === 0) {
    return <div className="profile-log-empty">No CPU consumers on this node yet.</div>;
  }

  const focusPod = selectionPodKey(selected);
  const ranked = [...pods].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0));

  return (
    <div className="profile-table-wrap">
      {/* <div className="profile-table-head profile-table-head-memory">
        <span>Pod</span>
        <span>Namespace</span>
        <span>RSS</span>
        <span>Cache</span>
        <span>CPU</span>
      </div> */}
      <div className="profile-table-head profile-table-head-cpu-pods">
        <span>Pod</span>
        <span>CPU</span>
        <span>Working set</span>
        <span>Namespace</span>
      </div>
      {ranked.map((pod) => {
        const key = `${pod.namespace}/${pod.pod}`;
        const active = focusPod === key || focusPod === pod.pod;
        const dimmed = Boolean(focusPod) && !active;
        return (
          <button
            key={key}
            type="button"
            className={`profile-table-row profile-table-row-cpu-pods profile-table-row-button${active ? " profile-table-row-active" : ""}${dimmed ? " profile-table-row-dimmed" : ""}`}
            onClick={() =>
              onSelect({
                kind: "pod",
                namespace: pod.namespace,
                pod: pod.pod,
                cpuPercent: pod.cpuPercent,
                rssMb: pod.rssMb,
              })
            }
          >
            <span>{pod.pod}</span>
            <CpuShareBar percent={pod.cpuPercent} />
            <span>{memoryMbLabel(pod)}</span>
            <span>{pod.namespace}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProcessTable({
  processes,
  onSelect,
  selected,
}: {
  processes: ProcessSample[];
  onSelect: (target: InvestigationTarget) => void;
  selected: InvestigationTarget | null;
}) {
  if (processes.length === 0) {
    return null;
  }

  const focusPid = selectionPid(selected);
  const focusPod = selectionPodKey(selected);
  const ranked = [...processes].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0));

  return (
    <div className="profile-table-wrap">
      {/* <div className="profile-table-head profile-table-head-procs">
        <span>Process</span>
        <span>PID</span>
        <span>CPU</span>
        <span>RSS</span>
      </div> */}
      <div className="profile-table-head profile-table-head-cpu-procs">
        <span>Process</span>
        <span>CPU</span>
        <span>RSS</span>
        <span>Pod</span>
      </div>
      {ranked.slice(0, 8).map((proc) => {
        const active =
          focusPid === proc.pid ||
          (focusPod !== null &&
            proc.pod !== undefined &&
            (focusPod === `${proc.namespace ?? ""}/${proc.pod}` || focusPod === proc.pod));
        const dimmed = Boolean(focusPid || focusPod) && !active;
        return (
          <button
            key={proc.pid}
            type="button"
            className={`profile-table-row profile-table-row-cpu-procs profile-table-row-button${active ? " profile-table-row-active" : ""}${dimmed ? " profile-table-row-dimmed" : ""}`}
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
            <span className="profile-proc-name">
              <span className="profile-proc-name-main">{proc.name}</span>
              <span className="profile-proc-name-sub">PID {proc.pid}</span>
            </span>
            <CpuShareBar percent={proc.cpuPercent} />
            <span>{proc.rssMb !== undefined ? `${proc.rssMb}MB` : "—"}</span>
            {/* <span>{proc.pod ? proc.pod : "node"}</span> */}
            <span className={!proc.pod ? "profile-proc-pod-host" : undefined}>
              {proc.pod ? proc.pod : "host"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HotspotList({
  hotspots,
  onSelect,
  selected,
}: {
  hotspots: KernelHotspot[];
  onSelect: (target: InvestigationTarget) => void;
  selected: InvestigationTarget | null;
}) {
  const meaningful = hotspots.filter((hotspot) => {
    const name = hotspot.function.toLowerCase();
    return !(
      name.startsWith("el0") ||
      name.includes("invoke_syscall") ||
      name.includes("do_el0_svc") ||
      name.includes("entry_syscall")
    );
  });
  const rows = meaningful.length > 0 ? meaningful : hotspots;
  if (rows.length === 0) {
    return null;
  }

  const focusFn = selectionKernelFn(selected);
  const grouped = new Map<string, KernelHotspot[]>();
  for (const hotspot of rows) {
    const category = hotspot.category ?? "Other";
    const list = grouped.get(category) ?? [];
    list.push(hotspot);
    grouped.set(category, list);
  }

  return (
    <div className="profile-hotspots">
      {/* <span className="profile-panel-label">Top kernel functions</span> */}
      <span className="profile-panel-label">Kernel hotspots</span>
      {[...grouped.entries()].map(([category, items]) => (
        <div key={category} className="profile-hotspot-group">
          <span className="profile-hotspot-category">{category}</span>
          {items.map((hotspot) => {
            const pct = hotspot.share * 100;
            const tone = flameShareTone(pct);
            const active = focusFn === hotspot.function;
            const dimmed = Boolean(focusFn) && !active;
            return (
              <button
                key={hotspot.function}
                type="button"
                className={`profile-hotspot-row profile-hotspot-row-button${active ? " profile-table-row-active" : ""}${dimmed ? " profile-table-row-dimmed" : ""}`}
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
      ))}
    </div>
  );
}
void HotspotList;

function TimelineList({
  events,
  emptyHint,
}: {
  events: TimelineEvent[];
  emptyHint?: string;
}) {
  if (events.length === 0) {
    return (
      <div className="profile-log-empty">
        {emptyHint ?? "No pressure events on this node in the current sample."}
      </div>
    );
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

function NetworkLog({
  lines,
  emptyHint,
}: {
  lines: ProfileLogLine[];
  emptyHint?: string;
}) {
  return (
    <div className="profile-events">
      <div className="profile-events-head">
        <span>Time</span>
        <span>Sev</span>
        <span>Event</span>
        <span>Value</span>
      </div>
      {lines.length === 0 ? (
        <div className="profile-log-empty">
          {emptyHint ?? "No network pressure signals on this node."}
        </div>
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
  // return metrics.filter((metric) => ["P50", "P95", "Drops", "Flows/s"].includes(metric.label));
  return metrics.filter((metric) =>
    ["P50", "P95", "Drops", "Flows/s", "Flows"].includes(metric.label),
  );
}

export function ProfilingDashboard({
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
  investigation = null,
  initialTab = "overview",
  onInvestigationChange,
  onExitInvestigation,
}: ProfilingDashboardProps) {
  const [selectedNode, setSelectedNode] = useState<string | undefined>(
    () => investigation?.nodeName,
  );
  // const [activeTab, setActiveTab] = useState<ProfilerTab>("overview");
  const [activeTab, setActiveTab] = useState<ProfilerTab>(initialTab);
  const [investigationTarget, setInvestigationTarget] = useState<InvestigationTarget | null>(null);
  const [flamePaused, setFlamePaused] = useState(false);
  const [flameCommand, setFlameCommand] = useState<InvestigationNextStep | null>(null);
  const [flameCommandSeq, setFlameCommandSeq] = useState(0);
  const profilerTabsRef = useRef<HTMLDivElement>(null);
  const userPickedNodeRef = useRef(false);
  /** Last workload focus so Node → Workload mode can restore after clearing. */
  const [stashedInvestigation, setStashedInvestigation] = useState<InvestigationFocus | null>(null);
  /** Keep main panel painted while a node profile is in flight. */
  const lastDetailRef = useRef<NodeProfileDetail | null>(null);

  // Investigate CPU (and similar) should land on the requested tab, not Overview.
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, investigation?.startedAt]);

  useEffect(() => {
    if (investigation) {
      setStashedInvestigation(investigation);
    }
  }, [investigation]);

  const selectClusterNode = (nodeName: string) => {
    const previous = selectedNode ?? investigation?.nodeName;
    const switching =
      Boolean(previous) &&
      previous !== nodeName &&
      previous?.split(".")[0] !== nodeName.split(".")[0];

    userPickedNodeRef.current = true;
    setSelectedNode(nodeName);
    setInvestigationTarget(null);
    setFlameCommand(null);
    setFlamePaused(false);
    lastDetailRef.current = null;

    // Switching nodes always lands on Overview for that node — not the prior node's tab.
    if (switching) {
      setActiveTab("overview");
    }

    void prefetchProfileSnapshot(nodeName).catch(() => undefined);
  };

  const scrollToProfilerSelection = () => {
    // Related views are often clicked while scrolled down the investigation rail —
    // bring the tab strip + workspace into view so the switched surface is obvious.
    requestAnimationFrame(() => {
      profilerTabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const navigateProfiler = (target: "memory" | "network" | "events" | "profiling") => {
    if (target === "memory") {
      setActiveTab("memory");
    } else if (target === "network") {
      setActiveTab("network");
    } else if (target === "events") {
      setActiveTab("timeline");
    } else {
      setActiveTab("cpu");
    }
    scrollToProfilerSelection();
  };

  const dispatchFlameCommand = (step: InvestigationNextStep) => {
    if (step.action === "navigate" && step.nav) {
      navigateProfiler(step.nav);
      return;
    }
    // Focus / kernel / userspace actions need the CPU flame mounted.
    if (activeTab !== "overview" && activeTab !== "cpu") {
      setActiveTab("cpu");
      scrollToProfilerSelection();
    }
    setFlameCommand(step);
    setFlameCommandSeq((n) => n + 1);
  };

  const handleExitToNode = () => {
    if (investigation) {
      setStashedInvestigation(investigation);
    }
    onExitInvestigation?.();
    setInvestigationTarget(null);
  };

  const handleClimb = (level: InvestigationLevel) => {
    // Workload mode only makes sense once an investigation was started (or stashed).
    if (!investigation) {
      if (stashedInvestigation) {
        onInvestigationChange?.(climbInvestigation(stashedInvestigation, "workload"));
      }
      return;
    }
    onInvestigationChange?.(climbInvestigation(investigation, level));
  };

  const handleSelectTarget = (target: InvestigationTarget) => {
    setInvestigationTarget(target);
    if (!investigation || !onInvestigationChange) {
      return;
    }
    if (target.kind === "pod") {
      onInvestigationChange(drillToPod(investigation, target.pod));
      return;
    }
    if (target.kind === "process") {
      onInvestigationChange(
        drillToProcess(investigation, target.pid, target.name, target.pod),
      );
    }
  };

  // Reset manual node override whenever the investigation target changes.
  useEffect(() => {
    userPickedNodeRef.current = false;
    if (investigation?.nodeName) {
      setSelectedNode(investigation.nodeName);
    }
  }, [investigation?.namespace, investigation?.name, investigation?.nodeName]);

  // Fetch for the investigated node as soon as we know it (pre-resolved or user-selected).
  // const { profile, loading, error } = useNodeProfile(connected, selectedNode, { paused: flamePaused });
  const profileNode = selectedNode ?? investigation?.nodeName;
  const { profile, loading, error } = useNodeProfile(connected, profileNode, {
    paused: flamePaused,
  });

  const resolvedNode = useMemo(
    () =>
      investigation
        ? resolveInvestigationNode(investigation, profile.podPlacements, profile.nodes)
        : undefined,
    [investigation, profile.podPlacements, profile.nodes],
  );

  // Force-select the scheduled node once placements arrive (e.g. traffic-gen → k8s-w2).
  useLayoutEffect(() => {
    if (!investigation || userPickedNodeRef.current) {
      return;
    }
    const target = investigation.nodeName ?? resolvedNode;
    if (!target || selectedNode === target) {
      return;
    }
    setSelectedNode(target);
  }, [investigation, investigation?.nodeName, resolvedNode, selectedNode]);

  // const activeNode = selectedNode ?? profile.selected?.name ?? profile.nodes[0]?.name;
  const activeNode =
    selectedNode ??
    investigation?.nodeName ??
    resolvedNode ??
    profile.selected?.name ??
    profile.nodes[0]?.name;
  // const detail = profile.selected;
  const detailMatchesActive = (name?: string) => {
    if (!name || !activeNode) {
      return Boolean(name);
    }
    return name === activeNode || name.split(".")[0] === activeNode.split(".")[0];
  };
  if (profile.selected && detailMatchesActive(profile.selected.name)) {
    lastDetailRef.current = normalizeProfileDetail(profile.selected);
  } else if (activeNode && lastDetailRef.current && !detailMatchesActive(lastDetailRef.current.name)) {
    // Drop held detail from a different node (was showing k8s-cp while on k8s-w3).
    lastDetailRef.current = null;
  }
  const detail =
    profile.selected && detailMatchesActive(profile.selected.name)
      ? normalizeProfileDetail(profile.selected)
      : lastDetailRef.current && detailMatchesActive(lastDetailRef.current.name)
        ? lastDetailRef.current
        : null;
  const detailStale = Boolean(
    detail && (!profile.selected || !detailMatchesActive(profile.selected.name)),
  );
  const selectedStackLabel = investigationTarget?.kind === "stack" ? investigationTarget.label : undefined;
  const frameCrumbLabel =
    investigationTarget?.kind === "stack"
      ? investigationTarget.label
      : investigationTarget?.kind === "kernel"
        ? investigationTarget.function
        : undefined;
  const focusLevel = investigation ? investigationLevel(investigation) : "workload";

  const scopedPods = useMemo(() => {
    if (!detail) {
      return [];
    }
    let pods =
      !namespace || namespace === "all"
        ? detail.topPods ?? []
        : (detail.topPods ?? []).filter((pod) => pod.namespace === namespace);
    if (investigation?.name) {
      pods = pods.filter((pod) =>
        podMatchesInvestigation(pod.pod, pod.namespace, investigation),
      );
      if ((focusLevel === "pod" || focusLevel === "process") && investigation.pod) {
        pods = pods.filter((pod) => pod.pod === investigation.pod);
      }
    }
    return pods;
  }, [detail, namespace, investigation, focusLevel]);

  const scopedContainers = useMemo(() => {
    if (!detail) {
      return [];
    }
    const containers = detail.topContainers ?? [];
    let scoped =
      !namespace || namespace === "all"
        ? containers
        : containers.filter((container) => container.namespace === namespace);
    if (investigation?.name) {
      scoped = scoped.filter((container) =>
        podMatchesInvestigation(container.pod, container.namespace, investigation),
      );
      if ((focusLevel === "pod" || focusLevel === "process") && investigation.pod) {
        scoped = scoped.filter((container) => container.pod === investigation.pod);
      }
    }
    return scoped;
  }, [detail, namespace, investigation, focusLevel]);

  const scopedProcesses = useMemo(() => {
    if (!detail) {
      return [];
    }
    let procs =
      !namespace || namespace === "all"
        ? detail.topProcesses ?? []
        : (detail.topProcesses ?? []).filter((proc) => proc.namespace === namespace);
    if (investigation?.name) {
      procs = procs.filter(
        (proc) =>
          !proc.pod ||
          podMatchesInvestigation(proc.pod, proc.namespace, investigation),
      );
      if ((focusLevel === "pod" || focusLevel === "process") && investigation.pod) {
        procs = procs.filter((proc) => proc.pod === investigation.pod);
      }
      if (focusLevel === "process" && investigation.pid !== undefined) {
        procs = procs.filter((proc) => proc.pid === investigation.pid);
      }
    }
    return procs;
  }, [detail, namespace, investigation, focusLevel]);

  const workloadNames = useMemo(() => {
    if (!investigation) {
      return [] as string[];
    }
    const names = new Set<string>([investigation.name, ...(investigation.memberPods ?? [])]);
    if (investigation.pod) {
      names.add(investigation.pod);
    }
    return [...names];
  }, [investigation]);

  const scopedCpuStack = useMemo(() => {
    if (!detail) {
      return [];
    }
    // return scopeCpuFrames(detail.cpuStack, namespace);
    return scopeCpuFrames(detail.cpuStack ?? [], namespace, workloadNames, {
      pod: focusLevel === "pod" || focusLevel === "process" ? investigation?.pod : undefined,
      pid: focusLevel === "process" ? investigation?.pid : undefined,
      processName: focusLevel === "process" ? investigation?.processName : undefined,
    });
  }, [detail, namespace, workloadNames, investigation, focusLevel]);

  // Previous: network flame only cut by namespace — still showed the whole node's traffic.
  // const scopedNetworkStack = useMemo(() => {
  //   if (!detail) {
  //     return [];
  //   }
  //   if (!namespace || namespace === "all") {
  //     return detail.stack;
  //   }
  //   return detail.stack.filter(
  //     (frame) => frame.depth <= 1 || frame.namespace === namespace,
  //   );
  // }, [detail, namespace]);
  const workloadScoped = useMemo(() => {
    if (!detail) {
      return null;
    }
    return filterDetailForWorkloadFocus(detail, investigation);
  }, [detail, investigation]);

  const scopedNetworkStack = workloadScoped?.stack ?? [];
  const scopedNetworkLog = workloadScoped?.log ?? [];
  const scopedTimeline = workloadScoped?.timeline ?? [];
  const scopedNetworkMetrics = workloadScoped?.networkMetrics ?? [];

  const subtitle = useMemo(() => {
    if (!connected) {
      return "Connect a cluster to investigate node kernel behavior";
    }
    if (investigation) {
      const nodeHint = selectedNode ? ` on ${selectedNode}` : "";
      const levelHint =
        focusLevel === "process" && investigation.pid !== undefined
          ? ` · PID ${investigation.pid}`
          : focusLevel === "pod" && investigation.pod
            ? ` · pod ${investigation.pod}`
            : "";
      // return `Investigating ${investigationLabel(investigation)}${nodeHint} — CPU filtered to this workload`;
      return `Workload investigation · ${investigationLabel(investigation)}${levelHint}${nodeHint} — CPU, memory, network & timeline scoped to this workload`;
    }
    if (loading && profile.nodes.length === 0) {
      return "Sampling node pressure, consumers, and inferred hot paths…";
    }
    return "Node investigation — hotspots, consumers, pressure, and timeline";
  }, [connected, loading, profile.nodes.length, investigation, selectedNode, focusLevel]);

  const insightDetail = useMemo(() => {
    if (!detail || !investigation) {
      return detail;
    }
    return {
      ...detail,
      topPods: scopedPods,
      topProcesses: scopedProcesses.length > 0 ? scopedProcesses : detail.topProcesses,
      topContainers: scopedContainers,
    };
  }, [detail, investigation, scopedPods, scopedProcesses, scopedContainers]);

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
        // title="Profiler"
        // title={investigation ? `Profiler · ${investigationLabel(investigation)}` : "Profiler"}
        title={investigation ? `Profiler · ${investigationLabel(investigation)}` : "Profiler"}
        subtitle={subtitle}
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
      />

      <InvestigationHierarchy
        focus={investigation}
        activeNode={activeNode}
        frameLabel={frameCrumbLabel}
        onExitToNode={handleExitToNode}
        onClimb={handleClimb}
        canEnterWorkload={Boolean(stashedInvestigation)}
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
                    // onClick={() => {
                    //   setSelectedNode(node.name);
                    //   setInvestigationTarget(null);
                    // }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      selectClusterNode(node.name);
                    }}
                    onClick={(event) => {
                      // Keep click for keyboard / accessibility; pointerdown already selected.
                      event.preventDefault();
                      selectClusterNode(node.name);
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
                    {loading || detailStale || (activeNode && detail.name !== activeNode) ? (
                      <span className="profile-toolbar-updating">Updating samples…</span>
                    ) : null}
                    {(() => {
                      const degrade = nodeDegradeReason({
                        health: detail.health,
                        cpuPercent: detail.cpuPercent,
                        memoryUsedMb: detail.memoryUsedMb,
                        memoryTotalMb: detail.memoryTotalMb,
                        psi: detail.psi,
                        psiCpuLevel: detail.psi?.cpuLevel,
                        psiMemoryLevel: detail.psi?.memoryLevel,
                      });
                      if (!degrade) {
                        return null;
                      }
                      return (
                        <span className="profile-degrade-reason" title={degrade.parts.join(" · ")}>
                          {degrade.reason}
                          {degrade.parts.length > 0 ? ` · ${degrade.parts.join(" · ")}` : ""}
                        </span>
                      );
                    })()}
                    <span className="profile-breadcrumb">
                      {detail.name}
                      {investigation
                        ? ` › ${investigationLabel(investigation)}`
                        : ""}
                      {investigation?.pod ? ` › ${investigation.pod}` : ""}
                      {investigation?.pid !== undefined
                        ? ` › PID ${investigation.pid}`
                        : ""}
                      {investigationTarget?.kind === "kernel"
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

                <div className="profile-tabs" role="tablist" ref={profilerTabsRef}>
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
                    <InsightCards detail={insightDetail ?? detail} onSelect={handleSelectTarget} />
                    <TraceFlameStack
                      frames={scopedCpuStack}
                      label={cpuStackLabel(detail.stackSource)}
                      variant="cpu"
                      onSelect={handleSelectTarget}
                      selectedLabel={selectedStackLabel}
                      sampleSeconds={detail.sampleSeconds}
                      sampleHz={20}
                      nodeName={detail.name}
                      paused={flamePaused}
                      onPausedChange={setFlamePaused}
                      processes={detail.topProcesses}
                      // processes={scopedProcesses} — scoped list can drop ownership metadata for other namespaces
                      onNavigate={navigateProfiler}
                      command={flameCommand}
                      commandSeq={flameCommandSeq}
                      onCommandHandled={() => setFlameCommand(null)}
                    />
                    {/* <TimelineList events={detail.timeline.slice(0, 5)} /> */}
                    <TimelineList
                      events={(investigation ? scopedTimeline : detail.timeline).slice(0, 5)}
                      emptyHint={
                        investigation
                          ? `No timeline events involving ${investigationLabel(investigation)} in this sample.`
                          : undefined
                      }
                    />
                  </>
                ) : null}

                {activeTab === "cpu" ? (
                  <>
                    <InsightCards detail={insightDetail ?? detail} onSelect={handleSelectTarget} />
                    <TraceFlameStack
                      frames={scopedCpuStack}
                      label={cpuStackLabel(detail.stackSource)}
                      variant="cpu"
                      onSelect={handleSelectTarget}
                      selectedLabel={selectedStackLabel}
                      sampleSeconds={detail.sampleSeconds}
                      sampleHz={20}
                      nodeName={detail.name}
                      paused={flamePaused}
                      onPausedChange={setFlamePaused}
                      processes={detail.topProcesses}
                      // processes={scopedProcesses} — scoped list can drop ownership metadata for other namespaces
                      onNavigate={navigateProfiler}
                      command={flameCommand}
                      commandSeq={flameCommandSeq}
                      onCommandHandled={() => setFlameCommand(null)}
                    />
                    {/* Hotspots moved beside the flamegraph (Top hotspots rail).
                    <HotspotList
                      hotspots={detail.kernelHotspots}
                      onSelect={handleSelectTarget}
                      selected={investigationTarget}
                    />
                    */}
                    <details className="profile-advanced-block">
                      <summary>Workloads &amp; processes</summary>
                      <div className="profile-overview-card profile-overview-wide">
                        <span className="profile-panel-label">Top workloads</span>
                        <PodTable
                          pods={scopedPods}
                          onSelect={handleSelectTarget}
                          selected={investigationTarget}
                        />
                        <span className="profile-panel-label">Top processes</span>
                        <ProcessTable
                          processes={investigation ? scopedProcesses : detail.topProcesses}
                          onSelect={handleSelectTarget}
                          selected={investigationTarget}
                        />
                      </div>
                    </details>
                  </>
                ) : null}

                {activeTab === "memory" ? (
                  <MemoryWorkspace
                    detail={detail}
                    pods={scopedPods}
                    containers={scopedContainers}
                    processes={scopedProcesses}
                    namespace={namespace}
                    onInvestigate={handleSelectTarget}
                    investigationTarget={investigationTarget}
                  />
                ) : null}

                {activeTab === "network" ? (
                  <>
                    <div className="profile-metrics">
                      {/* Previous: node-wide metrics while investigating a single workload.
                      {networkMetricsOnly(detail.metrics).map((metric: ProfileMetric) => (
                      */}
                      {(investigation ? scopedNetworkMetrics : networkMetricsOnly(detail.metrics)).map(
                        (metric: ProfileMetric) => (
                        <div key={metric.label} className="profile-metric">
                          <span className="profile-metric-label">{metric.label}</span>
                          <span className={`profile-metric-value profile-metric-${metric.tone}`}>
                            {metric.value}
                          </span>
                          <Sparkline values={metric.sparkline} tone={metric.tone === "neutral" ? undefined : metric.tone} />
                        </div>
                      ))}
                    </div>
                    {investigation && scopedNetworkStack.every((frame) => frame.depth === 0) ? (
                      <div className="profile-log-empty">
                        No network traffic involving {investigationLabel(investigation)} on this node
                        in the current sample.
                      </div>
                    ) : (
                      <TraceFlameStack
                        frames={scopedNetworkStack}
                        label={
                          investigation
                            ? `Network · ${investigationLabel(investigation)}`
                            : "Network flame graph"
                        }
                        variant="network"
                      />
                    )}
                    {/* <NetworkLog lines={detail.log} /> */}
                    <NetworkLog
                      lines={investigation ? scopedNetworkLog : detail.log}
                      emptyHint={
                        investigation
                          ? `No network log lines involving ${investigationLabel(investigation)} in this sample.`
                          : undefined
                      }
                    />
                  </>
                ) : null}

                {/* {activeTab === "timeline" ? <TimelineList events={detail.timeline} /> : null} */}
                {activeTab === "timeline" ? (
                  <TimelineList
                    events={investigation ? scopedTimeline : detail.timeline}
                    emptyHint={
                      investigation
                        ? `No timeline events involving ${investigationLabel(investigation)} in this sample.`
                        : undefined
                    }
                  />
                ) : null}
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
              clusterName={clusterName}
              onNavigate={navigateProfiler}
              onCommand={dispatchFlameCommand}
              onClear={() => {
                setInvestigationTarget(null);
                setFlamePaused(false);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
