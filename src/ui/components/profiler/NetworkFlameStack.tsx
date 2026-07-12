import { useState } from "react";
import { flameColor } from "../../../core/network/flame-colors";
import type { ProfileStackFrame } from "../../../core/types/profiling";

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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="network-flame-kv">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface NetworkFlameStackProps {
  frames: ProfileStackFrame[];
  label?: string;
}

export function NetworkFlameStack({
  frames,
  label = "Network flame stack",
}: NetworkFlameStackProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    frames.find((frame) => (frame.id ?? `${frame.depth}-${frame.label}`) === selectedId) ??
    frames.find((frame) => frame.depth === 2) ??
    frames[0] ??
    null;

  const rowHeight = 26;
  const width = 640;
  const depthRows = Math.max(...frames.map((frame) => frame.depth), 0) + 1;
  const height = depthRows * rowHeight + 8;

  return (
    <div className="network-flame">
      <div className="profile-flamegraph-wrap network-flame-graph">
        <span className="profile-panel-label">{label}</span>
        <p className="network-flame-hint">
          Click a frame to inspect protocol, peer, bytes, and latency contribution.
        </p>
        <svg
          className="profile-flamegraph"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={label}
        >
          {frames.map((frame, index) => {
            const id = frame.id ?? `${frame.depth}-${frame.label}-${index}`;
            const y = 4 + frame.depth * rowHeight;
            const blockWidth = Math.max(28, frame.width * width);
            const x = frame.offset * (width - Math.min(blockWidth, width * 0.98));
            const isSelected = selected?.id === id || (!selected?.id && selected === frame);
            const chars = Math.max(4, Math.floor(blockWidth / 7.2));
            return (
              <g
                key={id}
                className={`network-flame-frame${isSelected ? " network-flame-frame-active" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(id)}
              >
                <title>
                  {[
                    frame.label,
                    frame.subtitle,
                    frame.sharePct !== undefined ? `${frame.sharePct}% of network time` : null,
                    frame.latencyMs !== undefined ? `P95-ish ${frame.latencyMs}ms` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </title>
                <rect
                  x={x}
                  y={y}
                  width={blockWidth}
                  height={22}
                  rx={3}
                  fill={flameColor(frame.heat, isSelected ? 1 : 0.9)}
                  stroke={isSelected ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.08)"}
                  strokeWidth={isSelected ? 1.5 : 0.5}
                />
                <text x={x + 8} y={y + 14} className="profile-flame-label">
                  {frameDisplayLabel(frame, chars)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selected ? (
        <div className="network-flame-detail">
          <div className="network-flame-detail-head">
            <div>
              <span className="profile-panel-label">Selected frame</span>
              <h3 className="network-flame-detail-title">{selected.label}</h3>
              {selected.subtitle ? (
                <p className="network-flame-detail-sub">{selected.subtitle}</p>
              ) : null}
            </div>
            {selected.sharePct !== undefined ? (
              <span className="network-flame-share">{selected.sharePct}%</span>
            ) : null}
          </div>

          <div className="network-flame-detail-grid">
            <DetailRow label="Kind" value={selected.endpointKind ?? selected.kind ?? "—"} />
            <DetailRow label="Namespace" value={selected.namespace ?? "—"} />
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
              label="Retransmits"
              value={selected.retransmits !== undefined ? String(selected.retransmits) : "—"}
            />
            <DetailRow
              label="Flows"
              value={selected.flowCount !== undefined ? String(selected.flowCount) : "—"}
            />
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
