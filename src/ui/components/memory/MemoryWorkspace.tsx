import { useMemo, useState } from "react";
import {
  buildMemoryStack,
  memoryTimelineEvents,
  type MemoryFlameMode,
} from "../../../core/profiling/build-memory-stack";
import type {
  ContainerConsumer,
  NodeProfileDetail,
  PodConsumer,
  ProcessSample,
  TimelineEvent,
} from "../../../core/types/profiling";
import { type InvestigationTarget } from "../profiler/InvestigationPanel";
import { TraceFlameStack } from "../profiler/TraceFlameStack";

export type MemoryWorkspaceTab =
  | "overview"
  | "heap"
  | "allocations"
  | "pods"
  | "kernel"
  | "timeline";

type ConsumerView = "pods" | "containers" | "processes";

interface MemoryWorkspaceProps {
  detail: NodeProfileDetail;
  pods: PodConsumer[];
  containers?: ContainerConsumer[];
  processes: ProcessSample[];
  namespace: string;
  onInvestigate: (target: InvestigationTarget) => void;
  investigationTarget: InvestigationTarget | null;
}

const TABS: Array<{ id: MemoryWorkspaceTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "heap", label: "Heap" },
  { id: "allocations", label: "Allocations" },
  { id: "pods", label: "Consumers" },
  { id: "kernel", label: "Kernel Memory" },
  { id: "timeline", label: "Timeline" },
];

function isProcessFallback(pods: PodConsumer[]): boolean {
  return pods.length > 0 && pods.every((pod) => pod.namespace === "node");
}

function formatMb(value?: number): string {
  if (value === undefined) {
    return "—";
  }
  if (Math.abs(value) >= 1024) {
    const signed = value < 0 ? "-" : "";
    return `${signed}${(Math.abs(value) / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(value)} MB`;
}

function formatGrowth(value?: number): { text: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  if (value === undefined) {
    return { text: "—", tone: "neutral" };
  }
  if (value === 0) {
    return { text: "0", tone: "neutral" };
  }
  const text = `${value > 0 ? "+" : ""}${formatMb(value)}`;
  if (value >= 64) {
    return { text, tone: "bad" };
  }
  if (value >= 16) {
    return { text, tone: "warn" };
  }
  if (value < 0) {
    return { text, tone: "ok" };
  }
  return { text, tone: "neutral" };
}

function formatFaults(major?: number, minor?: number): string {
  if (major === undefined && minor === undefined) {
    return "—";
  }
  const maj = major !== undefined ? formatCount(major) : "—";
  const min = minor !== undefined ? formatCount(minor) : "—";
  return `Maj ${maj} · Min ${min}`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}K`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return String(value);
}

function oomRisk(usageMb?: number, limitMb?: number): {
  label: string;
  pct?: number;
  remainingMb?: number;
  tone: "ok" | "warn" | "bad" | "neutral";
} {
  if (usageMb === undefined && limitMb === undefined) {
    return { label: "—", tone: "neutral" };
  }
  if (limitMb !== undefined && limitMb > 0 && usageMb !== undefined) {
    const pct = Math.min(100, Math.round((usageMb / limitMb) * 100));
    const remainingMb = Math.max(0, Math.round(limitMb - usageMb));
    // if (pct >= 90) {
    //   return { label: "High", pct, tone: "bad" };
    // }
    // if (pct >= 70) {
    //   return { label: "Watch", pct, tone: "warn" };
    // }
    // return { label: "Low", pct, tone: "ok" };
    if (pct >= 90) {
      return {
        label: `${pct}% · ${remainingMb} MB left`,
        pct,
        remainingMb,
        tone: "bad",
      };
    }
    if (pct >= 70) {
      return {
        label: `${pct}% · Pressure`,
        pct,
        remainingMb,
        tone: "warn",
      };
    }
    return {
      label: `${pct}% · OK`,
      pct,
      remainingMb,
      tone: "ok",
    };
  }
  if (usageMb === undefined) {
    return { label: "—", tone: "neutral" };
  }
  const rss = usageMb;
  if (rss >= 2048) {
    return { label: "High RSS", tone: "bad" };
  }
  if (rss >= 512) {
    return { label: "Elevated RSS", tone: "warn" };
  }
  return { label: "OK", tone: "ok" };
}

function formatMetricOrCollecting(value?: number, hasAnyInTable?: boolean): string {
  if (value !== undefined) {
    return formatMb(value);
  }
  // Show collecting only when the column is otherwise empty across the table.
  return hasAnyInTable === false ? "Collecting…" : "—";
}

function LimitUtilBar({
  usageMb,
  limitMb,
}: {
  usageMb?: number;
  limitMb?: number;
}) {
  if (usageMb === undefined) {
    return <span>—</span>;
  }
  if (limitMb === undefined || limitMb <= 0) {
    return <span>{formatMb(usageMb)}</span>;
  }
  const pct = Math.min(100, Math.round((usageMb / limitMb) * 100));
  const tone = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok";
  return (
    <span className="memory-ws-util" title={`${formatMb(usageMb)} / ${formatMb(limitMb)} (${pct}%)`}>
      <span className="memory-ws-util-text">
        {formatMb(usageMb)}
        <em> / {formatMb(limitMb)}</em>
      </span>
      <span className="memory-ws-util-bar" aria-hidden>
        <span className={`memory-ws-util-fill memory-ws-util-fill-${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`memory-ws-util-pct memory-ws-util-pct-${tone}`}>{pct}%</span>
    </span>
  );
}

