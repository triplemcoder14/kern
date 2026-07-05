import { useMemo, useState } from "react";
import type { Incident, MonitorEvent, MonitorSeverity } from "../../core/types/monitoring";
import { MiniSparkline } from "./LatencyHistogramChart";

type AlertTab = "active" | "acknowledged" | "resolved" | "silenced";

interface AlertRow {
  id: string;
  title: string;
  description: string;
  path?: string;
  cause?: string;
  alertSource?: Incident["alertSource"];
  severity: MonitorSeverity;
  cluster: string;
  namespace: string;
  source: string;
  triggeredAt: string;
  status: AlertTab | "resolved";
}

interface AlertsDashboardProps {
  incidents: Incident[];
  events: MonitorEvent[];
  clusterName: string;
  namespaces: string[];
  onResolve?: (incidentId: string) => void;
}

const PAGE_SIZE = 8;

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  if (mins < 1440) {
    return `${Math.floor(mins / 60)}h ago`;
  }
  return `${Math.floor(mins / 1440)}d ago`;
}

function severityLabel(severity: MonitorSeverity): string {
  if (severity === "critical") {
    return "Critical";
  }
  if (severity === "warning") {
    return "Warning";
  }
  return "Info";
}

function buildSparkSeries(events: MonitorEvent[], severity: MonitorSeverity): number[] {
  const buckets = Array.from({ length: 12 }, () => 0);
  const now = Date.now();
  for (const event of events) {
    if (event.severity !== severity) {
      continue;
    }
    const ageMin = Math.floor((now - new Date(event.timestamp).getTime()) / 60_000);
    const index = Math.min(buckets.length - 1, Math.floor(ageMin / 5));
    buckets[buckets.length - 1 - index] += 1;
  }
  return buckets;
}

function incidentToRow(incident: Incident, clusterName: string): AlertRow {
  const source =
    incident.path ??
    (incident.resourceKind && incident.resourceName
      ? `${incident.resourceName} / ${incident.resourceKind}`
      : incident.category);

  return {
    id: incident.id,
    title: incident.title,
    description: incident.summary,
    path: incident.path,
    cause: incident.cause,
    alertSource: incident.alertSource,
    severity: incident.severity,
    cluster: clusterName,
    namespace: incident.namespace ?? "default",
    source,
    triggeredAt: incident.openedAt,
    status: incident.status === "resolved" ? "resolved" : "active",
  };
}

function eventToRow(event: MonitorEvent, clusterName: string): AlertRow {
  const source =
    event.resourceKind && event.resourceName
      ? `${event.resourceName} / ${event.resourceKind}`
      : event.source;

  return {
    id: event.id,
    title: event.title,
    description: event.message,
    severity: event.severity,
    cluster: clusterName,
    namespace: event.namespace ?? "default",
    source,
    triggeredAt: event.timestamp,
    status: "active",
  };
}

function SummaryCard({
  label,
  count,
  hint,
  tone,
  series,
}: {
  label: string;
  count: number;
  hint: string;
  tone: "critical" | "warning" | "info" | "resolved";
  series: number[];
}) {
  return (
    <article className={`alert-summary-card tone-${tone}`}>
      <div className="alert-summary-top">
        <span className={`alert-summary-icon tone-${tone}`} aria-hidden />
        <div>
          <div className="alert-summary-label">{label}</div>
          <div className="alert-summary-count">{count}</div>
        </div>
      </div>
      <div className="alert-summary-hint">{hint}</div>
      <div className="alert-summary-spark">
        <MiniSparkline series={series.length ? series : [0, 0, 0, 0]} />
      </div>
    </article>
  );
}

