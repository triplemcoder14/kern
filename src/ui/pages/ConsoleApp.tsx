import { useState } from "react";
import { renderCloudPage } from "@kern/platform";
import { configToConnectInput, loadClusterConfig, saveClusterConfig, type ClusterConfig } from "../../core/config/cluster-config";
import { ALL_NAMESPACES } from "../../core/monitoring/scope";
import { isAlertSoundMuted, setAlertSoundMuted, unlockAlertSound } from "../lib/alert-sound";
import { friendlyMonitorError } from "../lib/friendly-errors";
import { AppShell, type NavId, type NavPage } from "../components/AppShell";
import { AlertsDashboard } from "../components/AlertsDashboard";
import { InvestigationBanner } from "../components/InvestigationBanner";
import { LiveEventStream } from "../components/LiveEventStream";
import { NetworkWorkspace, type NetworkWorkspaceTab } from "../components/network/NetworkWorkspace";
import { OverviewDashboard } from "../components/OverviewDashboard";
import { PageErrorBoundary } from "../components/PageErrorBoundary";
import { ProfilingDashboard } from "../components/ProfilingDashboard";
import { SettingsView } from "../components/SettingsView";
import { WorkloadsDashboard } from "../components/WorkloadsDashboard";
import { useAuth } from "../hooks/useAuth";
import { useMonitor } from "../hooks/useMonitor";
import { useNetworkTalkAlertSound } from "../hooks/useNetworkTalkAlertSound";
import type { InvestigationFocus, StartInvestigation } from "../investigation/types";
import { DEFAULT_INVESTIGATION_WINDOW } from "../investigation/types";
import { resolveInvestigationNode } from "../investigation/resolve-node";
import { fetchProfileSnapshot, prefetchProfileSnapshot, readCachedProfile } from "../../lib/profile-api";
// import { investigationLabel } from "../investigation/types";

