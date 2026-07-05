import type { NetworkFlow } from "../../core/types/network";

interface LiveFlowsTableProps {
  flows: NetworkFlow[];
  limit?: number;
  title?: string;
  emptyMessage?: string;
  showPath?: boolean;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(value?: number): string {
  if (value === undefined) {
    return "—";
  }
  if (value < 1024) {
    return `${value}B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)}K`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)}M`;
}

export function LiveFlowsTable({
  flows,
  limit,
  title = "LIVE FLOWS",
  emptyMessage = "No flows yet — generate traffic between pods",
  showPath = true,
}: LiveFlowsTableProps) {
  const rows = limit ? flows.slice(0, limit) : flows;

  return (
    <section className="panel live-flows-panel">
      <div className="panel-header">
        {title}
        <span className="panel-meta">
          {rows.length} shown{limit && flows.length > limit ? ` · ${flows.length} total` : ""}
        </span>
      </div>
      <div className="live-flows-wrap">
        {rows.length === 0 ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : (
          <table className="live-flows-table">
            <thead>
              <tr>
                <th>TIME</th>
                {showPath ? <th>PATH</th> : null}
                <th>SOURCE</th>
                <th>DESTINATION</th>
                <th>PROTO</th>
                <th>PORT</th>
                <th>LATENCY</th>
                <th>BYTES</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((flow) => (
                <tr key={flow.id}>
                  <td>{formatTime(flow.timestamp)}</td>
                  {showPath ? (
                    <td className="flow-path-cell" title={flow.path}>
                      {flow.path ?? `${flow.src.kind}/${flow.src.name} → ${flow.dst.kind}/${flow.dst.name}`}
                    </td>
                  ) : null}
                  <td>
                    {flow.src.kind}/{flow.src.name}
                  </td>
                  <td>
                    {flow.dst.kind}/{flow.dst.name}
                  </td>
                  <td>{flow.protocol}</td>
                  <td>{flow.port}</td>
                  <td>{flow.latencyMs !== undefined ? `${flow.latencyMs}ms` : "—"}</td>
                  <td>{formatBytes(flow.bytesSent ?? flow.bytesReceived)}</td>
                  <td>
                    <span
                      className={`flow-status-pill ${flow.verdict === "OK" ? "ok" : flow.verdict === "TIMEOUT" || flow.verdict === "DROPPED" ? "bad" : "warn"}`}
                    >
                      {flow.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
