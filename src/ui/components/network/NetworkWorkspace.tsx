import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildOverviewStats,
  buildPathRows,
  rankRetransmitEdges,
  rankSlowEdges,
  recentDroppedFlows,
  type NetworkPathRow,
} from "../../../core/network/network-insights";
import { buildGraphLayout, type GraphEdgeLayout, type GraphLod } from "../../../core/network/graph-model";
import { protocolClassLabel } from "../../../core/network/protocol-class";
import { filterNetworkSnapshot } from "../../../core/network/scope";
import {
  filterSnapshotForInvestigation,
} from "../../../core/network/investigation-scope";
import type { NetworkFlow, NetworkSnapshot } from "../../../core/types/network";
import { useInvestigationLayout } from "../../hooks/useInvestigationLayout";
import { useFrozenWhileSelected, useStickyById } from "../../hooks/useStickySelection";
import { useInvestigationHistoryFlows } from "../../hooks/useInvestigationHistoryFlows";
import type { InvestigationFocus, StartInvestigation } from "../../investigation/types";
import {
  investigationLabel,
  investigationWindowLabel,
  investigationWindowMs,
} from "../../investigation/types";
import type { NavId, NavPage } from "../AppShell";
import { EdgeLatencyBoard } from "../EdgeLatencyBoard";
import { FlowDetailPanel } from "../FlowDetailPanel";
import { LiveFlowsTable } from "../LiveFlowsTable";
import { PageHeader } from "../PageHeader";
import { GraphLegend, TopologyGraph } from "../TopologyGraph";
import { DnsTab } from "./DnsTab";
import { ProtocolsTab } from "./ProtocolsTab";
import { TcpHealthTab } from "./TcpHealthTab";

export type NetworkWorkspaceTab =
  | "overview"
  | "map"
  | "flows"
  | "dns"
  | "protocols"
  | "tcp";

interface NetworkWorkspaceProps {
  snapshot: NetworkSnapshot;
  connected: boolean;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  initialTab?: NetworkWorkspaceTab;
  investigation?: InvestigationFocus | null;
  onStartInvestigation?: StartInvestigation;
  onNavigate?: (nav: NavId, page: NavPage) => void;
}

const TABS: Array<{ id: NetworkWorkspaceTab; label: string; ready: boolean }> = [
  { id: "overview", label: "Overview", ready: true },
  { id: "map", label: "Service Map", ready: true },
  { id: "flows", label: "Flows", ready: true },
  { id: "dns", label: "DNS", ready: true },
  { id: "protocols", label: "Protocols", ready: true },
  { id: "tcp", label: "TCP Health", ready: true },
];

function formatMs(value?: number): string {
  return value === undefined ? "—" : `${Math.round(value)}ms`;
}

