import { useMemo, useState } from "react";
import {
  flameColor,
  flameLabelColor,
  flameShareTone,
  FLAME_GRADIENT_CSS,
} from "../../../core/network/flame-colors";
import type { ProfileStackFrame } from "../../../core/types/profiling";
import type { InvestigationTarget } from "./InvestigationPanel";

function formatBytes(value?: number): string {
  if (value === undefined || value <= 0) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function frameDisplayLabel(frame: ProfileStackFrame, maxChars: number): string {
  if (frame.label.length <= maxChars) {
    return frame.label;
  }
  return `${frame.label.slice(0, Math.max(4, maxChars - 1))}…`;
}

/** Prefer share-of-parent when present so color tracks pressure, not arbitrary heat. */
function framePressureHeat(frame: ProfileStackFrame): number {
  if (frame.sharePct !== undefined) {
    // Soft curve: small frames stay green, mid pressure amber, hot frames red.
    return Math.min(1, (frame.sharePct / 100) ** 0.82);
  }
  return Math.max(0, Math.min(1, frame.heat));
}

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="network-flame-kv">
      <span title={hint}>{label}</span>
      <span>{value}</span>
    </div>
  );
}


export type TraceFlameVariant = "network" | "cpu" | "memory";

interface TraceFlameStackProps {
  frames: ProfileStackFrame[];
  label?: string;
  variant?: TraceFlameVariant;
  onSelect?: (target: InvestigationTarget) => void;
  selectedLabel?: string;
}

