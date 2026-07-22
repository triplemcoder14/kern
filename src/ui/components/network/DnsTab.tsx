import { useMemo, useState } from "react";
import { buildDnsRows, buildDnsSummary } from "../../../core/network/investigation-insights";
import type { NetworkFlow } from "../../../core/types/network";
import { useFrozenWhileSelected, useStickyById } from "../../hooks/useStickySelection";
import type { InvestigationFocus } from "../../investigation/types";
import {
  investigationLabel,
  investigationWindowLabel,
} from "../../investigation/types";

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

export function DnsTab({
  flows,
  investigation = null,
}: {
  flows: NetworkFlow[];
  investigation?: InvestigationFocus | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const summary = useMemo(() => buildDnsSummary(flows), [flows]);
  const liveRows = useMemo(() => buildDnsRows(flows), [flows]);
  const rows = useFrozenWhileSelected(liveRows, selectedId != null);
  const selected = useStickyById(rows, selectedId);
  const nxdomainCount = rows.filter((row) => row.responseCode === "NXDOMAIN").length;
  const focusLabel = investigation ? investigationLabel(investigation) : null;
  const windowLabel = investigation
    ? investigationWindowLabel(investigation.window)
    : "this window";
  const emptyLookups = focusLabel
    ? `No DNS activity involving ${focusLabel} was observed in the ${windowLabel.toLowerCase()}. KERN is listening for new lookups.`
    : "No DNS lookups in this window.";

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
            <div className="empty-state">
              {focusLabel
                ? `No DNS servers contacted by ${focusLabel} in the ${windowLabel.toLowerCase()}.`
                : "No DNS traffic in this window."}
            </div>
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
            <div className="empty-state">
              {focusLabel
                ? `No DNS clients for ${focusLabel} in the ${windowLabel.toLowerCase()}.`
                : "No DNS clients observed."}
            </div>
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
              <div className="empty-state">
                {/* Previous: "No DNS lookups in this window." */}
                {emptyLookups}
              </div>
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
                        <div className="network-ws-cell-sub">
                          {row.sourceNamespace ?? row.sourceIp ?? "—"}
                        </div>
                      </td>
                      <td>
                        <div className="network-ws-cell-main">{row.server}</div>
                        <div className="network-ws-cell-sub">{row.serverNamespace ?? "—"}</div>
                      </td>
                      <td>
                        <div className="network-ws-cell-main">{row.query}</div>
                        {row.searchExpanded ? (
                          <span
                            className="network-ws-dns-badge"
                            title="This query appears to have been expanded by the resolver search path."
                          >
                            Search domain expansion
                          </span>
                        ) : null}
                      </td>
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
              {selected.searchExpanded ? (
                <div
                  className="network-ws-dns-badge network-ws-dns-badge-block"
                  title="This query appears to have been expanded by the resolver search path."
                >
                  Search domain expansion
                </div>
              ) : null}
              <dl className="network-ws-kv">
                <div>
                  <dt>Source</dt>
                  <dd>
                    <div className="network-ws-cell-main">
                      {selected.sourceNamespace ? `${selected.sourceNamespace}/` : ""}
                      {selected.source}
                    </div>
                    {selected.sourceIp ? (
                      <div className="network-ws-cell-sub">{selected.sourceIp}</div>
                    ) : null}
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
                  <dt>DNS result</dt>
                  <dd>{selected.responseCode}</dd>
                </div>
                <div>
                  <dt>Resolution</dt>
                  <dd>{selected.resolutionStatus ?? "—"}</dd>
                </div>
                <div>
                  <dt>Verdict</dt>
                  {/* <dd>{selected.verdict}</dd> */}
                  <dd>{selected.analysisVerdict ?? "—"}</dd>
                </div>
                {selected.reason ? (
                  <div>
                    <dt>Reason</dt>
                    <dd>{selected.reason}</dd>
                  </div>
                ) : null}
                {selected.suggestion ? (
                  <div>
                    <dt>Suggestion</dt>
                    <dd>{selected.suggestion}</dd>
                  </div>
                ) : null}
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
              </dl>

              {selected.resolutionPath && selected.resolutionPath.length > 0 ? (
                <div className="network-ws-path network-ws-dns-resolution">
                  <span className="profile-panel-label">Resolution</span>
                  <ol className="network-ws-dns-chain">
                    {selected.resolutionPath.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {selected.searchExpansion && selected.searchExpansion.length > 0 ? (
                <div className="network-ws-path">
                  <span className="profile-panel-label">Search path expansion</span>
                  <ol className="network-ws-dns-chain network-ws-dns-chain-warn">
                    {selected.searchExpansion.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                    <li>{selected.responseCode}</li>
                  </ol>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
