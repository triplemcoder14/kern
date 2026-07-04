import { useState } from "react";
import { configToConnectInput, saveClusterConfig, type ClusterConfig } from "./core/config/cluster-config";
import type { K8sResource } from "./core/types/k8s";
import { getResourceNamespace } from "./core/types/k8s";
import { AppShell, type NavPage } from "./ui/components/AppShell";
import { LiveEventStream } from "./ui/components/LiveEventStream";
import { NetworkDashboard } from "./ui/components/NetworkDashboard";
import { DEFAULT_YAML, SimulationView } from "./ui/components/SimulationView";
import { SettingsView } from "./ui/components/SettingsView";
import { useCluster } from "./ui/hooks/useCluster";
import { useMonitor } from "./ui/hooks/useMonitor";

function App() {
  const monitor = useMonitor();
  const simulation = useCluster();
  const [page, setPage] = useState<NavPage>("events");
  const [namespace, setNamespace] = useState("all");
  const [paused, setPaused] = useState(false);
  const [yaml, setYaml] = useState(DEFAULT_YAML);

  const handleConnect = async (config: ClusterConfig) => {
    saveClusterConfig(config);
    await monitor.connect(configToConnectInput(config));
  };

  const clusterName = monitor.connection?.clusterName ?? "disconnected";

  return (
    <AppShell
      active={page}
      onNavigate={setPage}
      connected={monitor.health.connected}
      alertCount={monitor.openIncidents.length}
      footer={
        monitor.error ? (
          <span className="shell-footer-error">{monitor.error}</span>
        ) : monitor.busy ? (
          <span>Connecting…</span>
        ) : monitor.health.connected ? (
          <span>Monitoring {clusterName}</span>
        ) : (
          <span>Not connected — open Settings to connect</span>
        )
      }
    >
      {page === "events" && (
        <LiveEventStream
          events={monitor.events}
          clusterName={clusterName}
          namespaceFilter={namespace}
          namespaces={monitor.namespaces}
          onNamespaceChange={setNamespace}
          connected={monitor.health.connected}
          paused={paused}
          onPausedChange={setPaused}
        />
      )}

      {page === "network" && (
        <div className="network-page">
          <NetworkDashboard
            snapshot={monitor.network}
            connected={monitor.health.connected}
            clusterName={clusterName}
            namespace={namespace}
            namespaces={monitor.namespaces}
            onNamespaceChange={setNamespace}
            incidents={monitor.openIncidents}
          />
        </div>
      )}

      {page === "settings" && (
        <SettingsView
          busy={monitor.busy}
          connected={monitor.health.connected}
          error={monitor.error}
          onConnect={handleConnect}
          onDisconnect={monitor.disconnect}
        />
      )}

      {page === "simulation" && (
        <SimulationView
          yaml={yaml}
          onYamlChange={setYaml}
          resources={simulation.resources}
          busy={simulation.busy}
          onApply={async () => {
            try {
              await simulation.applyYaml(yaml);
            } catch {
              // surfaced via hook
            }
          }}
          onReset={async () => {
            if (!window.confirm("Reset simulation cluster?")) {
              return;
            }
            await simulation.resetCluster();
          }}
          onDelete={async (resource: K8sResource) => {
            const ns = getResourceNamespace(resource);
            await simulation.deleteResource(resource.kind, ns, resource.metadata.name);
          }}
        />
      )}
    </AppShell>
  );
}

export default App;
