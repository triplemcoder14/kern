import type { NetworkFlow } from "../../core/types/network";

interface LiveFlowsTableProps {
  flows: NetworkFlow[];
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function LiveFlowsTable({ flows }: LiveFlowsTableProps) {
  return (
    <section className="panel live-flows-panel">
      <div className="panel-header">
        LIVE FLOWS
        <span className="panel-meta">{flows.length} captured</span>
      </div>
      <div className="live-flows-wrap">
        {flows.length === 0 ? (
          <div className="empty-state">No flows yet — generate traffic between pods</div>
        ) : (
          <table className="live-flows-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>SOURCE</th>
                <th>DESTINATION</th>
                <th>PROTO</th>
                <th>PORT</th>
                <th>LATENCY</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {flows.slice(0, 20).map((flow) => (
                <tr key={flow.id}>
                  <td>{formatTime(flow.timestamp)}</td>
                  <td>
                    {flow.src.kind}/{flow.src.name}
                  </td>
                  <td>
                    {flow.dst.kind}/{flow.dst.name}
                  </td>
                  <td>{flow.protocol}</td>
                  <td>{flow.port}</td>
                  <td>{flow.latencyMs !== undefined ? `${flow.latencyMs}ms` : "—"}</td>
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
