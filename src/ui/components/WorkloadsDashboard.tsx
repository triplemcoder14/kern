import { useMemo, useState } from "react";
import type { Incident, MonitorEvent } from "../../core/types/monitoring";
import type { NetworkNode, NetworkSnapshot, NetworkTopology } from "../../core/types/network";
import { PageContextBar } from "./PageContextBar";

type StatusFilter = "all" | "healthy" | "degraded" | "unknown";

interface WorkloadsDashboardProps {
  snapshot: NetworkSnapshot;
  events: MonitorEvent[];
  incidents: Incident[];
  clusterName: string;
  namespaceFilter: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  onViewInNetwork?: () => void;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  return `${Math.floor(mins / 60)}h ago`;
}

function statusLabel(status: NetworkNode["status"]): string {
  if (status === "healthy") {
    return "Running";
  }
  if (status === "degraded") {
    return "Degraded";
  }
  return "Unknown";
}

function isWorkloadEvent(event: MonitorEvent): boolean {
  return (
    event.category === "workload" ||
    event.resourceKind === "Pod" ||
    event.resourceKind === "Deployment"
  );
}

function podFlowStats(nodeId: string, topology: NetworkTopology): { inbound: number; outbound: number } {
  let inbound = 0;
  let outbound = 0;
  for (const edge of topology.edges) {
    if (edge.to === nodeId) {
      inbound += edge.flowCount;
    }
    if (edge.from === nodeId) {
      outbound += edge.flowCount;
    }
  }
  return { inbound, outbound };
}

function eventsForPod(events: MonitorEvent[], pod: NetworkNode): MonitorEvent[] {
  return events.filter((event) => {
    if (!isWorkloadEvent(event)) {
      return false;
    }
    if (event.resourceKind === "Pod" && event.resourceName === pod.name) {
      return !event.namespace || event.namespace === pod.namespace;
    }
    return (
      event.namespace === pod.namespace &&
      (event.resourceName === pod.name || event.message.includes(pod.name))
    );
  });
}

function incidentsForPod(incidents: Incident[], pod: NetworkNode): Incident[] {
  return incidents.filter(
    (incident) =>
      incident.status === "open" &&
      incident.resourceKind === "Pod" &&
      incident.resourceName === pod.name &&
      (!incident.namespace || incident.namespace === pod.namespace),
  );
}

