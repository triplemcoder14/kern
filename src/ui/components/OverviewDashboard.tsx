import { useMemo } from "react";
import type { ClusterHealthSnapshot, Incident, MonitorEvent } from "../../core/types/monitoring";
import type { EbpfCollectorStatus, NetworkSnapshot } from "../../core/types/network";
import type { NavId, NavPage } from "./AppShell";
import { PageHeader } from "./PageHeader";

interface OverviewDashboardProps {
  health: ClusterHealthSnapshot;
  snapshot: NetworkSnapshot;
  events: MonitorEvent[];
  openIncidents: Incident[];
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  onNavigate: (nav: NavId, page: NavPage) => void;
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

function healthLabel(health: ClusterHealthSnapshot["health"]): string {
  if (health === "healthy") {
    return "Healthy";
  }
  if (health === "degraded") {
    return "Degraded";
  }
  if (health === "critical") {
    return "Critical";
  }
  return "Disconnected";
}

function EbpfSummary({ ebpf }: { ebpf: EbpfCollectorStatus }) {
  return (
    <div className="overview-agent-card panel">
      <div className="panel-header">KERN AGENT</div>
      <div className="overview-agent-body">
        <div className={`overview-agent-status ${ebpf.connected ? "on" : ""}`}>
          {ebpf.connected ? "Collector connected" : "Collector offline"}
        </div>
        <p className="overview-agent-message">
          {ebpf.message ?? ebpf.collectorUrl ?? "Configure agent URL in Settings"}
        </p>
        {ebpf.connected ? (
          <dl className="overview-agent-metrics">
            <div>
              <dt>Mode</dt>
              <dd>{ebpf.mode ?? "—"}</dd>
            </div>
            <div>
              <dt>Flows/s</dt>
              <dd>{ebpf.flowsPerSecond ?? 0}</dd>
            </div>
            <div>
              <dt>Pods indexed</dt>
              <dd>{ebpf.podsIndexed ?? 0}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

export function OverviewDashboard({
  health,
  snapshot,
  events,
  openIncidents,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
  onNavigate,
}: OverviewDashboardProps) {
  const recentSignals = useMemo(() => {
    return events
      .filter((event) => event.severity !== "info")
      .slice(0, 6);
  }, [events]);

  const routeCount = snapshot.topology.edges.length;
  const flowCount = snapshot.flows.length;

  return (
    <div className="overview-page">
      <PageHeader
        title="Overview"
        subtitle="Kernel-native service map — what is talking to what"
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
      />

      <div className="overview-hero panel">
        <div className="overview-hero-copy">
          <div className="overview-hero-label">Cluster status</div>
          <div className={`overview-hero-value health-${health.health}`}>
            {healthLabel(health.health)}
          </div>
          <p className="overview-hero-sub">
            {routeCount} service routes · {flowCount} captured flows · {health.eventsPerMinute} evt/min
          </p>
        </div>
        <div className="overview-quick-nav">
          {(
            [
              ["topology", "topology", "Topology"],
              ["flows", "flows", "Flows"],
              ["workloads", "workloads", "Workloads"],
              ["alerts", "alerts", "Alerts"],
            ] as const
          ).map(([nav, page, label]) => (
            <button
              key={nav}
              type="button"
              className="overview-quick-btn"
              onClick={() => onNavigate(nav, page)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="events-stats overview-stats">
        {(
          [
            ["PODS", health.podCount],
            ["RUNNING", health.runningPods],
            ["FAILED", health.failedPods],
            ["SERVICES", health.serviceCount],
            ["INCIDENTS", health.openIncidents],
            ["FLOWS", flowCount],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="stat-card stat-card-static">
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
          </div>
        ))}
      </div>

      <div className="overview-grid">
        <section className="panel overview-panel">
          <div className="panel-header">OPEN INCIDENTS</div>
          {openIncidents.length === 0 ? (
            <div className="overview-empty">No open incidents.</div>
          ) : (
            openIncidents.slice(0, 5).map((incident) => (
              <article key={incident.id} className={`overview-incident sev-${incident.severity}`}>
                <div className="overview-incident-title">{incident.title}</div>
                <div className="overview-incident-sub">{incident.summary}</div>
              </article>
            ))
          )}
        </section>

        <section className="panel overview-panel">
          <div className="panel-header">RECENT SIGNALS</div>
          {!connected ? (
            <div className="overview-empty">Connect in Settings to start monitoring.</div>
          ) : recentSignals.length === 0 ? (
            <div className="overview-empty">No warning or critical events recently.</div>
          ) : (
            recentSignals.map((event) => (
              <article key={event.id} className={`overview-signal sev-${event.severity}`}>
                <div className="overview-signal-meta">
                  <span>{event.severity.toUpperCase()}</span>
                  <span>{relativeTime(event.timestamp)}</span>
                </div>
                <div className="overview-incident-title">{event.title}</div>
              </article>
            ))
          )}
        </section>

        <EbpfSummary ebpf={snapshot.ebpf} />
      </div>
    </div>
  );
}
