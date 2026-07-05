import { useMemo, useState } from "react";
import { filterNetworkSnapshot } from "../../core/network/scope";
import type { FlowVerdict, NetworkFlow, NetworkSnapshot } from "../../core/types/network";
import { LiveFlowsTable } from "./LiveFlowsTable";
import { PageHeader } from "./PageHeader";

interface FlowsDashboardProps {
  snapshot: NetworkSnapshot;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
}

type ProtocolFilter = "all" | NetworkFlow["protocol"];
type VerdictFilter = "all" | FlowVerdict;

export function FlowsDashboard({
  snapshot,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
}: FlowsDashboardProps) {
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState<ProtocolFilter>("all");
  const [verdict, setVerdict] = useState<VerdictFilter>("all");

  const scoped = useMemo(() => filterNetworkSnapshot(snapshot, namespace), [snapshot, namespace]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.flows.filter((flow) => {
      const protocolMatch = protocol === "all" || flow.protocol === protocol;
      const verdictMatch = verdict === "all" || flow.verdict === verdict;
      const searchMatch =
        !query ||
        flow.src.name.toLowerCase().includes(query) ||
        flow.dst.name.toLowerCase().includes(query) ||
        String(flow.port).includes(query);
      return protocolMatch && verdictMatch && searchMatch;
    });
  }, [scoped.flows, protocol, verdict, search]);

  const badCount = scoped.flows.filter(
    (flow) => flow.verdict === "DROPPED" || flow.verdict === "TIMEOUT",
  ).length;

  return (
    <div className="flows-page">
      <PageHeader
        title="Flows"
        subtitle="Kernel-enriched pod → service → pod traffic"
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
        actions={
          <>
            <input
              className="events-search"
              placeholder="Search source, destination, port…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="flows-filter-select"
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as ProtocolFilter)}
            >
              <option value="all">All protocols</option>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
              <option value="ICMP">ICMP</option>
            </select>
            <select
              className="flows-filter-select"
              value={verdict}
              onChange={(event) => setVerdict(event.target.value as VerdictFilter)}
            >
              <option value="all">All status</option>
              <option value="OK">OK</option>
              <option value="DROPPED">DROPPED</option>
              <option value="TIMEOUT">TIMEOUT</option>
              <option value="RETRY">RETRY</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </>
        }
      />

      <div className="flows-summary">
        <span>{filtered.length} flows shown</span>
        <span>{scoped.flows.length} total captured</span>
        {badCount > 0 ? <span className="flows-summary-bad">{badCount} drops/timeouts</span> : null}
      </div>

      <LiveFlowsTable flows={filtered} title="ALL FLOWS" />
    </div>
  );
}