export function WorkloadsDashboard({
  snapshot,
  events,
  incidents,
  clusterName,
  namespaceFilter,
  namespaces,
  onNamespaceChange,
  connected,
  onViewInNetwork,
}: WorkloadsDashboardProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pods = useMemo(() => {
    return snapshot.topology.nodes
      .filter((node) => node.kind === "Pod")
      .filter((node) => namespaceFilter === "all" || node.namespace === namespaceFilter)
      .sort((a, b) => {
        const statusRank = (status: NetworkNode["status"]) =>
          status === "degraded" ? 0 : status === "unknown" ? 1 : 2;
        const rankDiff = statusRank(a.status) - statusRank(b.status);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
      });
  }, [snapshot.topology.nodes, namespaceFilter]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return pods.filter((pod) => {
      const statusMatch = statusFilter === "all" || pod.status === statusFilter;
      const searchMatch =
        !query ||
        pod.name.toLowerCase().includes(query) ||
        pod.namespace.toLowerCase().includes(query) ||
        pod.ip.includes(query);
      return statusMatch && searchMatch;
    });
  }, [pods, statusFilter, search]);

  const selected = useMemo(
    () => filtered.find((pod) => pod.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const workloadEvents = useMemo(
    () => events.filter(isWorkloadEvent).slice(0, 80),
    [events],
  );

  const selectedEvents = useMemo(
    () => (selected ? eventsForPod(workloadEvents, selected).slice(0, 8) : []),
    [selected, workloadEvents],
  );

  const selectedIncidents = useMemo(
    () => (selected ? incidentsForPod(incidents, selected) : []),
    [selected, incidents],
  );

  const selectedFlows = useMemo(
    () => (selected ? podFlowStats(selected.id, snapshot.topology) : { inbound: 0, outbound: 0 }),
    [selected, snapshot.topology],
  );

  const tableCounts = useMemo(
    () => ({
      all: pods.length,
      healthy: pods.filter((pod) => pod.status === "healthy").length,
      degraded: pods.filter((pod) => pod.status === "degraded").length,
      unknown: pods.filter((pod) => pod.status === "unknown").length,
    }),
    [pods],
  );

  const summaryCounts = useMemo(() => {
    const podNodes = snapshot.topology.nodes.filter((node) => node.kind === "Pod");
    const serviceNodes = snapshot.topology.nodes.filter(
      (node) => node.kind === "Service" && (namespaceFilter === "all" || node.namespace === namespaceFilter),
    );
    const scopedPods =
      namespaceFilter === "all"
        ? podNodes
        : podNodes.filter((node) => node.namespace === namespaceFilter);

    return {
      pods: scopedPods.length,
      running: scopedPods.filter((pod) => pod.status === "healthy").length,
      failed: scopedPods.filter((pod) => pod.status === "degraded").length,
      services: serviceNodes.length,
    };
  }, [snapshot.topology.nodes, namespaceFilter]);

  return (
    <div className="workloads-page">
      <header className="events-header">
        <div>
          <h1 className="events-title">Workloads</h1>
          <p className="events-sub">Live pod health from your connected cluster</p>
        </div>
        <div className="events-header-right">
          <PageContextBar
            clusterName={clusterName}
            namespace={namespaceFilter}
            namespaces={namespaces}
            onNamespaceChange={onNamespaceChange}
            connected={connected}
          />
          <div className="events-toolbar">
            <input
              className="events-search"
              placeholder="Search pods…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </header>

      <div className="events-stats">
        {(
          [
            ["pods", "PODS", summaryCounts.pods],
            ["running", "RUNNING", summaryCounts.running],
            ["failed", "FAILED", summaryCounts.failed],
            ["services", "SERVICES", summaryCounts.services],
          ] as const
        ).map(([key, label, count]) => (
          <div key={key} className="stat-card stat-card-static">
            <span className="stat-label">{label}</span>
            <span className="stat-value">{count}</span>
          </div>
        ))}
      </div>

      <div className="workloads-status-tabs">
        {(
          [
            ["all", "All", tableCounts.all],
            ["healthy", "Running", tableCounts.healthy],
            ["degraded", "Degraded", tableCounts.degraded],
            ["unknown", "Unknown", tableCounts.unknown],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`workloads-status-tab ${statusFilter === key ? "active" : ""}`}
            onClick={() => setStatusFilter(key)}
          >
            {label}
            <span className="workloads-status-count">{count}</span>
          </button>
        ))}
      </div>

      <div className="workloads-body">
        <section className="workloads-table-wrap panel">
          <div className="panel-header">PODS</div>
          <table className="workloads-table">
            <thead>
              <tr>
                <th>Pod</th>
                <th>Namespace</th>
                <th>Status</th>
                <th>IP</th>
                <th>Flows</th>
              </tr>
            </thead>
            <tbody>
              {!connected ? (
                <tr>
                  <td colSpan={5} className="workloads-empty">
                    Not connected — open Settings to connect your cluster.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="workloads-empty">
                    {pods.length === 0
                      ? "No pods with assigned IPs yet. Waiting for topology refresh…"
                      : "No pods match your filters."}
                  </td>
                </tr>
              ) : (
                filtered.map((pod) => {
                  const flows = podFlowStats(pod.id, snapshot.topology);
                  const totalFlows = flows.inbound + flows.outbound;
                  return (
                    <tr
                      key={pod.id}
                      className={`workloads-row status-${pod.status} ${selected?.id === pod.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(pod.id)}
                    >
                      <td>
                        <div className="workloads-pod-name">{pod.name}</div>
                        {pod.ports.length > 0 ? (
                          <div className="workloads-pod-sub">
                            {pod.ports.slice(0, 4).join(", ")}
                            {pod.ports.length > 4 ? "…" : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="events-mono">{pod.namespace}</td>
                      <td>
                        <span className={`workloads-status-pill status-${pod.status}`}>
                          {statusLabel(pod.status)}
                        </span>
                      </td>
                      <td className="events-mono">{pod.ip}</td>
                      <td className="events-mono">{totalFlows > 0 ? totalFlows : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <aside className="workloads-detail panel">
          <div className="panel-header">INSPECTOR</div>
          {!selected ? (
            <div className="workloads-detail-empty">Select a pod to inspect workload signals.</div>
          ) : (
            <div className="workloads-detail-body">
              <div className="workloads-detail-head">
                <div>
                  <div className="workloads-detail-name">{selected.name}</div>
                  <div className="workloads-detail-sub">
                    {selected.namespace} · {selected.ip}
                  </div>
                </div>
                <span className={`workloads-status-pill status-${selected.status}`}>
                  {statusLabel(selected.status)}
                </span>
              </div>

              <dl className="workloads-metrics">
                <div>
                  <dt>Inbound flows</dt>
                  <dd>{selectedFlows.inbound || "—"}</dd>
                </div>
                <div>
                  <dt>Outbound flows</dt>
                  <dd>{selectedFlows.outbound || "—"}</dd>
                </div>
                <div>
                  <dt>Ports</dt>
                  <dd>{selected.ports.length > 0 ? selected.ports.join(", ") : "—"}</dd>
                </div>
              </dl>

              {onViewInNetwork ? (
                <button type="button" className="workloads-network-btn" onClick={onViewInNetwork}>
                  View in Topology →
                </button>
              ) : null}

              <section className="workloads-detail-section">
                <div className="workloads-detail-heading">Open incidents</div>
                {selectedIncidents.length === 0 ? (
                  <div className="workloads-detail-muted">No open incidents for this pod.</div>
                ) : (
                  selectedIncidents.map((incident) => (
                    <article key={incident.id} className="workloads-incident">
                      <div className="workloads-incident-title">{incident.title}</div>
                      <div className="workloads-detail-muted">{incident.summary}</div>
                    </article>
                  ))
                )}
              </section>

              <section className="workloads-detail-section">
                <div className="workloads-detail-heading">Recent workload events</div>
                {selectedEvents.length === 0 ? (
                  <div className="workloads-detail-muted">No recent workload events for this pod.</div>
                ) : (
                  selectedEvents.map((event) => (
                    <article key={event.id} className={`workloads-event sev-${event.severity}`}>
                      <div className="workloads-event-meta">
                        <span>{formatTime(event.timestamp)}</span>
                        <span>{relativeTime(event.timestamp)}</span>
                      </div>
                      <div className="workloads-event-title">{event.title}</div>
                      <div className="workloads-detail-muted">{event.message}</div>
                    </article>
                  ))
                )}
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