function networkTabForPage(page: NavPage): NetworkWorkspaceTab {
  if (page === "topology" || page === "network-map") {
    return "map";
  }
  if (page === "flows" || page === "network-flows") {
    return "flows";
  }
  if (page === "network-dns") {
    return "dns";
  }
  if (page === "network-tcp") {
    return "tcp";
  }
  if (page === "network-protocols") {
    return "protocols";
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
  const [investigation, setInvestigation] = useState<InvestigationFocus | null>(null);
  const [profilerTab, setProfilerTab] = useState<"overview" | "cpu" | "memory" | "network" | "timeline">(
    "overview",
  );

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

  const handleNavigate = (
    nav: NavId,
    nextPage: NavPage,
    options?: { keepInvestigation?: boolean },
  ) => {
    // Leaving via the shell (Workloads, Network, Overview, …) ends the investigation.
    // Investigate* actions pass keepInvestigation so DNS → TCP → CPU stays scoped.
    // if (investigation) { setInvestigation(null); } // was: always clear — broke cross-page investigate
    if (investigation && !options?.keepInvestigation) {
      setInvestigation(null);
      setProfilerTab("overview");
    }

    if (
      nextPage === "topology" ||
      nextPage === "flows" ||
      nextPage === "network" ||
      nextPage === "network-map" ||
      nextPage === "network-dns" ||
      nextPage === "network-tcp" ||
      nextPage === "network-flows" ||
      nextPage === "network-protocols"
    ) {
      setNetworkTab(networkTabForPage(nextPage));
      setActiveNav("network");
      setPage("network");
      return;
    }
    setActiveNav(nav);
    setPage(nextPage);
  };

  const startInvestigation: StartInvestigation = (focusInput, dest) => {
    const next: InvestigationFocus = {
      kind: focusInput.kind,
      name: focusInput.name,
      namespace: focusInput.namespace,
      memberPods: focusInput.memberPods,
      nodeName: focusInput.nodeName,
      level: focusInput.level,
      pod: focusInput.pod,
      pid: focusInput.pid,
      processName: focusInput.processName,
      clusterName: focusInput.clusterName ?? clusterName,
      startedFrom: focusInput.startedFrom,
      startedAt: Date.now(),
      // Data window is independent of startedAt — "just now" ≠ empty history.
      window: focusInput.window ?? DEFAULT_INVESTIGATION_WINDOW,
      live: focusInput.live ?? true,
    };

    const finish = (focus: InvestigationFocus) => {
      setInvestigation(focus);
      // Scope global namespace so Network / Profiler / Events inherit the same world.
      if (focus.namespace && focus.namespace !== ALL_NAMESPACES) {
        handleNamespaceChange(focus.namespace);
      }
      if (dest) {
        // Investigate CPU should open the CPU flame tab, not Overview.
        if (dest.page === "profiling" || dest.nav === "profiling") {
          setProfilerTab("cpu");
        }
        handleNavigate(dest.nav, dest.page, { keepInvestigation: true });
      }
    };

    const isCpuInvestigate =
      dest?.page === "profiling" || dest?.nav === "profiling";

    const openWithNode = (focus: InvestigationFocus) => {
      if (focus.nodeName && isCpuInvestigate) {
        // Share this in-flight request with useNodeProfile after navigation.
        void prefetchProfileSnapshot(focus.nodeName).catch(() => undefined);
      }
      // Always navigate immediately — never leave the UI waiting on a black screen.
      // Previous: Promise.race delay before finish() made the app feel frozen / blank.
      finish(focus);
    };

    // Prefer a sync cache hit so Investigate CPU opens on the right node with data ready.
    const cachedNode =
      next.nodeName ??
      resolveInvestigationNode(
        next,
        readCachedProfile()?.podPlacements,
        readCachedProfile()?.nodes,
      );

    if (cachedNode) {
      openWithNode({ ...next, nodeName: cachedNode });
      return;
    }

    if (next.nodeName) {
      openWithNode(next);
      return;
    }

    // No cache — resolve placement first for CPU so Profiler never mounts without a node
    // (that was the blank main panel). Other destinations can open immediately.
    if (isCpuInvestigate) {
      void fetchProfileSnapshot()
        .then(async (snapshot) => {
          const nodeName = resolveInvestigationNode(
            next,
            snapshot.podPlacements,
            snapshot.nodes,
          );
          const focus = nodeName ? { ...next, nodeName } : next;
          if (nodeName) {
            // Start warm; don't block forever — join the same promise in the Profiler hook.
            void prefetchProfileSnapshot(nodeName);
          }
          openWithNode(focus);
        })
        .catch(() => {
          openWithNode(next);
        });
      return;
    }

    openWithNode(next);
    void fetchProfileSnapshot()
      .then((snapshot) => {
        const nodeName = resolveInvestigationNode(
          next,
          snapshot.podPlacements,
          snapshot.nodes,
        );
        if (!nodeName) {
          return;
        }
        setInvestigation((prev) =>
          prev && prev.startedAt === next.startedAt ? { ...prev, nodeName } : prev,
        );
      })
      .catch(() => {
        // Non-CPU investigate can proceed without a resolved node.
      });
  };

  const exitInvestigation = () => {
    setInvestigation(null);
    setProfilerTab("overview");
  };

  const handleInvestigationChange = (focus: InvestigationFocus) => {
    setInvestigation(focus);
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
      agentConnected={monitor.health.connected}
      ebpfMode={monitor.network.ebpf.mode}
      programsAttached={monitor.network.ebpf.programsAttached}
      flowsPerSecond={monitor.network.ebpf.flowsPerSecond}
      ebpfConnected={monitor.network.ebpf.connected}
      footer={
        monitor.error ? (
          <span
            className={
              friendlyMonitorError(monitor.error).soft
                ? "shell-footer-soft"
                : "shell-footer-error"
            }
          >
            {friendlyMonitorError(monitor.error).message}
          </span>
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
      {investigation ? (
        <InvestigationBanner focus={investigation} onExit={exitInvestigation} />
      ) : null}

      {page === "overview" && (
        <OverviewDashboard
          health={monitor.health}
          snapshot={monitor.network}
          events={monitor.events}
          openIncidents={monitor.openIncidents}
          onNavigate={handleNavigate}
          onStartInvestigation={startInvestigation}
          {...clusterPageProps}
        />
      )}

      {page === "network" && (
        <NetworkWorkspace
          snapshot={monitor.network}
          initialTab={networkTab}
          investigation={investigation}
          onStartInvestigation={startInvestigation}
          onNavigate={handleNavigate}
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

      {/* {page === "profiling" && <ProfilingDashboard {...clusterPageProps} />} */}
      {page === "profiling" && (
        <PageErrorBoundary fallbackTitle="Profiler failed to render">
          <ProfilingDashboard
            {...clusterPageProps}
            investigation={investigation}
            initialTab={profilerTab}
            onInvestigationChange={handleInvestigationChange}
            onExitInvestigation={exitInvestigation}
          />
        </PageErrorBoundary>
      )}

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
          investigation={investigation}
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