function formatRate(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function EbpfPanel({ snapshot }: { snapshot: NetworkSnapshot }) {
  const ebpf = snapshot.ebpf;
  const checks = [
    { label: "Collector reachable", ok: ebpf.connected },
    {
      label: ebpf.mode?.includes("hubble")
        ? "Hubble stream"
        : ebpf.mode?.includes("ebpf")
          ? "eBPF stream"
          : "ProcNet stream",
      ok: ebpf.connected,
    },
    { label: "Programs attached", ok: ebpf.connected && (ebpf.programsAttached ?? 0) > 0 },
    { label: "Pod IP index", ok: ebpf.connected && (ebpf.podsIndexed ?? 0) > 0 },
  ];

  return (
    <section className="panel network-agent-panel">
      <div className="panel-header">eBPF COLLECTOR</div>
      <ul className="obs-checklist network-checklist">
        {checks.map((check) => (
          <li key={check.label} className={check.ok ? "ok" : ""}>
            <span className="obs-check-mark">{check.ok ? "✓" : "○"}</span>
            {check.label}
          </li>
        ))}
      </ul>
      <div className="network-agent-caption">{ebpf.message ?? ebpf.collectorUrl}</div>
      {ebpf.connected ? (
        <dl className="network-agent-metrics">
          <div>
            <dt>Flows/s</dt>
            <dd>{ebpf.flowsPerSecond ?? 0}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{ebpf.mode ?? "—"}</dd>
          </div>
          <div>
            <dt>Pods indexed</dt>
            <dd>{ebpf.podsIndexed ?? 0}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function OverviewTab({
  snapshot,
  edges,
  flows,
  onOpenMap,
  onOpenFlows,
  onSelectEdge,
}: {
  snapshot: NetworkSnapshot;
  edges: GraphEdgeLayout[];
  flows: NetworkFlow[];
  onOpenMap: () => void;
  onOpenFlows: () => void;
  onSelectEdge: (id: string) => void;
}) {
  const stats = useMemo(() => buildOverviewStats(snapshot, edges), [snapshot, edges]);
  const slow = useMemo(() => rankSlowEdges(edges, 6), [edges]);
  const retransmit = useMemo(() => rankRetransmitEdges(edges, flows, 6), [edges, flows]);
  const dropped = useMemo(() => recentDroppedFlows(flows, 8), [flows]);

  const cards = [
    { label: "Active Flows", value: formatRate(stats.activeFlows) },
    { label: "Services", value: String(stats.services) },
    { label: "Requests/sec", value: formatRate(stats.requestsPerSec) },
    { label: "P95 Latency", value: formatMs(stats.p95LatencyMs) },
    { label: "TCP Drops", value: String(stats.tcpDrops) },
    { label: "TCP Retransmits", value: String(stats.tcpRetransmits) },
    { label: "DNS Failures", value: String(stats.dnsFailures) },
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
          <div className="panel-header">
            TOP SLOW SERVICE PATHS
            <button type="button" className="network-ws-link" onClick={onOpenMap}>
              Open map
            </button>
          </div>
          {slow.length === 0 ? (
            <div className="empty-state">No ranked paths yet — generate pod traffic.</div>
          ) : (
            <ul className="network-ws-list">
              {slow.map((edge) => (
                <li key={edge.id}>
                  <button type="button" onClick={() => onSelectEdge(edge.id)}>
                    <span className="network-ws-list-main">{edge.routeName}</span>
                    <span className="network-ws-list-meta">
                      {edge.protocol}:{edge.port} · p95 {formatMs(edge.latencyP95Ms)} ·{" "}
                      {edge.flowCount} flows
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">HIGHEST RETRANSMIT ROUTES</div>
          {retransmit.length === 0 ? (
            <div className="empty-state">No retransmit signals in this window.</div>
          ) : (
            <ul className="network-ws-list">
              {retransmit.map((edge) => (
                <li key={edge.id}>
                  <button type="button" onClick={() => onSelectEdge(edge.id)}>
                    <span className="network-ws-list-main">{edge.routeName}</span>
                    <span className="network-ws-list-meta">
                      retransmits {edge.retransmits} · {edge.flowCount} flows
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <EbpfPanel snapshot={snapshot} />
      </div>

      <div className="network-ws-split">
        <EdgeLatencyBoard
          edges={edges}
          selectedEdgeId={null}
          onSelectEdge={(id) => {
            onSelectEdge(id);
            onOpenMap();
          }}
        />
        <section className="panel">
          <div className="panel-header">
            RECENT DROPPED CONNECTIONS
            <button type="button" className="network-ws-link" onClick={onOpenFlows}>
              All flows
            </button>
          </div>
          {dropped.length === 0 ? (
            <div className="empty-state">No drops or timeouts in the current window.</div>
          ) : (
            <ul className="network-ws-list">
              {dropped.map((flow) => (
                <li key={flow.id}>
                  <div className="network-ws-list-static">
                    <span className="network-ws-list-main">
                      {flow.src.name} → {flow.dst.name}
                    </span>
                    <span className="network-ws-list-meta">
                      {flow.verdict} · {flow.protocol}:{flow.port} · {formatMs(flow.latencyMs)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PathInspector({
  row,
  flows,
  onClose,
}: {
  row: NetworkPathRow | null;
  flows: NetworkFlow[];
  onClose: () => void;
}) {
  const samples = useMemo(() => {
    if (!row) {
      return [];
    }
    const ids = new Set(row.sampleFlowIds);
    return flows.filter((flow) => ids.has(flow.id)).slice(0, 12);
  }, [row, flows]);

  if (!row) {
    return (
      <aside className="flow-detail network-ws-inspector">
        <div className="flow-detail-title">FLOW INSPECTOR</div>
        <div className="flow-detail-empty">Select a path row to inspect.</div>
      </aside>
    );
  }

  return (
    <aside className="flow-detail network-ws-inspector">
      <div className="flow-detail-title-row">
        <div className="flow-detail-title">FLOW INSPECTOR</div>
        <button type="button" className="network-ws-link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flow-detail-route">
        {row.sourceNamespace ? `${row.sourceNamespace}/` : ""}
        {row.source}
        <span className="network-ws-arrow">↓</span>
        {row.destinationNamespace ? `${row.destinationNamespace}/` : ""}
        {row.destination}
      </div>
      <dl className="network-ws-kv">
        <div>
          <dt>Protocol</dt>
          <dd>
            {row.protocol}/{row.port}
          </dd>
        </div>
        <div>
          <dt>App class</dt>
          <dd>{protocolClassLabel(row.appClass)}</dd>
        </div>
        <div>
          <dt>Requests/sec</dt>
          <dd>{row.requestsPerSec}</dd>
        </div>
        <div>
          <dt>Flows</dt>
          <dd>{row.flowCount}</dd>
        </div>
        <div>
          <dt>P50 / P95 / P99</dt>
          <dd>
            {formatMs(row.p50Ms)} / {formatMs(row.p95Ms)} / {formatMs(row.p99Ms)}
          </dd>
        </div>
        <div>
          <dt>Errors / Drops</dt>
          <dd>
            {row.errors} / {row.drops}
          </dd>
        </div>
        <div>
          <dt>Retransmits</dt>
          <dd>{row.retransmits}</dd>
        </div>
        <div>
          <dt>Bytes/sec</dt>
          <dd>{row.bytesPerSec}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{row.verdict}</dd>
        </div>
      </dl>
      {row.path ? (
        <div className="network-ws-path">
          <span className="profile-panel-label">Path</span>
          <code>{row.path}</code>
        </div>
      ) : null}
      <div className="flow-detail-section">
        <div className="flow-detail-heading">SAMPLE FLOWS</div>
        <LiveFlowsTable flows={samples} limit={8} showPath={false} title="SAMPLES" />
      </div>
    </aside>
  );
}

function FlowsTab({
  flows,
  selectedPathId,
  onSelectPath,
}: {
  flows: NetworkFlow[];
  selectedPathId: string | null;
  onSelectPath: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("all");
  const [status, setStatus] = useState("all");

  const liveRows = useMemo(() => buildPathRows(flows), [flows]);
  const rows = useFrozenWhileSelected(liveRows, selectedPathId != null);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const protocolMatch = protocol === "all" || row.protocol === protocol;
      const statusMatch = status === "all" || row.verdict === status;
      const searchMatch =
        !query ||
        row.source.toLowerCase().includes(query) ||
        row.destination.toLowerCase().includes(query) ||
        row.path?.toLowerCase().includes(query) ||
        String(row.port).includes(query);
      return protocolMatch && statusMatch && searchMatch;
    });
  }, [rows, search, protocol, status]);

  const selected = useStickyById(rows, selectedPathId);

  return (
    <div className="network-ws-flows">
      <div className="network-ws-filters">
        <input
          className="events-search"
          placeholder="Filter source, destination, port…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="flows-filter-select"
          value={protocol}
          onChange={(event) => setProtocol(event.target.value)}
        >
          <option value="all">All protocols</option>
          <option value="TCP">TCP</option>
          <option value="UDP">UDP</option>
          <option value="ICMP">ICMP</option>
        </select>
        <select
          className="flows-filter-select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All status</option>
          <option value="OK">OK</option>
          <option value="DROPPED">DROPPED</option>
          <option value="TIMEOUT">TIMEOUT</option>
          <option value="RETRY">RETRY</option>
        </select>
        <span className="network-ws-filter-meta">
          {filtered.length} paths · * app class is port-inferred
        </span>
      </div>

      <div className="network-ws-flows-layout">
        <section className="panel network-ws-path-panel">
          <div className="panel-header">COMMUNICATION PATHS</div>
          <div className="network-ws-table-wrap">
            {filtered.length === 0 ? (
              <div className="empty-state">No paths match the current filters.</div>
            ) : (
              <table className="network-ws-path-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Destination</th>
                    <th>Proto</th>
                    <th>Class</th>
                    <th>RPS</th>
                    <th>P50</th>
                    <th>P95</th>
                    <th>P99</th>
                    <th>Errors</th>
                    <th>Drops</th>
                    <th>Retrans</th>
                    <th>Bytes/s</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={selectedPathId === row.id ? "selected" : ""}
                      onClick={() => onSelectPath(row.id)}
                    >
                      <td>
                        <div className="network-ws-cell-main">{row.source}</div>
                        <div className="network-ws-cell-sub">{row.sourceNamespace ?? "—"}</div>
                      </td>
                      <td>
                        <div className="network-ws-cell-main">{row.destination}</div>
                        <div className="network-ws-cell-sub">
                          {row.destinationNamespace ?? "—"} · :{row.port}
                        </div>
                      </td>
                      <td>{row.protocol}</td>
                      <td>{protocolClassLabel(row.appClass)}</td>
                      <td>{row.requestsPerSec}</td>
                      <td>{formatMs(row.p50Ms)}</td>
                      <td>{formatMs(row.p95Ms)}</td>
                      <td>{formatMs(row.p99Ms)}</td>
                      <td>{row.errors}</td>
                      <td>{row.drops}</td>
                      <td>{row.retransmits}</td>
                      <td>{row.bytesPerSec}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <PathInspector row={selected} flows={flows} onClose={() => onSelectPath(null)} />
      </div>
    </div>
  );
}

export function NetworkWorkspace({
  snapshot,
  connected,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  initialTab = "overview",
  investigation = null,
  onStartInvestigation,
  onNavigate,
}: NetworkWorkspaceProps) {
  const [tab, setTab] = useState<NetworkWorkspaceTab>(initialTab);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [lod, setLod] = useState<GraphLod>("service");

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // const scoped = useMemo(() => filterNetworkSnapshot(snapshot, namespace), [snapshot, namespace]);
  const namespaceScoped = useMemo(
    () => filterNetworkSnapshot(snapshot, namespace),
    [snapshot, namespace],
  );
  const investigationFocus = useMemo(
    () =>
      investigation
        ? {
            name: investigation.name,
            namespace: investigation.namespace,
            memberPods: investigation.memberPods,
            windowMs: investigationWindowMs(investigation.window),
          }
        : null,
    [investigation],
  );
  // Live snapshot scoped to service + time window (hybrid baseline before history merge).
  const liveScoped = useMemo(
    () => filterSnapshotForInvestigation(namespaceScoped, investigationFocus ?? undefined),
    [namespaceScoped, investigationFocus],
  );
  const { flows: investigationFlows, historyLoading } = useInvestigationHistoryFlows(
    investigation,
    namespaceScoped.flows,
  );
  // When investigating, tabs use retained history ∪ live; map topology still uses liveScoped nodes.
  // const scoped = liveScoped;
  const scoped = useMemo(() => {
    if (!investigation) {
      return namespaceScoped;
    }
    return {
      ...liveScoped,
      flows: investigationFlows,
    };
  }, [investigation, namespaceScoped, liveScoped, investigationFlows]);
  const liveLayout = useMemo(
    () => buildGraphLayout(scoped.topology, scoped.flows, { lod }),
    [scoped.topology, scoped.flows, lod],
  );
  const investigating = selectedNodeId != null || selectedEdgeId != null;
  const layout = useInvestigationLayout(liveLayout, investigating, lod);
  // Freeze flow samples while investigating so detail panels don't empty on each tick.
  const detailFlows = useFrozenWhileSelected(scoped.flows, investigating);

  // Sticky edge object — survive ID churn if freeze refreshes (e.g. LOD change).
  const selectedEdgeLive =
    layout.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const stickyEdgeRef = useRef<GraphEdgeLayout | null>(null);
  if (selectedEdgeId == null) {
    stickyEdgeRef.current = null;
  } else if (selectedEdgeLive) {
    stickyEdgeRef.current = selectedEdgeLive;
  }
  const selectedEdge =
    selectedEdgeId == null
      ? null
      : selectedEdgeLive ??
        (stickyEdgeRef.current?.id === selectedEdgeId ? stickyEdgeRef.current : null);

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  const pageSubtitle = investigation
    ? `Investigating ${investigationLabel(investigation)} — ${investigationWindowLabel(investigation.window)}${investigation.live ? " + Live" : ""}${historyLoading ? " · loading retained…" : ""}`
    : "Who talks, how long it takes, and where it fails — cluster → service → flow";

  return (
    <div className="network-ws-page">
      <PageHeader
        // title="Network"
        title={investigation ? `Network · ${investigationLabel(investigation)}` : "Network"}
        // subtitle="Who talks, how long it takes, and where it fails — cluster → service → flow"
        subtitle={pageSubtitle}
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
      />

      <div className="network-ws-tabs" role="tablist" aria-label="Network sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`network-ws-tab${tab === item.id ? " network-ws-tab-active" : ""}${
              item.ready ? "" : " network-ws-tab-soon"
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {!item.ready ? <span className="network-ws-tab-badge">Soon</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab
          snapshot={scoped}
          edges={layout.edges}
          flows={scoped.flows}
          onOpenMap={() => setTab("map")}
          onOpenFlows={() => setTab("flows")}
          onSelectEdge={(id) => {
            setSelectedEdgeId(id);
            setTab("map");
          }}
        />
      ) : null}

      {tab === "map" ? (
        <div className="network-ws-map">
          <div className="topology-layout">
            <section className="panel topology-graph-panel">
              <div className="panel-header panel-header-split">
                <div className="panel-header-main">
                  <span>SERVICE MAP</span>
                  <span className="panel-meta-inline">
                    click service to investigate · hover edge for latency · double-click to expand pods
                  </span>
                </div>
                <GraphLegend />
              </div>
              <TopologyGraph
                layout={layout}
                connected={connected}
                selectedEdgeId={selectedEdgeId}
                onSelectEdge={setSelectedEdgeId}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                lod={lod}
                onLodChange={setLod}
                // showInspectPanel={false}
                showInspectPanel
                onNavigate={onNavigate}
                onStartInvestigation={onStartInvestigation}
                startedFrom="Service Map"
              />
            </section>
            <FlowDetailPanel
              edge={selectedEdge}
              flows={detailFlows}
              edges={layout.edges}
              nodeById={nodeById}
              onSelectEdge={setSelectedEdgeId}
            />
          </div>
          <LiveFlowsTable
            flows={detailFlows}
            limit={8}
            title="RECENT FLOWS ON MAP"
          />
        </div>
      ) : null}

      {tab === "flows" ? (
        <FlowsTab
          flows={scoped.flows}
          selectedPathId={selectedPathId}
          onSelectPath={setSelectedPathId}
        />
      ) : null}

      {tab === "dns" ? (
        <DnsTab flows={scoped.flows} investigation={investigation} />
      ) : null}

      {tab === "protocols" ? <ProtocolsTab flows={scoped.flows} /> : null}

      {tab === "tcp" ? (
        <TcpHealthTab flows={scoped.flows} investigation={investigation} />
      ) : null}
    </div>
  );
}
