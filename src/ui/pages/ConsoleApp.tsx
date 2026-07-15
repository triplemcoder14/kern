import { useState } from "react";
import { renderCloudPage } from "@kern/platform";
import { configToConnectInput, loadClusterConfig, saveClusterConfig, type ClusterConfig } from "../../core/config/cluster-config";
import { ALL_NAMESPACES } from "../../core/monitoring/scope";
import { isAlertSoundMuted, setAlertSoundMuted, unlockAlertSound } from "../lib/alert-sound";
import { AppShell, type NavId, type NavPage } from "../components/AppShell";
import { AlertsDashboard } from "../components/AlertsDashboard";
import { LiveEventStream } from "../components/LiveEventStream";
import { NetworkWorkspace, type NetworkWorkspaceTab } from "../components/network/NetworkWorkspace";
import { OverviewDashboard } from "../components/OverviewDashboard";
import { ProfilingDashboard } from "../components/ProfilingDashboard";
import { SettingsView } from "../components/SettingsView";
import { WorkloadsDashboard } from "../components/WorkloadsDashboard";
import { useAuth } from "../hooks/useAuth";
import { useMonitor } from "../hooks/useMonitor";
import { useNetworkTalkAlertSound } from "../hooks/useNetworkTalkAlertSound";

function networkTabForPage(page: NavPage): NetworkWorkspaceTab {
  if (page === "topology") {
    return "map";
  }
  if (page === "flows") {
    return "flows";
  }
  return "overview";
}

export function ConsoleApp() {
  const monitor = useMonitor();
  const { user, logout } = useAuth();
  const [page, setPage] = useState<NavPage>("overview");
  const [activeNav, setActiveNav] = useState<NavId>("overview");
  const [networkTab, setNetworkTab] = useState<NetworkWorkspaceTab>("overview");
  const [namespace, setNamespace] = useState(ALL_NAMESPACES);
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

  const handleNamespaceChange = (value: string) => {
    const next = value.trim() || ALL_NAMESPACES;
    setNamespace(next);
    void monitor.setNamespace(next);
  };

  const handleConnect = async (config: ClusterConfig) => {
    saveClusterConfig(config);
    await monitor.connect(configToConnectInput(config));
    // Keep UI + monitor worker scope in lockstep after connect.
    setNamespace(ALL_NAMESPACES);
    void monitor.setNamespace(ALL_NAMESPACES);
  };

  const savedClusterName = loadClusterConfig().clusterName.trim() || "cluster";
  const clusterName = monitor.connection?.clusterName?.trim()
    || (monitor.health.connected ? monitor.health.clusterName : savedClusterName)
    || savedClusterName;
  const cloudPage = renderCloudPage(page, {
    user,
    onNavigate: (nextPage) => handleNavigate(nextPage, nextPage),
  });

  const handleNavigate = (nav: NavId, nextPage: NavPage) => {
    if (nextPage === "topology" || nextPage === "flows" || nextPage === "network") {
      setNetworkTab(networkTabForPage(nextPage));
      setActiveNav("network");
      setPage("network");
      return;
    }
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
    onNamespaceChange: handleNamespaceChange,
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

      {page === "network" && (
        <NetworkWorkspace
          snapshot={monitor.network}
          initialTab={networkTab}
          {...clusterPageProps}
        />
      )}

      {page === "workloads" && (
        <WorkloadsDashboard
          snapshot={monitor.network}
          events={monitor.events}
          incidents={monitor.incidents}
          namespaceFilter={namespace}
          onViewInNetwork={() => handleNavigate("network", "topology")}
          {...clusterPageProps}
        />
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

      {cloudPage}
    </AppShell>
  );
}