function psiLabel(level?: string): { text: string; tone: "ok" | "warn" | "bad" } {
  if (level === "critical") {
    return { text: "Critical", tone: "bad" };
  }
  if (level === "warn") {
    return { text: "High", tone: "warn" };
  }
  return { text: "Normal", tone: "ok" };
}

interface ConsumerRow {
  id: string;
  name: string;
  scope: string;
  rssMb?: number;
  workingSetMb?: number;
  anonymousMb?: number;
  cacheMb?: number;
  majorFaults?: number;
  minorFaults?: number;
  growthMb?: number;
  memoryLimitMb?: number;
  kind: ConsumerView;
  podKey?: string;
  investigation?: InvestigationTarget;
}

function MemoryMapBar({
  usedMb,
  totalMb,
  cacheMb,
  slabMb,
  buffersMb,
}: {
  usedMb?: number;
  totalMb?: number;
  cacheMb?: number;
  slabMb?: number;
  buffersMb?: number;
}) {
  if (!totalMb || totalMb <= 0) {
    return null;
  }
  const usedPct = Math.min(100, ((usedMb ?? 0) / totalMb) * 100);
  const cachePct = Math.min(100 - usedPct, ((cacheMb ?? 0) / totalMb) * 100);
  const slabPct = Math.min(100 - usedPct - cachePct, ((slabMb ?? 0) / totalMb) * 100);
  const buffersPct = Math.min(
    100 - usedPct - cachePct - slabPct,
    ((buffersMb ?? 0) / totalMb) * 100,
  );

  return (
    <div className="profile-memory-map">
      <div className="profile-memory-map-head">
        <strong>{formatMb(totalMb)} node memory</strong>
        <span>
          RSS {formatMb(usedMb)} · Cache {formatMb(cacheMb)} · Slab {formatMb(slabMb)}
        </span>
      </div>
      <div className="profile-memory-map-bar" aria-hidden>
        <span className="profile-memory-seg profile-memory-rss" style={{ width: `${usedPct}%` }} />
        <span className="profile-memory-seg profile-memory-cache" style={{ width: `${cachePct}%` }} />
        <span className="profile-memory-seg profile-memory-slab" style={{ width: `${slabPct}%` }} />
        <span
          className="profile-memory-seg profile-memory-buffers"
          style={{ width: `${buffersPct}%` }}
        />
      </div>
      <div className="profile-memory-map-legend">
        <span>
          <i className="profile-memory-swatch profile-memory-rss" /> RSS
        </span>
        <span>
          <i className="profile-memory-swatch profile-memory-cache" /> Cache
        </span>
        <span>
          <i className="profile-memory-swatch profile-memory-slab" /> Slab
        </span>
        <span>
          <i className="profile-memory-swatch profile-memory-buffers" /> Buffers
        </span>
      </div>
    </div>
  );
}

