import { useMemo, useState } from "react";
import { buildDnsRows, buildDnsSummary } from "../../../core/network/investigation-insights";
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

function formatTxid(value?: number): string {
  if (value === undefined || value === 0) {
    return "—";
  }
  return `0x${value.toString(16).padStart(4, "0")}`;
}

export function DnsTab({ flows }: { flows: NetworkFlow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const summary = useMemo(() => buildDnsSummary(flows), [flows]);
  const rows = useMemo(() => buildDnsRows(flows), [flows]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const nxdomainCount = rows.filter((row) => row.responseCode === "NXDOMAIN").length;

  const cards = [
    { label: "Queries/sec", value: String(summary.queriesPerSec) },
    { label: "Failure Rate", value: `${summary.failureRate}%` },
    { label: "NXDOMAIN", value: String(nxdomainCount) },
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

      <div className="network-ws-overview-grid">
        <section className="panel">
          <div className="panel-header">TOP DNS SERVERS</div>
          {summary.topServers.length === 0 ? (
            <div className="empty-state">No DNS traffic in this window.</div>
          ) : (
            <ul className="network-ws-list">
              {summary.topServers.map((item) => (
                <li key={`${item.namespace}/${item.name}`}>
                  <div className="network-ws-list-static">
                    <span className="network-ws-list-main">
                      {item.namespace ? `${item.namespace}/` : ""}
                      {item.name}
                    </span>
                    <span className="network-ws-list-meta">{item.count} queries</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">TOP CLIENT PODS</div>
          {summary.topClients.length === 0 ? (
            <div className="empty-state">No DNS clients observed.</div>
          ) : (
            <ul className="network-ws-list">
              {summary.topClients.map((item) => (
                <li key={`${item.namespace}/${item.name}`}>
                  <div className="network-ws-list-static">
                    <span className="network-ws-list-main">
                      {item.namespace ? `${item.namespace}/` : ""}
                      {item.name}
                    </span>
                    <span className="network-ws-list-meta">{item.count} lookups</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="network-ws-flows-layout">
        <section className="panel network-ws-path-panel">
          <div className="panel-header">DNS LOOKUPS</div>
          <div className="network-ws-table-wrap">
            {rows.length === 0 ? (
              <div className="empty-state">No DNS lookups in this window.</div>
            ) : (
              <table className="network-ws-path-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>DNS Server</th>
                    <th>Query</th>
                    <th>Type</th>
                    <th>Code</th>
                    <th>TxID</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
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
                        <div className="network-ws-cell-main">{row.server}</div>
                        <div className="network-ws-cell-sub">{row.serverNamespace ?? "—"}</div>
                      </td>
                      <td>{row.query}</td>
                      <td>{row.type}</td>
                      <td>{row.responseCode}</td>
                      <td>{formatTxid(row.txid)}</td>
                      <td>{formatMs(row.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="flow-detail network-ws-inspector">
          <div className="flow-detail-title">DNS REQUEST</div>
          {!selected ? (
            <div className="flow-detail-empty">Select a lookup row.</div>
          ) : (
            <>
              <dl className="network-ws-kv">
                <div>
                  <dt>Source</dt>
                  <dd>
                    {selected.sourceNamespace ? `${selected.sourceNamespace}/` : ""}
                    {selected.source}
                  </dd>
                </div>
                <div>
                  <dt>DNS server</dt>
                  <dd>
                    {selected.serverNamespace ? `${selected.serverNamespace}/` : ""}
                    {selected.server}
                  </dd>
                </div>
                <div>
                  <dt>Query</dt>
                  <dd>{selected.query}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{selected.type}</dd>
                </div>
                <div>
                  <dt>Response</dt>
                  <dd>{selected.responseCode}</dd>
                </div>
                <div>
                  <dt>Transaction ID</dt>
                  <dd>{formatTxid(selected.txid)}</dd>
                </div>
                <div>
                  <dt>Answers</dt>
                  <dd>
                    {selected.answers.length === 0
                      ? "—"
                      : selected.answers.map((answer) => (
                          <div key={answer}>{answer}</div>
                        ))}
                  </dd>
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
