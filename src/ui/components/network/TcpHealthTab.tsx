import { useMemo, useState } from "react";
import {
  buildTcpEventRows,
  buildTcpHealthSummary,
} from "../../../core/network/investigation-insights";
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

export function TcpHealthTab({ flows }: { flows: NetworkFlow[] }) {
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useMemo(() => buildTcpHealthSummary(flows), [flows]);
  const events = useMemo(
    () => buildTcpEventRows(flows, problemsOnly),
    [flows, problemsOnly],
  );
  const selected = events.find((row) => row.id === selectedId) ?? null;

  const cards = [
    { label: "Connections", value: String(summary.connections) },
    { label: "TCP Drops", value: String(summary.drops) },
    { label: "Retransmits", value: String(summary.retransmits) },
    { label: "Timeouts", value: String(summary.timeouts) },
    { label: "SYN Retries*", value: String(summary.retries) },
    { label: "OK", value: String(summary.ok) },
    { label: "P95 Latency", value: formatMs(summary.p95LatencyMs) },
  ];

  return (
    <div className="network-ws-overview">
      <div className="network-ws-cards">
        {cards.map((card) => (
          <div key={card.label} className="network-ws-card">
            <span className="network-ws-card-label">{card.label}</span>
            <strong className="network-ws-card-value">{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="network-ws-filters">
        <label className="network-ws-toggle">
          <input
            type="checkbox"
            checked={problemsOnly}
            onChange={(event) => setProblemsOnly(event.target.checked)}
          />
          Problems only (drops, timeouts, retries, retransmits)
        </label>
      </div>

      <div className="network-ws-flows-layout">
        <section className="panel network-ws-path-panel">
          <div className="panel-header">TCP EVENTS</div>
          <div className="network-ws-table-wrap">
            {events.length === 0 ? (
              <div className="empty-state">
                {problemsOnly
                  ? "No TCP problems in this window — toggle off “Problems only” to see all connects."
                  : "No TCP flows yet."}
              </div>
            ) : (
              <table className="network-ws-path-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>Destination</th>
                    <th>Namespace</th>
                    <th>Reason</th>
                    <th>State</th>
                    <th>Retrans</th>
                    <th>Bytes</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 200).map((row) => (
                    <tr
                      key={row.id}
                      className={selectedId === row.id ? "selected" : ""}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td>{formatTime(row.timestamp)}</td>
                      <td>
                        <div className="network-ws-cell-main">{row.source}</div>
                        <div className="network-ws-cell-sub">:{row.port}</div>
                      </td>
                      <td>{row.destination}</td>
                      <td>{row.sourceNamespace ?? row.destinationNamespace ?? "—"}</td>
                      <td>{row.reason}</td>
                      <td>{row.socketState}</td>
                      <td>{row.retransmits}</td>
                      <td>{row.bytes || "—"}</td>
                      <td>{formatMs(row.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="flow-detail network-ws-inspector">
          <div className="flow-detail-title">TCP EVENT</div>
          {!selected ? (
            <div className="flow-detail-empty">Select a TCP event.</div>
          ) : (
            <>
              <dl className="network-ws-kv">
                <div>
                  <dt>Reason</dt>
                  <dd>{selected.reason}</dd>
                </div>
                <div>
                  <dt>Socket state</dt>
                  <dd>{selected.socketState}</dd>
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
                    {selected.destination}:{selected.port}
                  </dd>
                </div>
                <div>
                  <dt>Retransmits</dt>
                  <dd>{selected.retransmits}</dd>
                </div>
                <div>
                  <dt>Bytes</dt>
                  <dd>{selected.bytes || "—"}</dd>
                </div>
                <div>
                  <dt>Latency</dt>
                  <dd>{formatMs(selected.latencyMs)}</dd>
                </div>
                <div>
                  <dt>Verdict</dt>
                  <dd>{selected.verdict}</dd>
                </div>
              </dl>
              {selected.path ? (
                <div className="network-ws-path">
                  <span className="profile-panel-label">Path</span>
                  <code>{selected.path}</code>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