function SummaryCards({ detail }: { detail: NodeProfileDetail }) {
  const psi = psiLabel(detail.psi.memoryLevel);
  const freeMb =
    detail.memoryTotalMb !== undefined && detail.memoryUsedMb !== undefined
      ? Math.max(0, detail.memoryTotalMb - detail.memoryUsedMb)
      : undefined;
  const cards = [
    { label: "Node Memory", value: formatMb(detail.memoryTotalMb) },
    { label: "RSS", value: formatMb(detail.memoryUsedMb) },
    { label: "Cache", value: formatMb(detail.memoryDetail.cacheMb) },
    { label: "Buffers", value: formatMb(detail.memoryDetail.buffersMb) },
    { label: "Slab", value: formatMb(detail.memoryDetail.slabMb) },
    { label: "Free", value: formatMb(freeMb) },
    {
      label: "Swap",
      value: formatMb(detail.memoryDetail.swapUsedMb),
      tone: (detail.memoryDetail.swapUsedMb ?? 0) > 0 ? ("warn" as const) : undefined,
    },
    { label: "Memory PSI", value: psi.text, tone: psi.tone },
    {
      label: "Major Faults/min",
      value:
        detail.memoryDetail.majorFaultsPerMin !== undefined
          ? String(detail.memoryDetail.majorFaultsPerMin)
          : "—",
    },
    {
      label: "OOM Events",
      value:
        detail.memoryDetail.oomEvents !== undefined
          ? String(detail.memoryDetail.oomEvents)
          : "—",
      tone: (detail.memoryDetail.oomEvents ?? 0) > 0 ? ("bad" as const) : undefined,
    },
  ];

  return (
    <div className="memory-ws-cards">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`memory-ws-card${card.tone ? ` memory-ws-card-${card.tone}` : ""}`}
        >
          <span className="memory-ws-card-label">{card.label}</span>
          <span className="memory-ws-card-value">{card.value}</span>
        </div>
      ))}
    </div>
  );
}

