import type {
  ClusterHealthSnapshot,
  ConnectClusterResult,
  Incident,
  MonitorEvent,
} from "../../core/types/monitoring";

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function severityClass(severity: MonitorEvent["severity"] | Incident["severity"]): string {
  if (severity === "critical") {
    return "sev-critical";
  }
  if (severity === "warning") {
    return "sev-warning";
  }
  return "sev-info";
}

interface MonitorTopBarProps {
  health: ClusterHealthSnapshot;
  connection: ConnectClusterResult | null;
  openIncidents: number;
}

export function MonitorTopBar({ health, connection, openIncidents }: MonitorTopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">KERN</span>
        </div>
        <span className="version">v0.2 monitor</span>
      </div>

      <div className="topbar-right">
        <span className="cluster-label">{connection?.clusterName ?? "not connected"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`status-dot health-${health.health}`} />
          <span>{health.connected ? health.health.toUpperCase() : "OFFLINE"}</span>
        </div>
        <span className="stats">
          <span>{openIncidents} INCIDENTS</span>
          <span>{health.eventsPerMinute} EVT/MIN</span>
        </span>
      </div>
    </header>
  );
}

interface EventStreamProps {
  events: MonitorEvent[];
}

export function EventStream({ events }: EventStreamProps) {
  return (
    <section className="panel event-panel">
      <div className="panel-header">LIVE EVENT STREAM</div>
      <div className="stream-list">
        {events.length === 0 ? (
          <div className="empty-state">No events yet.</div>
        ) : (
          events.map((event) => (
            <article key={event.id} className={`stream-item ${severityClass(event.severity)}`}>
              <div className="stream-meta">
                <span>{formatTime(event.timestamp)}</span>
                <span>{event.category.toUpperCase()}</span>
                <span>{event.severity.toUpperCase()}</span>
              </div>
              <div className="stream-title">{event.title}</div>
              <div className="stream-message">{event.message}</div>
              {event.resourceKind ? (
                <div className="stream-resource">
                  {event.resourceKind}/{event.resourceName} · {event.namespace}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

interface IncidentsPanelProps {
  incidents: Incident[];
  onResolve: (incidentId: string) => void;
}

export function IncidentsPanel({ incidents, onResolve }: IncidentsPanelProps) {
  const open = incidents.filter((incident) => incident.status === "open");

  return (
    <section className="panel incidents-panel">
      <div className="panel-header">INCIDENTS</div>
      <div className="incidents-list">
        {open.length === 0 ? (
          <div className="empty-state">No open incidents.</div>
        ) : (
          open.map((incident) => (
            <article key={incident.id} className={`incident-item ${severityClass(incident.severity)}`}>
              <div className="incident-head">
                <span className="incident-title">{incident.title}</span>
                <button type="button" className="btn-del" onClick={() => onResolve(incident.id)}>
                  RESOLVE
                </button>
              </div>
              <div className="incident-summary">{incident.summary}</div>
              <div className="incident-meta">
                {incident.category} · {incident.namespace ?? "cluster"}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

interface NetworkPanelProps {
  events: MonitorEvent[];
}

export function NetworkPanel({ events }: NetworkPanelProps) {
  return (
    <section className="panel network-panel">
      <div className="panel-header">NETWORK & SERVICE SIGNALS</div>
      <div className="network-list">
        {events.length === 0 ? (
          <div className="empty-state">No network events.</div>
        ) : (
          events.slice(0, 12).map((event) => (
            <div key={event.id} className={`network-item ${severityClass(event.severity)}`}>
              <span>{formatTime(event.timestamp)}</span>
              <span>{event.title}</span>
              <span>{event.resourceName ?? event.namespace ?? "cluster"}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

interface CostPanelProps {
  connected: boolean;
}

export function CostPanel({ connected }: CostPanelProps) {
  if (!connected) {
    return null;
  }

  return (
    <section className="panel cost-panel">
      <div className="panel-header">COST</div>
      <div className="cost-body">
        <div className="empty-state">Coming soon.</div>
      </div>
    </section>
  );
}

interface MonitorStatusBarProps {
  error: string | null;
  busy: boolean;
  connected: boolean;
}

export function MonitorStatusBar({ error, busy, connected }: MonitorStatusBarProps) {
  return (
    <footer className="statusbar">
      <span className={`statusbar-msg ${error ? "error" : ""}`}>
        {error ??
          (busy ? "CONNECTING..." : connected ? "MONITORING LIVE CLUSTER" : "AWAITING CONNECTION")}
      </span>
      <span className="statusbar-meta">WATCH API · INCIDENT ENGINE · BROWSER MONITOR</span>
    </footer>
  );
}
