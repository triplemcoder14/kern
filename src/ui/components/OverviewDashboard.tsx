import { useMemo, useState } from "react";
import { filterNetworkSnapshot } from "../../core/network/scope";
import { buildGraphLayout, type GraphLod } from "../../core/network/graph-model";
import { buildOverviewStats } from "../../core/network/network-insights";
import type { ClusterHealthSnapshot, Incident, MonitorEvent } from "../../core/types/monitoring";
import type { EbpfCollectorStatus, NetworkSnapshot } from "../../core/types/network";
import type { NavId, NavPage } from "./AppShell";
import { PageHeader } from "./PageHeader";
import { TopologyGraph } from "./TopologyGraph";

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

function signalKind(event: MonitorEvent): string {
  if (event.networkTalk) {
    const port = event.networkTalk.port;
    if (port === 53) {
      return "DNS";
    }
    if (event.networkTalk.protocol === "TCP") {
      return "TCP";
    }
    return event.networkTalk.protocol.toUpperCase();
  }
  if (event.category === "workload") {
    return "Workload";
  }
  if (event.category === "network") {
    return "Network";
  }
  if (event.title.toLowerCase().includes("memory") || event.message.toLowerCase().includes("psi")) {
    return "Memory";
  }
  if (event.title.toLowerCase().includes("dns") || event.message.toLowerCase().includes("nxdomain")) {
    return "DNS";
  }
  return event.category.toUpperCase();
}

function signalSubject(event: MonitorEvent): string {
  if (event.networkTalk) {
    return event.networkTalk.path || event.networkTalk.dstName;
  }
  if (event.resourceName) {
    return event.namespace ? `${event.namespace}/${event.resourceName}` : event.resourceName;
  }
  return event.title;
}

function signalDetail(event: MonitorEvent): string {
  if (event.networkTalk) {
    const talk = event.networkTalk;
    const latency = talk.latencyMs !== undefined ? ` · ${Math.round(talk.latencyMs)}ms` : "";
    return `${talk.verdict}${latency}`;
  }
  return event.message || event.title;
}

function signalNavigate(event: MonitorEvent): { nav: NavId; page: NavPage } {
  const kind = signalKind(event);
  if (kind === "DNS") {
    return { nav: "network", page: "network-dns" };
  }
  if (kind === "TCP" || kind === "Network") {
    return { nav: "network", page: "network-tcp" };
  }
  if (kind === "Memory") {
    return { nav: "profiling", page: "profiling" };
  }
  return { nav: "events", page: "events" };
}

function incidentSubject(incident: Incident): string {
  if (incident.resourceName) {
    return incident.resourceName;
  }
  if (incident.path) {
    return incident.path;
  }
  return incident.title;
}

function pressureLabel(stats: {
  tcpRetransmits: number;
  tcpDrops: number;
  dnsFailures: number;
  p95LatencyMs?: number;
}): string {
  if (stats.tcpDrops > 0 || stats.dnsFailures > 3) {
    return "Elevated";
  }
  if (stats.tcpRetransmits > 0 || (stats.p95LatencyMs ?? 0) > 80) {
    return "Watch";
  }
  return "Low";
}

function buildHealthRibbon(
  health: ClusterHealthSnapshot,
  stats: ReturnType<typeof buildOverviewStats>,
  ebpf: EbpfCollectorStatus,
): Array<{ id: string; label: string; state: "ok" | "warn" | "bad" | "off" }> {
  const dnsState =
    stats.dnsFailures > 5 ? "bad" : stats.dnsFailures > 0 ? "warn" : health.connected ? "ok" : "off";
  const tcpState =
    stats.tcpDrops > 0
      ? "bad"
      : stats.tcpRetransmits > 0
        ? "warn"
        : health.connected
          ? "ok"
          : "off";
  /* Placeholder signals (not wired to real metrics yet):
  const cpuState = health.connected ? "ok" : "off";
  const memoryState = health.failedPods > 0 ? "warn" : health.connected ? "ok" : "off";
  const storageState = health.connected ? "ok" : "off";
  */
  const clusterState =
    health.health === "healthy"
      ? "ok"
      : health.health === "degraded"
        ? "warn"
        : health.health === "critical"
          ? "bad"
          : "off";

  return [
    { id: "cluster", label: `Cluster ${healthLabel(health.health)}`, state: clusterState },
    // { id: "cpu", label: "CPU Normal", state: cpuState },
    // { id: "memory", label: memoryState === "warn" ? "Memory Watch" : "Memory Normal", state: memoryState },
    {
      id: "dns",
      label: dnsState === "ok" ? "DNS Healthy" : dnsState === "warn" ? "DNS Warning" : dnsState === "bad" ? "DNS Failing" : "DNS Offline",
      state: dnsState,
    },
    {
      id: "tcp",
      label: tcpState === "ok" ? "TCP Healthy" : tcpState === "warn" ? "TCP Retransmits" : tcpState === "bad" ? "TCP Drops" : "TCP Offline",
      state: tcpState,
    },
    {
      id: "agent",
      label: ebpf.connected ? "eBPF Live" : "Agent Offline",
      state: ebpf.connected ? "ok" : "off",
    },
    // { id: "storage", label: "Storage Healthy", state: storageState },
  ];
}

