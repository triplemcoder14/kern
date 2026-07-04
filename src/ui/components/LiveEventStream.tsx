import { useMemo, useState } from "react";
import type { MonitorEvent, MonitorSeverity } from "../../core/types/monitoring";
import { PageContextBar } from "./PageContextBar";

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

function severityLabel(severity: MonitorSeverity): string {
  if (severity === "critical") {
    return "ERR";
  }
  if (severity === "warning") {
    return "WRN";
  }
  return "INF";
}
interface LiveEventStreamProps {
  events: MonitorEvent[];
  clusterName: string;
  namespaceFilter: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  paused: boolean;
  onPausedChange: (value: boolean) => void;
}

export function LiveEventStream({
  events,
  clusterName,
  namespaceFilter,
  namespaces,
  onNamespaceChange,
  connected,
  paused,
  onPausedChange,
}: LiveEventStreamProps) {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<MonitorSeverity | "all">("all");

  const filtered = useMemo(() => {
    return events.filter((event) => {
      const nsMatch =
        namespaceFilter === "all" ||
        event.namespace === namespaceFilter ||
        !event.namespace;
      const severityMatch = severityFilter === "all" || event.severity === severityFilter;
      const query = search.trim().toLowerCase();
      const searchMatch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.message.toLowerCase().includes(query) ||
        event.resourceName?.toLowerCase().includes(query);
      return nsMatch && severityMatch && searchMatch;
    });
  }, [events, namespaceFilter, severityFilter, search]);

  const counts = useMemo(() => {
    const base = events.filter(
      (event) =>
        namespaceFilter === "all" ||
        event.namespace === namespaceFilter ||
        !event.namespace,
    );
    return {
      all: base.length,
      info: base.filter((e) => e.severity === "info").length,
      warning: base.filter((e) => e.severity === "warning").length,
      critical: base.filter((e) => e.severity === "critical").length,
    };
  }, [events, namespaceFilter]);

  const displayEvents = paused ? filtered.slice(0, filtered.length) : filtered;

  return (
    <div className="events-page">
      <header className="events-header">
        <div>
          <h1 className="events-title">Live Event Stream</h1>
          <p className="events-sub">Real-time cluster events from Kubernetes watch API</p>
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
              placeholder="Search events…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="button" className="events-btn" onClick={() => onPausedChange(!paused)}>
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      </header>

      <div className="events-stats">
        {(
          [
            ["all", "ALL", counts.all],
            ["info", "INFO", counts.info],
            ["warning", "WARNING", counts.warning],
            ["critical", "ERROR", counts.critical],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`stat-card ${(key === "all" && severityFilter === "all") || (key !== "all" && severityFilter === key) ? "active" : ""}`}
            onClick={() => setSeverityFilter(key === "all" ? "all" : key)}
          >
            <span className="stat-label">{label}</span>
            <span className="stat-value">{count}</span>
          </button>
        ))}
      </div>

      <div className="events-table-wrap">
        <table className="events-table">
          <thead>
            <tr>
              <th>TIME</th>
              <th>LVL</th>
              <th>EVENT</th>
              <th>OBJECT</th>
              <th>NS</th>
              <th>SRC</th>
            </tr>
          </thead>
          <tbody>
            {displayEvents.length === 0 ? (
              <tr>
                <td colSpan={6} className="events-empty">
                  {events.length === 0
                    ? "No events yet. Connect in Settings and wait a few seconds."
                    : namespaceFilter !== "all"
                      ? `No events in namespace "${namespaceFilter}". Try "All namespaces" above.`
                      : "No events match your filters."}
                </td>
              </tr>
            ) : (
              displayEvents.map((event) => (
                <tr key={event.id} className={`events-row sev-${event.severity}`}>
                  <td className="events-time">
                    <div>{formatTime(event.timestamp)}</div>
                    <div className="events-relative">{relativeTime(event.timestamp)}</div>
                  </td>
                  <td>
                    <span className={`sev-badge sev-${event.severity}`}>
                      {severityLabel(event.severity)}
                    </span>
                  </td>
                  <td className="events-body">
                    <div className="events-row-title">{event.title}</div>
                    <div className="events-row-msg">{event.message}</div>
                  </td>
                  <td className="events-mono">
                    {event.resourceKind && event.resourceName
                      ? `${event.resourceKind.toLowerCase()}/${event.resourceName}`
                      : "—"}
                  </td>
                  <td className="events-mono">{event.namespace ?? "—"}</td>
                  <td className="events-mono">{event.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="events-footer">
        <span>Auto-scroll {paused ? "Off" : "On"}</span>
        <span>
          Showing {displayEvents.length} event{displayEvents.length === 1 ? "" : "s"}
        </span>
      </footer>
    </div>
  );
}
