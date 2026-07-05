import { useMemo, useState } from "react";
import { filterNetworkSnapshot } from "../../core/network/scope";
import { buildGraphLayout } from "../../core/network/graph-model";
import type { EbpfCollectorStatus, NetworkSnapshot } from "../../core/types/network";
import { EdgeLatencyBoard } from "./EdgeLatencyBoard";
import { LiveFlowsTable } from "./LiveFlowsTable";
import { PageHeader } from "./PageHeader";

interface NetworkAnalysisDashboardProps {
  snapshot: NetworkSnapshot;
  connected: boolean;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
}

function EbpfPanel({ ebpf }: { ebpf: EbpfCollectorStatus }) {
  const checks = [
    { label: "Collector reachable", ok: ebpf.connected },
    {
      label: ebpf.mode?.includes("hubble") ? "Hubble stream" : "ProcNet stream",
      ok: ebpf.connected,
    },
    { label: "Programs attached", ok: ebpf.connected && (ebpf.programsAttached ?? 0) > 0 },
    { label: "Pod IP index", ok: ebpf.connected && (ebpf.podsIndexed ?? 0) > 0 },
  ];

  return (
    <section className="panel network-agent-panel">
      <div className="panel-header">KERNEL / EBPF STATUS</div>
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

export function NetworkAnalysisDashboard({
  snapshot,
  connected,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
}: NetworkAnalysisDashboardProps) {
  const scoped = useMemo(() => filterNetworkSnapshot(snapshot, namespace), [snapshot, namespace]);
  const layout = useMemo(
    () => buildGraphLayout(scoped.topology, scoped.flows),
    [scoped.topology, scoped.flows],
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const problemFlows = useMemo(
    () =>
      scoped.flows.filter(
        (flow) => flow.verdict === "DROPPED" || flow.verdict === "TIMEOUT" || flow.verdict === "RETRY",
      ),
    [scoped.flows],
  );

  return (
    <div className="network-analysis-page">
      <PageHeader
        title="Network"
        subtitle="Latency paths, drops, and kernel agent health"
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
      />

      <div className="network-analysis-grid">
        <EdgeLatencyBoard
          edges={layout.edges}
          selectedEdgeId={selectedEdgeId}
          onSelectEdge={setSelectedEdgeId}
        />
        <EbpfPanel ebpf={scoped.ebpf} />
      </div>

      <LiveFlowsTable
        flows={problemFlows}
        title="DROPS · TIMEOUTS · RETRIES"
        emptyMessage="No dropped or timed-out flows in the current window."
      />
    </div>
  );
}
