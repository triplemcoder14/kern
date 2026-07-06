import { useState } from "react";
import { configToConnectInput, saveClusterConfig, type ClusterConfig } from "../../core/config/cluster-config";
import { isAlertSoundMuted, setAlertSoundMuted, unlockAlertSound } from "../lib/alert-sound";
import { AppShell, type NavId, type NavPage } from "../components/AppShell";
import { AlertsDashboard } from "../components/AlertsDashboard";
import { FlowsDashboard } from "../components/FlowsDashboard";
import { LiveEventStream } from "../components/LiveEventStream";
import { NetworkAnalysisDashboard } from "../components/NetworkAnalysisDashboard";
import { OverviewDashboard } from "../components/OverviewDashboard";
import { ProfilingDashboard } from "../components/ProfilingDashboard";
import { SettingsView } from "../components/SettingsView";
import { TopologyDashboard } from "../components/TopologyDashboard";
import { WorkloadsDashboard } from "../components/WorkloadsDashboard";
import { useAuth } from "../hooks/useAuth";
import { useMonitor } from "../hooks/useMonitor";
import { useNetworkTalkAlertSound } from "../hooks/useNetworkTalkAlertSound";

export function ConsoleApp() {
  const monitor = useMonitor();
  const { user, logout } = useAuth();
  const [page, setPage] = useState<NavPage>("overview");
  const [activeNav, setActiveNav] = useState<NavId>("overview");
  const [namespace, setNamespace] = useState("all");
  const [paused, setPaused] = useState(false);
  const [soundMuted, setSoundMuted] = useState(isAlertSoundMuted);

  useNetworkTalkAlertSound(monitor.events, soundMuted, monitor.health.connected);

  const handleSoundMutedChange = (muted: boolean) => {
    setSoundMuted(muted);
    setAlertSoundMuted(muted);
    if (!muted) {
      void unlockAlertSound();
    }
  };

  const handleConnect = async (config: ClusterConfig) => {
    saveClusterConfig(config);
    await monitor.connect(configToConnectInput(config));
  };

  const clusterName = monitor.connection?.clusterName ?? "disconnected";

  const handleNavigate = (nav: NavId, nextPage: NavPage) => {
    setActiveNav(nav);
    setPage(nextPage);
  };

  const handleLogout = async () => {
    await logout();
  };

  const clusterPageProps = {
    clusterName,
    namespace,
    namespaces: monitor.namespaces,
    onNamespaceChange: setNamespace,
    connected: monitor.health.connected,
  };

  return (
    <AppShell
      activeNav={activeNav}
      onNavigate={handleNavigate}
      connected={monitor.health.connected}
      alertCount={monitor.openIncidents.length}
      soundMuted={soundMuted}
      onSoundMutedChange={handleSoundMutedChange}
      user={user}
      onLogout={handleLogout}
      footer={
        monitor.error ? (
          <span className="shell-footer-error">{monitor.error}</span>
        ) : monitor.busy ? (
          <span>Connecting…</span>
        ) : monitor.health.connected ? (
          <span>
            Monitoring {clusterName}
            {user ? ` · ${user.name}` : ""}
          </span>
        ) : (
          <span>Not connected — open Settings to connect</span>
        )
      }
    >
      {page === "overview" && (
        <OverviewDashboard
          health={monitor.health}
          snapshot={monitor.network}
          events={monitor.events}
          openIncidents={monitor.openIncidents}
          onNavigate={handleNavigate}
          {...clusterPageProps}
        />
      )}

      {page === "topology" && (
        <div className="topology-page-wrap">
          <TopologyDashboard snapshot={monitor.network} {...clusterPageProps} />
        </div>
      )}

      {page === "flows" && (
        <FlowsDashboard snapshot={monitor.network} {...clusterPageProps} />
      )}

      {page === "workloads" && (
        <WorkloadsDashboard
          snapshot={monitor.network}
          events={monitor.events}
          incidents={monitor.incidents}
          namespaceFilter={namespace}
          onViewInNetwork={() => handleNavigate("topology", "topology")}
          {...clusterPageProps}
        />
      )}

      {page === "network" && (
        <NetworkAnalysisDashboard snapshot={monitor.network} {...clusterPageProps} />
      )}

      {page === "profiling" && <ProfilingDashboard {...clusterPageProps} />}

      {page === "alerts" && (
        <AlertsDashboard
          incidents={monitor.incidents}
          events={monitor.events}
          clusterName={clusterName}
          namespaces={monitor.namespaces}
          onResolve={monitor.resolveIncident}
        />
      )}

      {page === "events" && (
        <LiveEventStream
          events={monitor.events}
          namespaceFilter={namespace}
          paused={paused}
          onPausedChange={setPaused}
          soundMuted={soundMuted}
          onSoundMutedChange={handleSoundMutedChange}
          {...clusterPageProps}
        />
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
    </AppShell>
  );
}