export function TraceFlameStack({
  frames,
  label,
  variant = "network",
  onSelect,
  selectedLabel,
}: TraceFlameStackProps) {
  const title =
    label ??
    (variant === "cpu"
      ? "Node performance flamegraph"
      : variant === "memory"
        ? "Retained heap flamegraph"
        : "Network flame graph");
  const hint =
    variant === "cpu"
      ? "all → pod → process → stack. Click a frame for samples and share of node CPU."
      : variant === "memory"
        ? "all → pod → process. Width = retained RSS bytes (not CPU samples). Click a frame for ownership."
        : "Click a frame to inspect protocol, peer, bytes, and latency contribution.";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const selected =
    frames.find((frame) => (frame.id ?? `${frame.depth}-${frame.label}`) === selectedId) ??
    frames.find((frame) => frame.label === selectedLabel) ??
    frames.find((frame) => frame.depth === 1) ??
    frames[0] ??
    null;

  const focused = useMemo(() => {
    if (!focusId) {
      return frames;
    }
    const target =
      frames.find((frame) => (frame.id ?? `${frame.depth}-${frame.label}`) === focusId) ?? null;
    if (!target) {
      return frames;
    }
    const descendants = frames.filter(
      (frame) =>
        frame === target ||
        (frame.depth > target.depth &&
          frame.offset >= target.offset - 0.0001 &&
          frame.offset + frame.width <= target.offset + target.width + 0.0001),
    );
    if (descendants.length === 0) {
      return frames;
    }
    const baseOffset = target.offset;
    const baseWidth = Math.max(target.width, 0.0001);
    return descendants.map((frame) => ({
      ...frame,
      depth: frame.depth - target.depth,
      offset: (frame.offset - baseOffset) / baseWidth,
      width: frame.width / baseWidth,
    }));
  }, [frames, focusId]);

  const overviewFrames = useMemo(
    () => frames.filter((frame) => frame.depth === 1),
    [frames],
  );

  if (frames.length === 0) {
    return (
      <div className="network-flame">
        <span className="profile-panel-label">{title}</span>
        <div className="profile-log-empty">No flame samples yet.</div>
      </div>
    );
  }

  const rowHeight = 28;
  const width = 720;
  const depthRows = Math.max(...focused.map((frame) => frame.depth), 0) + 1;
  const height = depthRows * rowHeight + 10;
  const shareTone = flameShareTone(selected?.sharePct);

  return (
    <div className="network-flame network-flame-sleek">
      <div className="profile-flamegraph-wrap network-flame-graph">
        <div className="network-flame-title-row">
          <span className="profile-panel-label">{title}</span>
          <div className="network-flame-toolbar">
            <div className="network-flame-legend" aria-hidden>
              <span className="network-flame-legend-swatch network-flame-legend-good" />
              good
              <span className="network-flame-legend-swatch network-flame-legend-warn" />
              pressure
              <span className="network-flame-legend-swatch network-flame-legend-hot" />
              hot
            </div>
            {focusId ? (
              <button
                type="button"
                className="network-flame-reset"
                onClick={() => setFocusId(null)}
              >
                Reset zoom
              </button>
            ) : null}
          </div>
        </div>
        <p className="network-flame-hint">{hint}</p>
        <div
          className="network-flame-scale"
          style={{ background: FLAME_GRADIENT_CSS }}
          aria-hidden
        />

        {(variant === "cpu" || variant === "memory") && overviewFrames.length > 0 ? (
          <svg
            className="profile-flame-overview"
            viewBox={`0 0 ${width} 20`}
            role="img"
            aria-label="Node flame overview"
          >
            {overviewFrames.map((frame, index) => {
              const id = frame.id ?? `overview-${frame.label}-${index}`;
              const blockWidth = Math.max(4, frame.width * width);
              const x = frame.offset * width;
              const heat = framePressureHeat(frame);
              return (
                <rect
                  key={id}
                  x={x}
                  y={3}
                  width={blockWidth}
                  height={14}
                  rx={2}
                  fill={flameColor(heat, 0.95)}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={0.4}
                >
                  <title>{`${frame.label} · ${frame.sharePct ?? 0}%`}</title>
                </rect>
              );
            })}
          </svg>
        ) : null}

        <svg
          className="profile-flamegraph"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
        >
          {focused.map((frame, index) => {
            const id = frame.id ?? `${frame.depth}-${frame.label}-${index}`;
            const y = 4 + frame.depth * rowHeight;
            const blockWidth = Math.max(18, frame.width * width);
            const x = frame.offset * (width - Math.min(blockWidth, width * 0.995));
            const isSelected =
              selected?.id === id ||
              (!selected?.id && selected === frame) ||
              selectedLabel === frame.label;
            const chars = Math.max(4, Math.floor(blockWidth / 7));
            const heat = framePressureHeat(frame);
            return (
              <g
                key={`${id}-${index}`}
                className={`network-flame-frame${isSelected ? " network-flame-frame-active" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelectedId(id);
                  onSelect?.({ kind: "stack", label: frame.label, heat });
                }}
                onDoubleClick={() => setFocusId(frame.id ?? id)}
              >
                <title>
                  {[
                    frame.label,
                    frame.subtitle,
                    variant === "memory" && frame.bytes !== undefined
                      ? `Retained: ${formatBytes(frame.bytes)}`
                      : null,
                    frame.samples !== undefined ? `Samples: ${frame.samples}` : null,
                    frame.sharePct !== undefined
                      ? `Percentage: ${frame.sharePct}%`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </title>
                <rect
                  x={x}
                  y={y}
                  width={blockWidth}
                  height={24}
                  rx={3}
                  fill={flameColor(heat, isSelected ? 1 : 0.93)}
                  stroke={isSelected ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.18)"}
                  strokeWidth={isSelected ? 1.6 : 0.5}
                />
                <text
                  x={x + 8}
                  y={y + 15}
                  className="profile-flame-label"
                  fill={flameLabelColor(heat)}
                >
                  {frameDisplayLabel(frame, chars)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selected ? (
        <div className={`network-flame-detail network-flame-detail-${shareTone}`}>
          <div className="network-flame-detail-head">
            <div>
              <span className="profile-panel-label">Selected frame</span>
              <h3 className="network-flame-detail-title">{selected.label}</h3>
              {selected.subtitle ? (
                <p className="network-flame-detail-sub">{selected.subtitle}</p>
              ) : null}
            </div>
            {selected.sharePct !== undefined ? (
              <span className={`network-flame-share network-flame-share-${shareTone}`}>
                {selected.sharePct}%
              </span>
            ) : null}
          </div>

          <div className="network-flame-detail-grid">
            {variant === "cpu" ? (
              <>
                <DetailRow
                  label="Samples"
                  value={selected.samples !== undefined ? String(selected.samples) : "—"}
                />
                <DetailRow
                  label="Percentage"
                  value={selected.sharePct !== undefined ? `${selected.sharePct}%` : "—"}
                />
                <DetailRow
                  label="Flame depth"
                  value={String(selected.depth)}
                  hint="Nesting in the flame (0 = node root). Not the selected Kubernetes namespace."
                />
                <DetailRow
                  label="Pod namespace"
                  value={selected.namespace?.trim() ? selected.namespace : "—"}
                  hint="Kubernetes namespace of this pod/process frame. Protocol/root frames have none."
                />
              </>
            ) : variant === "memory" ? (
              <>
                <DetailRow
                  label="Retained memory"
                  value={formatBytes(selected.bytes)}
                  hint="RSS owned by this frame. Width of the flame is proportional to these bytes."
                />
                <DetailRow
                  label="Share of node"
                  value={selected.sharePct !== undefined ? `${selected.sharePct}%` : "—"}
                />
                <DetailRow
                  label="Flame depth"
                  value={String(selected.depth)}
                  hint="0 = node → 1 = pod → 2 = process / alloc site"
                />
                <DetailRow
                  label="Pod namespace"
                  value={selected.namespace?.trim() ? selected.namespace : "—"}
                />
              </>
            ) : (
              <>
                <DetailRow label="Kind" value={selected.endpointKind ?? selected.kind ?? "—"} />
                <DetailRow
                  label="Pod namespace"
                  value={selected.namespace?.trim() ? selected.namespace : "—"}
                  hint="Set on destination/workload frames (depth ≥ 2). Protocol frames like TCP have none."
                />
                <DetailRow
                  label="Protocol"
                  value={
                    selected.protocol
                      ? selected.port
                        ? `${selected.protocol}/${selected.port}`
                        : selected.protocol
                      : "—"
                  }
                />
                <DetailRow label="Peer / IP" value={selected.ip ?? "—"} />
                <DetailRow label="Bytes" value={formatBytes(selected.bytes)} />
                <DetailRow
                  label="Latency"
                  value={selected.latencyMs !== undefined ? `${selected.latencyMs} ms` : "—"}
                />
                <DetailRow
                  label="Flows"
                  value={selected.flowCount !== undefined ? String(selected.flowCount) : "—"}
                />
                <DetailRow
                  label="Flame depth"
                  value={String(selected.depth)}
                  hint="0 = network root → 1 = protocol → 2 = endpoint → 3 = workload"
                />
              </>
            )}
          </div>

          {selected.path ? (
            <div className="network-flame-path">
              <span className="profile-panel-label">Path</span>
              <code>{selected.path}</code>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
