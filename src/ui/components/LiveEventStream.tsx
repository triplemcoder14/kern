import { useMemo, useState } from "react";
import type { MonitorEvent, MonitorSeverity, NetworkTalkKind } from "../../core/types/monitoring";
import { unlockAlertSound } from "../lib/alert-sound";
import { PageContextBar } from "./PageContextBar";

type SourceFilter = "all" | "kubernetes" | "network" | "degradation";

function isServiceTalkIssue(event: MonitorEvent): boolean {
  if (!event.networkTalk) {
    return false;
  }
  return (
    event.networkTalk.kind === "degraded" ||
    event.severity === "warning" ||
    event.severity === "critical"
  );
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

function severityLabel(severity: MonitorSeverity): string {
  if (severity === "critical") {
    return "ERR";
  }
  if (severity === "warning") {
    return "WRN";
  }
  return "INF";
}

function talkKindLabel(kind: NetworkTalkKind): string {
  if (kind === "started") {
    return "START";
  }
  if (kind === "degraded") {
    return "DEG";
  }
  return "END";
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
  soundMuted: boolean;
  onSoundMutedChange: (muted: boolean) => void;
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
  soundMuted,
  onSoundMutedChange,
}: LiveEventStreamProps) {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<MonitorSeverity | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const filtered = useMemo(() => {
    return events.filter((event) => {
      const nsMatch =
        namespaceFilter === "all" ||
        event.namespace === namespaceFilter ||
        !event.namespace;
      const severityMatch = severityFilter === "all" || event.severity === severityFilter;
      const sourceMatch =
        sourceFilter === "all" ||
        (sourceFilter === "network" && Boolean(event.networkTalk)) ||
        (sourceFilter === "degradation" && isServiceTalkIssue(event)) ||
        (sourceFilter === "kubernetes" && !event.networkTalk);
      const query = search.trim().toLowerCase();
      const searchMatch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.message.toLowerCase().includes(query) ||
        event.resourceName?.toLowerCase().includes(query) ||
        event.networkTalk?.path.toLowerCase().includes(query);
      return nsMatch && severityMatch && sourceMatch && searchMatch;
    });
  }, [events, namespaceFilter, severityFilter, sourceFilter, search]);

  const counts = useMemo(() => {
    const base = events.filter(
      (event) =>
        namespaceFilter === "all" ||
        event.namespace === namespaceFilter ||
        !event.namespace,
    );
    return {
      all: base.length,
      network: base.filter((event) => event.networkTalk).length,
      degradation: base.filter((event) => isServiceTalkIssue(event)).length,
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
          <p className="events-sub">
            Pod ↔ service talk from kernel flows — use Degradation for timeouts, drops, and path
            worsening
          </p>
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
            <button
              type="button"
              className={`events-btn events-sound-toggle ${soundMuted ? "muted" : "on"}`}
              title={
                soundMuted
                  ? "Unmute pod ↔ service talk sounds (start + degraded alerts)"
                  : "Mute pod ↔ service talk sounds (start + degraded alerts)"
              }
              onClick={() => {
                const nextMuted = !soundMuted;
                onSoundMutedChange(nextMuted);
                if (!nextMuted) {
                  void unlockAlertSound();
                }
              }}
            >
              {soundMuted ? "Sound off" : "Sound on"}
            </button>
            <button type="button" className="events-btn" onClick={() => onPausedChange(!paused)}>
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      </header>

      <div className="events-source-tabs">
        {(
          [
            ["all", "All", counts.all],
            ["network", "Network talk", counts.network],
            ["degradation", "Degradation", counts.degradation],
            ["kubernetes", "Kubernetes", counts.all - counts.network],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`events-source-tab ${sourceFilter === key ? "active" : ""}`}
            onClick={() => setSourceFilter(key)}
          >
            {label}
            <span className="events-source-count">{count}</span>
          </button>
        ))}
      </div>

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
              <th>PATH / OBJECT</th>
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
                    <div className="events-row-title">
                      {event.title}
                      {event.networkTalk ? (
                        <span className="talk-kind-pill">{talkKindLabel(event.networkTalk.kind)}</span>
                      ) : null}
                    </div>
                    <div className="events-row-msg">{event.message}</div>
                  </td>
                  <td className="events-mono">
                    {event.networkTalk?.path ??
                      (event.resourceKind && event.resourceName
                        ? `${event.resourceKind.toLowerCase()}/${event.resourceName}`
                        : "—")}
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