function ConsumerViewToggle({
  value,
  onChange,
  hideContainers,
}: {
  value: ConsumerView;
  onChange: (view: ConsumerView) => void;
  hideContainers?: boolean;
}) {
  const options: Array<{ id: ConsumerView; label: string }> = [
    { id: "pods", label: "Pods" },
    ...(hideContainers ? [] : [{ id: "containers" as const, label: "Containers" }]),
    { id: "processes", label: "Processes" },
  ];

  return (
    <div className="memory-ws-view-toggle" role="radiogroup" aria-label="Consumer view">
      <span className="memory-ws-view-label">Showing</span>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={`memory-ws-view-option${value === option.id ? " memory-ws-view-option-active" : ""}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OomRiskCell({ usageMb, limitMb }: { usageMb?: number; limitMb?: number }) {
  const risk = oomRisk(usageMb, limitMb);
  return (
    <span className={`memory-ws-risk memory-ws-risk-${risk.tone}`}>
      {/* <span className="memory-ws-risk-label">
        {risk.label}
        {risk.pct !== undefined ? ` (${risk.pct}%)` : ""}
      </span> */}
      <span className="memory-ws-risk-label">{risk.label}</span>
      {risk.pct !== undefined ? (
        <span className="memory-ws-risk-bar" aria-hidden>
          <span style={{ width: `${risk.pct}%` }} />
        </span>
      ) : null}
    </span>
  );
}

function ConsumerTable({
  rows,
  processes,
  timeline,
  detail,
  onInvestigate,
}: {
  rows: ConsumerRow[];
  processes: ProcessSample[];
  timeline: TimelineEvent[];
  detail: NodeProfileDetail;
  onInvestigate: (target: InvestigationTarget) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const showAnonymous = rows.some((row) => row.anonymousMb !== undefined);
  const showCache = rows.some((row) => row.cacheMb !== undefined);
  const showFaults = rows.some(
    (row) => row.majorFaults !== undefined || row.minorFaults !== undefined,
  );

  const gridTemplateColumns = [
    "minmax(140px, 1.4fr)",
    "minmax(90px, 0.9fr)",
    "minmax(64px, 0.55fr)",
    "minmax(170px, 1.4fr)",
    showAnonymous ? "minmax(72px, 0.55fr)" : null,
    showCache ? "minmax(64px, 0.5fr)" : null,
    showFaults ? "minmax(110px, 0.85fr)" : null,
    "minmax(64px, 0.55fr)",
    "minmax(120px, 1fr)",
  ]
    .filter(Boolean)
    .join(" ");

  if (rows.length === 0) {
    return <div className="profile-log-empty">No memory consumers on this node yet.</div>;
  }

  return (
    <div className="memory-ws-consumers-scroll">
      <div className="profile-table-wrap memory-ws-consumers-table">
        <div className="profile-table-head memory-ws-pod-head" style={{ gridTemplateColumns }}>
          <span>Name</span>
          <span>Scope</span>
          <span>RSS</span>
          {/* <span>Working Set</span> */}
          <span>Memory</span>
          {showAnonymous ? <span>Anonymous</span> : null}
          {showCache ? <span>Cache</span> : null}
          {showFaults ? <span>Major Faults</span> : null}
          <span>Growth</span>
          {/* <span>OOM Risk</span> */}
          <span>Limit pressure</span>
        </div>
        {rows.map((row) => {
          const growth = formatGrowth(row.growthMb);
          const expanded = expandedId === row.id;
          const usageMb = row.workingSetMb ?? row.rssMb;
          const risk = oomRisk(usageMb, row.memoryLimitMb);
          const relatedProcs = row.podKey
            ? processes.filter((proc) => `${proc.namespace ?? ""}/${proc.pod ?? ""}` === row.podKey)
            : processes.filter((proc) => proc.name === row.name).slice(0, 6);
          const oomEvents = timeline.filter((event) =>
            `${event.title} ${event.detail ?? ""}`.toLowerCase().includes("oom"),
          );
          const investigation: InvestigationTarget =
            row.investigation ??
            (row.kind === "processes"
              ? {
                  kind: "process",
                  pid: Number(row.id.split(":")[1]) || 0,
                  name: row.name,
                }
              : {
                  kind: "pod",
                  namespace: row.scope.includes("/") ? row.scope.split("/")[0] : row.scope,
                  pod: row.name,
                  rssMb: row.rssMb,
                });

          return (
            <div key={row.id} className={`memory-ws-consumer${expanded ? " memory-ws-consumer-open" : ""}`}>
              <button
                type="button"
                className="profile-table-row memory-ws-pod-row profile-table-row-button"
                style={{ gridTemplateColumns }}
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : row.id)}
              >
                <span className="memory-ws-name-cell">
                  <span className="memory-ws-expand-hint" aria-hidden>
                    {expanded ? "▾" : "▸"}
                  </span>
                  {row.name}
                </span>
                <span>{row.scope}</span>
                <span>{formatMb(row.rssMb)}</span>
                <LimitUtilBar usageMb={usageMb} limitMb={row.memoryLimitMb} />
                {showAnonymous ? (
                  <span>{formatMetricOrCollecting(row.anonymousMb, showAnonymous)}</span>
                ) : null}
                {showCache ? <span>{formatMetricOrCollecting(row.cacheMb, showCache)}</span> : null}
                {showFaults ? <span>{formatFaults(row.majorFaults, row.minorFaults)}</span> : null}
                <span className={`memory-ws-growth memory-ws-growth-${growth.tone}`}>{growth.text}</span>
                <OomRiskCell usageMb={usageMb} limitMb={row.memoryLimitMb} />
              </button>
              {expanded ? (
                <div className="memory-ws-row-detail">
                  <div className="memory-ws-detail-groups">
                    <div className="memory-ws-detail-group">
                      <span className="memory-ws-detail-group-title">Memory</span>
                      <div className="memory-ws-detail-grid memory-ws-detail-grid-compact">
                        <div>
                          <span className="memory-ws-detail-label">RSS</span>
                          <strong>{formatMb(row.rssMb)}</strong>
                        </div>
                        <div>
                          <span className="memory-ws-detail-label">Working Set</span>
                          <strong>{formatMb(row.workingSetMb)}</strong>
                        </div>
                        <div>
                          <span className="memory-ws-detail-label">Anonymous</span>
                          <strong>
                            {row.anonymousMb !== undefined ? formatMb(row.anonymousMb) : "Collecting…"}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="memory-ws-detail-group">
                      <span className="memory-ws-detail-group-title">Limits</span>
                      <div className="memory-ws-detail-grid memory-ws-detail-grid-compact">
                        <div>
                          <span className="memory-ws-detail-label">Limit</span>
                          <strong>{formatMb(row.memoryLimitMb)}</strong>
                        </div>
                        <div>
                          <span className="memory-ws-detail-label">Remaining</span>
                          <strong>
                            {risk.remainingMb !== undefined ? formatMb(risk.remainingMb) : "—"}
                          </strong>
                        </div>
                        <div>
                          <span className="memory-ws-detail-label">Pressure</span>
                          <strong className={`memory-ws-risk-${risk.tone}`}>{risk.label}</strong>
                          {row.memoryLimitMb !== undefined && usageMb !== undefined ? (
                            <LimitUtilBar usageMb={usageMb} limitMb={row.memoryLimitMb} />
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="memory-ws-detail-group">
                      <span className="memory-ws-detail-group-title">Events</span>
                      <div className="memory-ws-detail-grid memory-ws-detail-grid-compact">
                        <div>
                          <span className="memory-ws-detail-label">Growth</span>
                          <strong className={`memory-ws-growth-${growth.tone}`}>{growth.text}</strong>
                        </div>
                        <div>
                          <span className="memory-ws-detail-label">Page cache</span>
                          <strong>
                            {row.cacheMb !== undefined ? formatMb(row.cacheMb) : "Collecting…"}
                          </strong>
                        </div>
                        <div>
                          <span className="memory-ws-detail-label">Major faults</span>
                          <strong>{formatFaults(row.majorFaults, row.minorFaults)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="memory-ws-detail-section">
                    <span className="profile-panel-label">Processes</span>
                    {relatedProcs.length === 0 ? (
                      // <p className="memory-ws-note">No attributed processes in this sample.</p>
                      <p className="memory-ws-note">
                        Process attribution was not available for this capture.
                      </p>
                    ) : (
                      <ul className="memory-ws-proc-list">
                        {relatedProcs.slice(0, 8).map((proc) => (
                          <li key={`${proc.pid}-${proc.name}`}>
                            <span>
                              {proc.name}
                              <em> PID {proc.pid}</em>
                            </span>
                            <span>{formatMb(proc.rssMb)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="memory-ws-detail-section">
                    <span className="profile-panel-label">Pressure / OOM</span>
                    <div className="memory-ws-pressure-strip">
                      <div>
                        <span className="memory-ws-detail-label">Memory PSI</span>
                        <strong className={`memory-ws-risk-${psiLabel(detail.psi.memoryLevel).tone}`}>
                          {psiLabel(detail.psi.memoryLevel).text}
                        </strong>
                        {detail.psi.memoryAvg10 !== undefined ? (
                          <span className="memory-ws-note-inline">avg10 {detail.psi.memoryAvg10}</span>
                        ) : null}
                      </div>
                      <div>
                        <span className="memory-ws-detail-label">OOM timeline</span>
                        {oomEvents.length === 0 ? (
                          <div className="memory-ws-oom-rail" aria-hidden>
                            <span className="memory-ws-oom-rail-line" />
                            <span className="memory-ws-oom-rail-label">No events</span>
                          </div>
                        ) : (
                          <strong>{oomEvents.length} event(s)</strong>
                        )}
                      </div>
                    </div>
                    {oomEvents.length === 0 ? (
                      <p className="memory-ws-note">No OOM kills in the current timeline window.</p>
                    ) : (
                      <ul className="memory-ws-event-list">
                        {oomEvents.slice(0, 3).map((event) => (
                          <li key={`${event.timestamp}-${event.title}`}>
                            <span className={`memory-ws-sev memory-ws-sev-${event.severity}`}>
                              {event.severity}
                            </span>
                            <div>
                              <strong>{event.title}</strong>
                              <p>{event.detail ?? event.timestamp}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <button
                    type="button"
                    className="memory-ws-investigate"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onInvestigate(investigation);
                      requestAnimationFrame(() => {
                        document
                          .querySelector(".profile-investigation")
                          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      });
                    }}
                  >
                    Open investigation
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BreakdownPanel({ detail }: { detail: NodeProfileDetail }) {
  const total = Math.max(detail.memoryTotalMb ?? 1, 1);
  const rows = [
    { label: "RSS / Anonymous", mb: detail.memoryUsedMb },
    { label: "Page Cache", mb: detail.memoryDetail.cacheMb },
    { label: "Slab", mb: detail.memoryDetail.slabMb },
    { label: "Buffers", mb: detail.memoryDetail.buffersMb },
    { label: "Swap", mb: detail.memoryDetail.swapUsedMb },
  ];

  return (
    <section className="panel memory-ws-panel">
      <div className="panel-header">ALLOCATION BREAKDOWN</div>
      <ul className="memory-ws-breakdown">
        {rows.map((row) => {
          const pct = row.mb !== undefined ? Math.min(100, (row.mb / total) * 100) : 0;
          return (
            <li key={row.label}>
              <div className="memory-ws-breakdown-row">
                <span>{row.label}</span>
                <span className="memory-ws-breakdown-value">
                  {formatMb(row.mb)}
                  {row.mb !== undefined ? <em>{Math.round(pct)}%</em> : null}
                </span>
              </div>
              <div className="memory-ws-breakdown-bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function KernelPanel({ detail }: { detail: NodeProfileDetail }) {
  const rows = [
    { label: "Slab Growth", value: detail.kernelMemory.slabGrowth },
    { label: "Dentry Cache", value: detail.kernelMemory.dentryCache },
    { label: "TCP / Socket Buffers", value: detail.kernelMemory.tcpBuffers },
    { label: "Page Reclaim", value: detail.kernelMemory.pageReclaim },
    { label: "Reclaim Activity", value: detail.memoryDetail.reclaimActivity },
  ];

  return (
    <section className="panel memory-ws-panel">
      <div className="panel-header">KERNEL MEMORY</div>
      <div className="memory-ws-kv-grid">
        {rows.map((row) => (
          <div key={row.label} className="profile-kv">
            <span>{row.label}</span>
            <span>{row.value ?? "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function OomPanel({ detail }: { detail: NodeProfileDetail }) {
  const oomEvents = memoryTimelineEvents(detail).filter((event) =>
    `${event.title} ${event.detail ?? ""}`.toLowerCase().includes("oom"),
  );
  const count = detail.memoryDetail.oomEvents ?? oomEvents.length;
  const psi = psiLabel(detail.psi.memoryLevel);

  return (
    <section className="panel memory-ws-panel">
      <div className="panel-header">OOM INVESTIGATION</div>
      <div className="memory-ws-oom-summary">
        <strong>{count}</strong>
        <span>OOM events observed on this node</span>
      </div>
      <div className="memory-ws-pressure-strip">
        <div>
          <span className="memory-ws-detail-label">Memory PSI</span>
          <strong className={`memory-ws-risk-${psi.tone}`}>{psi.text}</strong>
          {detail.psi.memoryAvg10 !== undefined ? (
            <span className="memory-ws-note-inline">avg10 {detail.psi.memoryAvg10}</span>
          ) : null}
        </div>
        <div>
          <span className="memory-ws-detail-label">OOM timeline</span>
          {oomEvents.length === 0 ? (
            <div className="memory-ws-oom-rail" aria-hidden>
              <span className="memory-ws-oom-rail-line" />
              <span className="memory-ws-oom-rail-label">No events</span>
            </div>
          ) : (
            <strong>{oomEvents.length} event(s)</strong>
          )}
        </div>
      </div>
      {oomEvents.length === 0 ? (
        <p className="memory-ws-note">No recent OOM kills in the timeline window.</p>
      ) : (
        <ul className="memory-ws-event-list">
          {oomEvents.slice(0, 6).map((event) => (
            <li key={`${event.timestamp}-${event.title}`}>
              <span className={`memory-ws-sev memory-ws-sev-${event.severity}`}>{event.severity}</span>
              <div>
                <strong>{event.title}</strong>
                <p>{event.detail ?? event.timestamp}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="profile-log-empty">No memory pressure or kernel memory events yet.</div>;
  }

  return (
    <div className="profile-timeline">
      {events.map((event) => (
        <div key={`${event.timestamp}-${event.title}`} className={`profile-timeline-row profile-timeline-${event.severity}`}>
          <span className="profile-timeline-time">{event.timestamp}</span>
          <span className="profile-timeline-sev">{event.severity}</span>
          <div className="profile-timeline-body">
            <strong>{event.title}</strong>
            {event.detail ? <p>{event.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function AllocationsTab({
  processes,
  onSelect,
}: {
  processes: ProcessSample[];
  onSelect: (target: InvestigationTarget) => void;
}) {
  const ranked = [...processes].sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0)).slice(0, 16);

  return (
    <div className="memory-ws-allocations">
      {ranked.length === 0 ? (
        <div className="profile-log-empty">No process samples yet.</div>
      ) : (
        <div className="profile-table-wrap">
          <div className="profile-table-head profile-table-head-procs">
            <span>Process</span>
            <span>PID</span>
            <span>RSS</span>
            <span>Growth</span>
            <span>Pod</span>
          </div>
          {ranked.map((proc) => {
            const growth = formatGrowth(proc.growthMb);
            return (
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
                <span>{proc.name}</span>
                <span>{proc.pid}</span>
                <span>{formatMb(proc.rssMb)}</span>
                <span className={`memory-ws-growth memory-ws-growth-${growth.tone}`}>{growth.text}</span>
                <span>{proc.pod ? `${proc.namespace}/${proc.pod}` : "—"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildConsumerRows(
  view: ConsumerView,
  pods: PodConsumer[],
  containers: ContainerConsumer[],
  processes: ProcessSample[],
  processMode: boolean,
): ConsumerRow[] {
  if (view === "processes" || (view === "pods" && processMode)) {
    return [...processes]
      .sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0))
      .slice(0, 24)
      .map((proc) => ({
        id: `proc:${proc.pid}:${proc.name}`,
        name: proc.name,
        scope: proc.pod ? `${proc.namespace}/${proc.pod}` : "host",
        rssMb: proc.rssMb,
        workingSetMb: proc.rssMb,
        growthMb: proc.growthMb,
        kind: "processes" as const,
        investigation: {
          kind: "process" as const,
          pid: proc.pid,
          name: proc.name,
          namespace: proc.namespace,
          pod: proc.pod,
        },
      }));
  }

  if (view === "containers") {
    return containers.map((container) => ({
      id: `ctr:${container.namespace}/${container.pod}/${container.container}`,
      name: container.container,
      scope: `${container.namespace}/${container.pod}`,
      rssMb: container.rssMb,
      workingSetMb: container.workingSetMb,
      growthMb: container.growthMb,
      memoryLimitMb: container.memoryLimitMb,
      kind: "containers" as const,
      podKey: `${container.namespace}/${container.pod}`,
      investigation: {
        kind: "pod" as const,
        namespace: container.namespace,
        pod: container.pod,
        rssMb: container.rssMb,
      },
    }));
  }

  return [...pods]
    .sort((a, b) => (b.workingSetMb ?? b.rssMb ?? 0) - (a.workingSetMb ?? a.rssMb ?? 0))
    .map((pod) => ({
      id: `pod:${pod.namespace}/${pod.pod}`,
      name: pod.pod,
      scope: pod.namespace,
      rssMb: pod.rssMb,
      workingSetMb: pod.workingSetMb,
      anonymousMb: pod.anonymousMb,
      cacheMb: pod.cacheMb,
      majorFaults: pod.majorFaults ?? pod.pageFaultsPerMin,
      minorFaults: pod.minorFaults,
      growthMb: pod.growthMb,
      memoryLimitMb: pod.memoryLimitMb,
      kind: "pods" as const,
      podKey: `${pod.namespace}/${pod.pod}`,
      investigation: {
        kind: "pod" as const,
        namespace: pod.namespace,
        pod: pod.pod,
        cpuPercent: pod.cpuPercent,
        rssMb: pod.rssMb,
      },
    }));
}

export function MemoryWorkspace({
  detail,
  pods,
  containers,
  processes,
  namespace,
  onInvestigate,
  investigationTarget,
}: MemoryWorkspaceProps) {
  const [tab, setTab] = useState<MemoryWorkspaceTab>("overview");
  const [flameMode, setFlameMode] = useState<MemoryFlameMode>("retained");
  const processMode = isProcessFallback(pods);
  const [consumerView, setConsumerView] = useState<ConsumerView>(processMode ? "processes" : "pods");

  const memoryDetail = useMemo(
    () => ({
      ...detail,
      topPods: pods,
      topProcesses: processes,
      topContainers: containers ?? detail.topContainers ?? [],
    }),
    [detail, pods, processes, containers],
  );

  const memoryFrames = useMemo(
    () => buildMemoryStack(memoryDetail, flameMode),
    [memoryDetail, flameMode],
  );

  const timeline = useMemo(() => memoryTimelineEvents(detail), [detail]);
  const selectedStackLabel =
    investigationTarget?.kind === "stack" ? investigationTarget.label : undefined;
  const containerRows = containers ?? detail.topContainers ?? [];
  const rows = useMemo(
    () => buildConsumerRows(consumerView, pods, containerRows, processes, processMode),
    [consumerView, pods, containerRows, processes, processMode],
  );

  const consumersPanel = (
    <section className="panel memory-ws-panel">
      <div className="memory-ws-consumers-head">
        <div className="panel-header">TOP MEMORY CONSUMERS</div>
        <ConsumerViewToggle
          value={consumerView}
          onChange={setConsumerView}
          hideContainers={containerRows.length === 0 && !processMode}
        />
      </div>
      <ConsumerTable
        rows={rows}
        processes={processes}
        timeline={timeline}
        detail={detail}
        onInvestigate={onInvestigate}
      />
    </section>
  );

  return (
    <div className="memory-ws">
      <div className="memory-ws-intro">
        <div>
          <span className="profile-panel-label">Memory</span>
          <h3 className="memory-ws-title">{detail.name}</h3>
          {namespace && namespace !== "all" ? (
            <p className="memory-ws-subtitle">Namespace {namespace}</p>
          ) : null}
        </div>
      </div>

      <div className="memory-ws-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`memory-ws-tab${tab === item.id ? " memory-ws-tab-active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="memory-ws-overview">
          <SummaryCards detail={detail} />
          <div className="memory-ws-overview-grid">
            <BreakdownPanel detail={detail} />
            <OomPanel detail={detail} />
          </div>
          <MemoryMapBar
            usedMb={detail.memoryUsedMb}
            totalMb={detail.memoryTotalMb}
            cacheMb={detail.memoryDetail.cacheMb}
            slabMb={detail.memoryDetail.slabMb}
            buffersMb={detail.memoryDetail.buffersMb}
          />
          {consumersPanel}
        </div>
      ) : null}

      {tab === "heap" ? (
        <div className="memory-ws-heap">
          <div className="memory-ws-mode-row">
            <span className="profile-panel-label">Heap mode</span>
            <div className="memory-ws-mode-toggle">
              {(
                [
                  ["retained", "Retained Heap"],
                  ["allocated", "Allocated Heap"],
                  ["count", "Allocation Count"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`memory-ws-mode${flameMode === id ? " memory-ws-mode-active" : ""}`}
                  onClick={() => setFlameMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <TraceFlameStack
            frames={memoryFrames}
            label={
              flameMode === "count"
                ? "Allocation count"
                : flameMode === "allocated"
                  ? "Allocated heap"
                  : "Retained heap"
            }
            variant="memory"
            onSelect={onInvestigate}
            selectedLabel={selectedStackLabel}
          />
        </div>
      ) : null}

      {tab === "allocations" ? (
        <AllocationsTab processes={processes} onSelect={onInvestigate} />
      ) : null}

      {tab === "pods" ? consumersPanel : null}

      {tab === "kernel" ? <KernelPanel detail={detail} /> : null}

      {tab === "timeline" ? (
        <div className="memory-ws-timeline">
          <TimelinePanel events={timeline.length > 0 ? timeline : detail.timeline} />
        </div>
      ) : null}
    </div>
  );
}