export function AlertsDashboard({
  incidents,
  events,
  clusterName,
  namespaces,
  onResolve,
}: AlertsDashboardProps) {
  const [tab, setTab] = useState<AlertTab>("active");
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<MonitorSeverity | "all">("all");
  const [namespaceFilter, setNamespaceFilter] = useState("all");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const incidentRows = incidents.map((item) => incidentToRow(item, clusterName));
    const infoRows = events
      .filter((event) => event.severity === "info")
      .slice(0, 40)
      .map((event) => eventToRow(event, clusterName));

    const merged = new Map<string, AlertRow>();
    for (const row of [...incidentRows, ...infoRows]) {
      merged.set(row.id, row);
    }
    return [...merged.values()].sort(
      (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime(),
    );
  }, [incidents, events, clusterName]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const tabMatch =
        tab === "active"
          ? row.status === "active"
          : tab === "resolved"
            ? row.status === "resolved"
            : tab === "acknowledged" || tab === "silenced"
              ? false
              : true;

      const severityMatch = severityFilter === "all" || row.severity === severityFilter;
      const nsMatch = namespaceFilter === "all" || row.namespace === namespaceFilter;
      const query = search.trim().toLowerCase();
      const searchMatch =
        !query ||
        row.title.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query) ||
        row.source.toLowerCase().includes(query);

      return tabMatch && severityMatch && nsMatch && searchMatch;
    });
  }, [rows, tab, severityFilter, namespaceFilter, search]);

  const counts = useMemo(() => {
    const active = rows.filter((row) => row.status === "active");
    return {
      critical: active.filter((row) => row.severity === "critical").length,
      warning: active.filter((row) => row.severity === "warning").length,
      info: rows.filter((row) => row.severity === "info").length,
      resolved: rows.filter((row) => row.status === "resolved").length,
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const sparkCritical = buildSparkSeries(events, "critical");
  const sparkWarning = buildSparkSeries(events, "warning");
  const sparkInfo = buildSparkSeries(events, "info");

  return (
    <div className="alerts-page">
      <header className="alerts-header">
        <div>
          <h1 className="alerts-title">Alerts</h1>
          <div className="alerts-tabs">
            {(
              [
                ["active", "Active"],
                ["acknowledged", "Acknowledged"],
                ["resolved", "Resolved"],
                ["silenced", "Silenced"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`alerts-tab ${tab === id ? "active" : ""}`}
                onClick={() => {
                  setTab(id);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="alerts-header-actions">
          <select className="alerts-select" value={clusterName} disabled>
            <option>{clusterName}</option>
          </select>
          <select className="alerts-select" defaultValue="1h">
            <option value="1h">Last 1 hour</option>
            <option value="24h">Last 24 hours</option>
          </select>
        </div>
      </header>

      <section className="alert-summary-grid">
        <SummaryCard
          label="Critical"
          count={counts.critical}
          hint="Requires immediate attention"
          tone="critical"
          series={sparkCritical}
        />
        <SummaryCard
          label="Warning"
          count={counts.warning}
          hint="Needs attention"
          tone="warning"
          series={sparkWarning}
        />
        <SummaryCard
          label="Info"
          count={counts.info}
          hint="For your information"
          tone="info"
          series={sparkInfo}
        />
        <SummaryCard
          label="Resolved"
          count={counts.resolved}
          hint="In the last 24h"
          tone="resolved"
          series={[0, 1, 2, counts.resolved, Math.max(0, counts.resolved - 1), counts.resolved]}
        />
      </section>

      <section className="alerts-toolbar">
        <label className="alerts-search-wrap">
          <span className="alerts-search-icon" aria-hidden>
            ⌕
          </span>
          <input
            className="alerts-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search alerts…"
          />
        </label>
        <select
          className="alerts-select"
          value={severityFilter}
          onChange={(event) => {
            setSeverityFilter(event.target.value as MonitorSeverity | "all");
            setPage(1);
          }}
        >
          <option value="all">Severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select
          className="alerts-select"
          value={namespaceFilter}
          onChange={(event) => {
            setNamespaceFilter(event.target.value);
            setPage(1);
          }}
        >
          <option value="all">Namespace</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="alerts-clear"
          onClick={() => {
            setSearch("");
            setSeverityFilter("all");
            setNamespaceFilter("all");
            setPage(1);
          }}
        >
          Clear filters
        </button>
      </section>

      <section className="alerts-table-wrap panel">
        <table className="alerts-table">
          <thead>
            <tr>
              <th />
              <th>Alert</th>
              <th>Severity</th>
              <th>Cluster / Namespace</th>
              <th>Source</th>
              <th>Triggered</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="alerts-empty">
                  No alerts in this view
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${row.title}`} />
                  </td>
                  <td>
                    <div className="alert-row-title">
                      {row.title}
                      {row.alertSource === "flow" ? (
                        <span className="alert-source-pill">flow</span>
                      ) : null}
                    </div>
                    <div className="alert-row-desc">{row.description}</div>
                    {row.path ? <div className="alert-row-path">{row.path}</div> : null}
                    {row.cause ? <div className="alert-row-cause">{row.cause}</div> : null}
                  </td>
                  <td>
                    <span className={`alert-pill severity-${row.severity}`}>
                      {severityLabel(row.severity)}
                    </span>
                  </td>
                  <td>
                    <div>{row.cluster}</div>
                    <div className="alert-row-sub">{row.namespace}</div>
                  </td>
                  <td>{row.source}</td>
                  <td>{relativeTime(row.triggeredAt)}</td>
                  <td>
                    <span className={`alert-pill status-${row.status === "resolved" ? "resolved" : row.severity}`}>
                      {row.status === "resolved" ? "Resolved" : "Active"}
                    </span>
                  </td>
                  <td className="alert-actions">
                    {row.status === "active" && onResolve && row.id.startsWith("incident-") ? (
                      <button type="button" className="alert-action-btn" onClick={() => onResolve(row.id)}>
                        Resolve
                      </button>
                    ) : (
                      <span className="alert-menu">⋯</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <footer className="alerts-pagination">
        <span>
          Showing {(currentPage - 1) * PAGE_SIZE + (pageRows.length ? 1 : 0)} to{" "}
          {(currentPage - 1) * PAGE_SIZE + pageRows.length} of {filtered.length} alerts
        </span>
        <div className="alerts-pagination-controls">
          <button
            type="button"
            className="alerts-page-btn"
            disabled={currentPage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, index) => index + 1)
            .slice(0, 5)
            .map((value) => (
              <button
                key={value}
                type="button"
                className={`alerts-page-btn ${currentPage === value ? "active" : ""}`}
                onClick={() => setPage(value)}
              >
                {value}
              </button>
            ))}
          <button
            type="button"
            className="alerts-page-btn"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            ›
          </button>
        </div>
      </footer>
    </div>
  );
}
