import { useMemo, useState } from "react";
import {
  buildProtocolGroups,
  buildProtocolRows,
} from "../../../core/network/investigation-insights";
import { protocolClassLabel, type ProtocolClass } from "../../../core/network/protocol-class";
import type { NetworkFlow } from "../../../core/types/network";

function formatMs(value?: number): string {
  return value === undefined ? "—" : `${Math.round(value)}ms`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString();
}

type ProtocolFilter = ProtocolClass | "all";

export function ProtocolsTab({ flows }: { flows: NetworkFlow[] }) {
  const groups = useMemo(() => buildProtocolGroups(flows), [flows]);
  const [filter, setFilter] = useState<ProtocolFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => buildProtocolRows(flows, filter), [flows, filter]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="network-ws-overview">
      <p className="network-ws-banner">
        Protocol classes are port-inferred (*). Payload decode (HTTP method/route, SQL ops, Redis
        commands) is next — this view already segments live L4 paths by app class.
      </p>

      <div className="network-ws-proto-chips" role="tablist" aria-label="Protocol classes">
        <button
          type="button"
          className={`network-ws-chip${filter === "all" ? " network-ws-chip-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
          <span>{flows.length}</span>
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`network-ws-chip${filter === group.id ? " network-ws-chip-active" : ""}`}
            onClick={() => setFilter(group.id)}
          >
            {protocolClassLabel(group.id)}
            <span>{group.flowCount}</span>
          </button>
        ))}
      </div>

      <div className="network-ws-cards">
        {(filter === "all"
          ? groups
          : groups.filter((group) => group.id === filter)
        ).slice(0, 8).map((group) => (
          <div key={group.id} className="network-ws-card">
            <span className="network-ws-card-label">{protocolClassLabel(group.id)}</span>
            <strong className="network-ws-card-value">{group.flowCount}</strong>
            <span className="network-ws-list-meta">
              {group.requestsPerSec}/s · p95 {formatMs(group.p95LatencyMs)} · {group.errors} err
              {group.ports.length ? ` · :${group.ports.slice(0, 3).join(",:")}` : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="network-ws-flows-layout">
        <section className="panel network-ws-path-panel">
          <div className="panel-header">
            {filter === "all" ? "ALL PROTOCOL FLOWS" : `${protocolClassLabel(filter)} FLOWS`}
          </div>
          <div className="network-ws-table-wrap">
            {rows.length === 0 ? (
              <div className="empty-state">No flows for this protocol class in the window.</div>
            ) : (
              <table className="network-ws-path-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>Destination</th>
                    <th>Class</th>
                    <th>Proto</th>
                    <th>Port</th>
                    <th>Latency</th>
                    <th>Status</th>
                    <th>Bytes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((row) => (
                    <tr
                      key={row.id}
                      className={selectedId === row.id ? "selected" : ""}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td>{formatTime(row.timestamp)}</td>
                      <td>
                        <div className="network-ws-cell-main">{row.source}</div>
                        <div className="network-ws-cell-sub">{row.sourceNamespace ?? "—"}</div>
                      </td>
                      <td>
                        <div className="network-ws-cell-main">{row.destination}</div>
                        <div className="network-ws-cell-sub">
                          {row.destinationNamespace ?? "—"}
                        </div>
                      </td>
                      <td>{protocolClassLabel(row.appClass)}</td>
                      <td>{row.protocol}</td>
                      <td>{row.port}</td>
                      <td>{formatMs(row.latencyMs)}</td>
                      <td>{row.verdict}</td>
                      <td>
                        {(row.bytesSent ?? 0) + (row.bytesReceived ?? 0) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="flow-detail network-ws-inspector">
          <div className="flow-detail-title">PROTOCOL DETAIL</div>
          {!selected ? (
            <div className="flow-detail-empty">Select a flow to inspect.</div>
          ) : (
            <dl className="network-ws-kv">
              <div>
                <dt>Class</dt>
                <dd>{protocolClassLabel(selected.appClass)}</dd>
              </div>
              <div>
                <dt>Endpoint</dt>
                <dd>
                  {selected.protocol}:{selected.port}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  {selected.sourceNamespace ? `${selected.sourceNamespace}/` : ""}
                  {selected.source}
                </dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>
                  {selected.destinationNamespace ? `${selected.destinationNamespace}/` : ""}
                  {selected.destination}
                </dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{formatMs(selected.latencyMs)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.verdict}</dd>
              </div>
              <div>
                <dt>Method / Route</dt>
                <dd>— (decode pending)</dd>
              </div>
              <div>
                <dt>Status code</dt>
                <dd>— (decode pending)</dd>
              </div>
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}