function KernelRuntime({ ebpf }: { ebpf: EbpfCollectorStatus }) {
  const programs = ebpf.programsAttached ?? 0;
  const flows = ebpf.flowsPerSecond ?? 0;
  return (
    <div className="overview-agent-card panel">
      {/* <div className="panel-header">KERN AGENT</div> */}
      {/* <div className="panel-header">KERNEL TELEMETRY</div> */}
      <div className="panel-header">KERNEL RUNTIME</div>
      <div className="overview-agent-body">
        <div className={`overview-agent-status ${ebpf.connected ? "on" : ""}`}>
          {ebpf.connected ? "eBPF runtime active" : "Collector offline"}
        </div>
        <p className="overview-agent-message">
          {ebpf.message ?? ebpf.collectorUrl ?? "Configure agent URL in Settings"}
        </p>
        {ebpf.connected ? (
          <dl className="overview-agent-metrics overview-agent-metrics-rich">
            <div>
              <dt>Programs</dt>
              <dd>{programs}</dd>
            </div>
            <div>
              <dt>Flows/s</dt>
              <dd>{flows}</dd>
            </div>
            <div>
              <dt>Pods indexed</dt>
              <dd>{ebpf.podsIndexed ?? 0}</dd>
            </div>
            <div>
              <dt>Services</dt>
              <dd>{ebpf.servicesIndexed ?? 0}</dd>
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [lod, setLod] = useState<GraphLod>("service");

  const scoped = useMemo(
    () => filterNetworkSnapshot(snapshot, namespace),
    [snapshot, namespace],
  );
  const layout = useMemo(
    () => buildGraphLayout(scoped.topology, scoped.flows, { lod }),
    [scoped.topology, scoped.flows, lod],
  );
  const stats = useMemo(() => buildOverviewStats(scoped, layout.edges), [scoped, layout.edges]);
  const ribbon = useMemo(
    () => buildHealthRibbon(health, stats, snapshot.ebpf),
    [health, stats, snapshot.ebpf],
  );
  const pressure = pressureLabel(stats);

  const recentSignals = useMemo(() => {
    return events
      .filter((event) => event.severity !== "info")
      .slice(0, 8);
  }, [events]);

  const investigations = [
    { nav: "network" as const, page: "network-map" as const, label: "View Service Map", hint: "Live topology" },
    { nav: "profiling" as const, page: "profiling" as const, label: "Open CPU Profiler", hint: "Flamegraphs" },
    { nav: "network" as const, page: "network-dns" as const, label: "Inspect DNS", hint: "Resolution failures" },
    { nav: "alerts" as const, page: "alerts" as const, label: "View Incidents", hint: "Open problems" },
  ];

  return (
    <div className="overview-page">
      <PageHeader
        title="Overview"
        subtitle="Live kernel view of what is talking, failing, and waiting"
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
      />

      <div className="overview-ribbon" aria-label="Cluster health">
        {ribbon.map((item) => (
          <div key={item.id} className={`overview-ribbon-item state-${item.state}`}>
            <span className="overview-ribbon-dot" aria-hidden />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <section className="overview-hero-map panel">
        <div className="overview-hero-map-head">
          <div>
            <div className="overview-hero-label">Live Service Map</div>
            <div className="overview-hero-metrics">
              <div className="overview-hero-metric">
                <span className="overview-hero-metric-value">{layout.edges.length}</span>
                <span className="overview-hero-metric-label">routes</span>
              </div>
              <div className="overview-hero-metric">
                <span className="overview-hero-metric-value">{health.eventsPerMinute}</span>
                <span className="overview-hero-metric-label">events/min</span>
              </div>
              <div className="overview-hero-metric">
                <span className="overview-hero-metric-value">
                  {stats.p95LatencyMs !== undefined ? `${Math.round(stats.p95LatencyMs)}ms` : "—"}
                </span>
                <span className="overview-hero-metric-label">p95</span>
              </div>
            </div>
          </div>
          <div className="overview-investigate">
            <div className="overview-investigate-label">Investigate</div>
            <div className="overview-investigate-actions">
              {investigations.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="overview-investigate-btn"
                  onClick={() => onNavigate(item.nav, item.page)}
                >
                  <span>{item.label}</span>
                  <span className="overview-investigate-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overview-hero-map-body">
          <div className="overview-topology-wrap">
            <TopologyGraph
              layout={layout}
              connected={connected}
              selectedEdgeId={selectedEdgeId}
              onSelectEdge={(id) => {
                setSelectedEdgeId(id);
              }}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              lod={lod}
              onLodChange={setLod}
              showLegend
              showInspectPanel
              onNavigate={onNavigate}
            />
          </div>
        </div>
      </section>

      <div className="events-stats overview-stats">
        {(
          [
            ["PODS", health.podCount],
            ["PRESSURE", pressure],
            ["FLOWS/S", stats.requestsPerSec],
            ["P95", stats.p95LatencyMs !== undefined ? `${Math.round(stats.p95LatencyMs)}ms` : "—"],
            ["RETRANSMITS", stats.tcpRetransmits],
            ["INCIDENTS", health.openIncidents],
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
                <div className="overview-incident-title">{incidentSubject(incident)}</div>
                <div className="overview-incident-sub">{incident.summary || incident.title}</div>
                <div className="overview-incident-meta">
                  <span>{incident.namespace ?? "cluster"}</span>
                  <span>{relativeTime(incident.updatedAt || incident.openedAt)}</span>
                </div>
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
              <button
                key={event.id}
                type="button"
                className={`overview-signal sev-${event.severity} overview-signal-btn`}
                onClick={() => {
                  const target = signalNavigate(event);
                  onNavigate(target.nav, target.page);
                }}
              >
                <div className="overview-signal-kind">{signalKind(event)}</div>
                <div className="overview-signal-body">
                  <div className="overview-incident-title">{signalSubject(event)}</div>
                  <div className="overview-incident-sub">{signalDetail(event)}</div>
                </div>
                <div className="overview-signal-time">{relativeTime(event.timestamp)}</div>
              </button>
            ))
          )}
        </section>

        <KernelRuntime ebpf={snapshot.ebpf} />
      </div>
    </div>
  );
}
