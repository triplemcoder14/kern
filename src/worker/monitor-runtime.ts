import { K8sApiClient } from "../core/k8s-api/client";
import { listAgentPods } from "../core/k8s-api/agent-access";
import { buildManualConnection, parseKubeconfig } from "../core/kubeconfig/parser";
import {
  eventFromK8sEvent,
  eventFromPodFailure,
  incidentFromEvent,
  incidentKey,
  mergeIncident,
} from "../core/monitoring/incidents";
import {
  evaluateDeclarativeFlowAlerts,
  evaluateFlowAlerts,
  incidentFromFlowAlert,
  mergeFlowAlerts,
  mergeFlowIncident,
} from "../core/monitoring/flow-alerts";
import {
  parseDeclarativeAlertRules,
  type DeclarativeAlertRule,
} from "../core/monitoring/declarative-alert-rules";
import { NetworkIntrospectionEngine } from "../core/monitoring/network-introspection";
import type {
  MonitorWorkerEvent,
  MonitorWorkerRequest,
  MonitorWorkerResponse,
  SavedConnectionConfig,
} from "../core/types/monitor-rpc";
import type {
  ClusterConnectionConfig,
  ClusterHealth,
  ClusterHealthSnapshot,
  ConnectClusterInput,
  ConnectClusterResult,
  Incident,
  MonitorEvent,
} from "../core/types/monitoring";
import type { MonitorPersistence } from "./persistence/port";
import {
  retentionPolicy,
  trimIncidentMap,
  trimMonitorEvents,
} from "../core/monitoring/retention";
import {
  pollIntervalMs,
  type MonitorNamespaceScope,
} from "../core/monitoring/scope";
import { NetworkEngine } from "./network-engine";
import { buildProfileSnapshot, deriveNodesFromPods } from "../core/profiling/build-node-profile";
import type { AgentProfilePayload, ProfileSnapshot } from "../core/types/profiling";
import type { NetworkSnapshot } from "../core/types/network";

type EventHandler = (event: MonitorWorkerEvent) => void;

const SCOPED_POD_POLL_MS = 15_000;
const ALL_NAMESPACES_POD_POLL_MS = 30_000;
const HEALTH_EMIT_MIN_MS = 2_000;
const NETWORK_EMIT_MIN_MS = 4_000;
const SNAPSHOT_PERSIST_MIN_MS = 30_000;
const SEED_EVENT_LIMIT = 100;
const DEFAULT_EBPF_URL = "http://127.0.0.1:9474";
const DEFAULT_K8S_PROXY = "http://127.0.0.1:8001";
const DEFAULT_ALERT_RULES_NAMESPACE = "kern";
const DEFAULT_ALERT_RULES_CONFIGMAP = "kern-alert-rules";
const AGENT_PROFILE_TIMEOUT_MS = 12_000;

function nodeNamesMatch(a?: string, b?: string): boolean {
  if (!a?.trim() || !b?.trim()) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a.split(".")[0] === b.split(".")[0];
}

function resolveProxyUrl(proxyUrl?: string): string {
  if (proxyUrl?.startsWith("http")) {
    return proxyUrl;
  }
  return DEFAULT_K8S_PROXY;
}

function resolveEbpfUrl(ebpfCollectorUrl?: string): string {
  if (ebpfCollectorUrl?.trim()) {
    return ebpfCollectorUrl.trim();
  }
  return DEFAULT_EBPF_URL;
}

function resolveOrigin(origin?: string, fallback = ""): string {
  return origin ?? fallback;
}

function parseAgentPort(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number.parseInt(parsed.port, 10);
    }
    return parsed.protocol === "https:" ? 443 : 9474;
  } catch {
    return 9474;
  }
}

export class MonitorRuntime {
  private listeners = new Set<EventHandler>();
  private client: K8sApiClient | null = null;
  private config: ClusterConnectionConfig | null = null;
  private pageOrigin = "";
  private events: MonitorEvent[] = [];
  private incidents = new Map<string, Incident>();
  private watchAbort: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private activeNamespace: MonitorNamespaceScope = "default";
  private eventTimestamps: number[] = [];
  private knownNamespaces: string[] = [];
  private networkEngine = new NetworkEngine();
  private lastNetworkSnapshot: NetworkSnapshot | null = null;
  private introspection = new NetworkIntrospectionEngine();
  private declarativeAlertRules: DeclarativeAlertRule[] = [];
  private healthEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private networkEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNetworkSnapshot: NetworkSnapshot | null = null;
  private lastSnapshotPersistAt = 0;

  private readonly persistence: MonitorPersistence;

  constructor(persistence: MonitorPersistence) {
    this.persistence = persistence;
  }

  onEvent(handler: EventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(event: MonitorWorkerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async handle(request: MonitorWorkerRequest): Promise<MonitorWorkerResponse["data"]> {
    switch (request.type) {
      case "SET_ORIGIN":
        this.pageOrigin = request.origin;
        if (request.ebpfCollectorUrl !== undefined) {
          const ebpfUrl = request.ebpfCollectorUrl || DEFAULT_EBPF_URL;
          if (this.config) {
            this.config.ebpfCollectorUrl = ebpfUrl;
          }
          if (this.connected && this.client) {
            this.networkEngine.configure(ebpfUrl, request.origin);
            this.networkEngine.triggerRefresh();
          }
        }
        return this.tryReconnectSaved();
      case "SET_NAMESPACE":
        return this.setNamespace(request.namespace);
      case "CONNECT":
        return this.connect(request.input);
      case "DISCONNECT":
        return this.disconnect();
      case "GET_SNAPSHOT":
        return this.getSnapshot();
      case "GET_PROFILE":
        return this.getProfile(request.nodeName);
      case "SUBSCRIBE":
        if (this.knownNamespaces.length > 0) {
          this.emit({ type: "NAMESPACES_UPDATE", namespaces: this.knownNamespaces });
        } else if (this.connected && this.client) {
          void this.refreshNamespaces();
        }
        this.emit({
          type: "MONITOR_SNAPSHOT",
          events: this.events,
          incidents: [...this.incidents.values()],
        });
        this.emitHealth();
        return { subscribed: true };
      case "RESOLVE_INCIDENT":
        return this.resolveIncident(request.incidentId);
      default:
        throw new Error("Unknown monitor request");
    }
  }

  async bootstrap(): Promise<void> {
    const savedEvents = await this.persistence.loadRecentEvents(retentionPolicy().maxEvents);
    const savedIncidents = await this.persistence.loadOpenIncidents();
    this.events = savedEvents;
    for (const incident of savedIncidents) {
      this.incidents.set(incident.id, incident);
    }
    this.emitHealth();
  }

  private async tryReconnectSaved(): Promise<{ reconnected: boolean }> {
    if (this.connected) {
      return { reconnected: true };
    }

    const saved = await this.persistence.loadConnectionConfig();
    if (!saved?.name?.trim() || !this.pageOrigin) {
      return { reconnected: false };
    }

    void this.connect({
      proxyUrl: resolveProxyUrl(saved.proxyUrl),
      token: saved.token,
      clusterName: saved.name,
      ebpfCollectorUrl: resolveEbpfUrl(saved.ebpfCollectorUrl),
      origin: resolveOrigin(saved.origin, this.pageOrigin),
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Reconnect failed";
      this.emit({ type: "ERROR", message });
    });

    return { reconnected: false };
  }

  private async connect(input: ConnectClusterInput): Promise<ConnectClusterResult> {
    this.stopWatchers();

    const displayName = input.clusterName?.trim();
    if (!displayName) {
      throw new Error("Enter a cluster name in Settings before connecting.");
    }

    const proxyUrl = resolveProxyUrl(input.proxyUrl);
    const origin = resolveOrigin(input.origin, this.pageOrigin);
    const ebpfCollectorUrl = resolveEbpfUrl(input.ebpfCollectorUrl);

    if (input.kubeconfig?.trim()) {
      const parsed = parseKubeconfig(input.kubeconfig, proxyUrl, origin);
      this.config = {
        ...parsed,
        name: displayName,
        token: input.token ?? parsed.token,
        ebpfCollectorUrl,
      };
    } else {
      this.config = {
        ...buildManualConnection(proxyUrl, input.token, displayName, origin),
        ebpfCollectorUrl,
      };
    }

    this.client = new K8sApiClient(this.config);
    await this.client.ping();
    await this.refreshNamespaces();

    await this.refreshAlertRules();

    this.connected = true;

    this.networkEngine.configure(ebpfCollectorUrl, origin);
    this.networkEngine.setScope(this.activeNamespace);
    this.networkEngine.onRefreshError((message) => {
      this.emit({ type: "ERROR", message });
    });
    this.networkEngine.onUpdate((snapshot) => {
      this.pendingNetworkSnapshot = snapshot;
      if (this.networkEmitTimer) {
        return;
      }
      this.networkEmitTimer = setTimeout(() => {
        this.networkEmitTimer = null;
        const pending = this.pendingNetworkSnapshot;
        this.pendingNetworkSnapshot = null;
        if (!pending) {
          return;
        }
        this.emit({ type: "NETWORK_SNAPSHOT", snapshot: pending });
        void this.onNetworkSnapshot(pending);
        this.scheduleHealthEmit();
      }, NETWORK_EMIT_MIN_MS);
    });
    this.networkEngine.start(this.client);

    const saved: SavedConnectionConfig = {
      ...this.config,
      savedAt: new Date().toISOString(),
    };
    await this.persistence.saveConnectionConfig(saved);

    const result: ConnectClusterResult = {
      connected: true,
      clusterName: this.config.name,
      serverUrl: this.config.serverUrl,
      proxyUrl: this.config.proxyUrl,
    };

    this.emit({ type: "CONNECTED", result });
    this.emitHealth();
    this.startWatchers();

    void this.seedFromCluster().catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to load cluster events";
      this.emit({ type: "ERROR", message });
    });

    return result;
  }

  private async disconnect(): Promise<{ disconnected: true }> {
    this.stopWatchers();
    this.networkEngine.stop();
    this.introspection.reset();
    this.lastNetworkSnapshot = null;
    this.declarativeAlertRules = [];
    this.connected = false;
    this.config = null;
    this.client = null;
    this.knownNamespaces = [];
    await this.persistence.clearConnectionConfig();
    this.emit({ type: "NAMESPACES_UPDATE", namespaces: [] });
    this.emit({ type: "DISCONNECTED" });
    this.emitHealth();
    return { disconnected: true };
  }

  private async getSnapshot(): Promise<{
    events: MonitorEvent[];
    incidents: Incident[];
    health: ClusterHealthSnapshot;
  }> {
    return {
      events: this.events,
      incidents: [...this.incidents.values()],
      health: this.buildHealthSnapshot(),
    };
  }

  private async resolveIncident(incidentId: string): Promise<{ resolved: boolean }> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      return { resolved: false };
    }

    const resolved: Incident = {
      ...incident,
      status: "resolved",
      updatedAt: new Date().toISOString(),
    };
    this.incidents.set(incidentId, resolved);
    await this.persistence.resolveIncidentInDb(incidentId);
    this.emit({ type: "INCIDENT_RESOLVED", incidentId });
    this.emitHealth();
    return { resolved: true };
  }

  private async seedFromCluster(): Promise<void> {
    if (!this.client) {
      return;
    }

    const [eventList, pods] = await Promise.all([
      this.client.listEvents(this.activeNamespace),
      this.client.listPods(this.activeNamespace),
    ]);

    const sorted = eventList.items
      .map(eventFromK8sEvent)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, SEED_EVENT_LIMIT);

    for (const event of sorted) {
      this.pushEvent(event);
    }

    for (const pod of pods) {
      const failure = eventFromPodFailure(pod);
      if (failure) {
        this.pushEvent(failure);
      }
    }

    await this.refreshNamespaces();

    this.emit({
      type: "MONITOR_SNAPSHOT",
      events: this.events,
      incidents: [...this.incidents.values()],
    });
  }

  private setNamespace(namespace: string): { namespace: string } {
    const next = namespace.trim() || "default";
    if (next === this.activeNamespace) {
      return { namespace: next };
    }
    this.activeNamespace = next;
    this.networkEngine.setScope(next);
    if (next !== "all") {
      this.events = this.events.filter(
        (event) => !event.namespace || event.namespace === next,
      );
    }
    if (this.connected && this.client) {
      this.restartWatchersForScope();
      void this.seedFromCluster().catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to reload namespace scope";
        this.emit({ type: "ERROR", message });
      });
    }
    return { namespace: next };
  }

  private podPollIntervalMs(): number {
    return pollIntervalMs(this.activeNamespace, SCOPED_POD_POLL_MS, ALL_NAMESPACES_POD_POLL_MS);
  }

  private restartPodPollTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.connected || !this.client) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.pollPodHealth();
      void this.refreshAlertRules();
      void this.refreshNamespaces();
    }, this.podPollIntervalMs());
  }

  private restartWatchersForScope(): void {
    this.watchAbort?.abort();
    this.watchAbort = null;
    void this.runEventWatch();
    this.restartPodPollTimer();
  }

  private async refreshNamespaces(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const namespaces = await this.client.listNamespaces();
      if (
        namespaces.length !== this.knownNamespaces.length ||
        namespaces.some((name, index) => name !== this.knownNamespaces[index])
      ) {
        this.knownNamespaces = namespaces;
        this.emit({ type: "NAMESPACES_UPDATE", namespaces });
      }
    } catch {
      // namespace list is best-effort
    }
  }

  private pushEvent(event: MonitorEvent): void {
    const existingIndex = this.events.findIndex((item) => item.id === event.id);
    if (existingIndex >= 0) {
      this.events[existingIndex] = event;
    } else {
      this.events.unshift(event);
    }
    this.events = trimMonitorEvents(this.events);
  }

  private async refreshAlertRules(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const data = await this.client.getConfigMap(
        DEFAULT_ALERT_RULES_NAMESPACE,
        DEFAULT_ALERT_RULES_CONFIGMAP,
      );
      this.declarativeAlertRules = parseDeclarativeAlertRules(data?.["rules.json"]);
    } catch {
      this.declarativeAlertRules = [];
    }
  }

  private startWatchers(): void {
    if (!this.client) {
      return;
    }

    void this.runEventWatch();
    this.restartPodPollTimer();
  }

  private stopWatchers(): void {
    this.watchAbort?.abort();
    this.watchAbort = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.healthEmitTimer) {
      clearTimeout(this.healthEmitTimer);
      this.healthEmitTimer = null;
    }
    if (this.networkEmitTimer) {
      clearTimeout(this.networkEmitTimer);
      this.networkEmitTimer = null;
    }
    this.pendingNetworkSnapshot = null;
  }

  private async runEventWatch(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.watchAbort?.abort();
    this.watchAbort = new AbortController();

    try {
      const { resourceVersion } = await this.client.listEvents(this.activeNamespace);

      await this.client.watchEvents(
        resourceVersion,
        (event, _type) => {
          void this.ingestEvent(eventFromK8sEvent(event));
        },
        this.watchAbort.signal,
        this.activeNamespace,
      );
    } catch (error) {
      if (this.watchAbort?.signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : "Event watch failed";
      const staleWatch = message.includes("410") || message.toLowerCase().includes("gone");
      if (!staleWatch) {
        this.emit({ type: "ERROR", message });
      }
      setTimeout(() => {
        if (this.connected) {
          void this.runEventWatch();
        }
      }, staleWatch ? 500 : 5000);
    }
  }

  private async pollPodHealth(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const pods = await this.client.listPods(this.activeNamespace);
      for (const pod of pods) {
        const failure = eventFromPodFailure(pod);
        if (failure) {
          await this.ingestEvent(failure);
        }
      }
      this.emitHealth();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pod poll failed";
      this.emit({ type: "ERROR", message });
    }
  }

  private persistLater(task: () => Promise<void>): void {
    void task().catch(() => undefined);
  }

  private async ingestEvent(event: MonitorEvent, persist = true): Promise<void> {
    this.pushEvent(event);
    this.eventTimestamps.push(Date.now());
    this.eventTimestamps = this.eventTimestamps.filter((ts) => Date.now() - ts < 60_000);

    this.emit({ type: "MONITOR_EVENT", event });
    if ((event.category === "network" || event.category === "service") && !event.networkTalk) {
      this.networkEngine.ingestMonitorEvent(event);
    }
    await this.syncIncident(event);

    this.scheduleHealthEmit();

    if (persist) {
      this.persistLater(() => this.persistence.saveMonitorEvent(event));
    }
  }

  private async syncIncident(event: MonitorEvent): Promise<void> {
    if (event.networkTalk) {
      return;
    }

    const key = incidentKey(event);
    const derived = incidentFromEvent(event);
    if (!derived) {
      return;
    }

    const existing = [...this.incidents.values()].find(
      (incident) =>
        incident.status === "open" &&
        incident.alertSource !== "flow" &&
        incidentKey({
          ...event,
          id: incident.eventIds[0] ?? incident.id,
          title: incident.title,
        }) === key,
    );

    const incident = existing ? mergeIncident(existing, event) : { ...derived, alertSource: "kubernetes" as const };
    this.incidents.set(incident.id, incident);
    this.persistLater(() => this.persistence.saveIncident(incident));
    this.emit({ type: "INCIDENT_UPSERTED", incident });
    trimIncidentMap(this.incidents);
  }

  private async onNetworkSnapshot(snapshot: NetworkSnapshot): Promise<void> {
    const previous = this.lastNetworkSnapshot;

    for (const event of this.introspection.observe(snapshot, previous)) {
      await this.ingestEvent(event);
    }

    const now = Date.now();
    if (now - this.lastSnapshotPersistAt >= SNAPSHOT_PERSIST_MIN_MS) {
      this.lastSnapshotPersistAt = now;
      this.persistLater(async () => {
        await this.persistence.saveNetworkSnapshot?.(snapshot);
      });
    }

    const alerts = mergeFlowAlerts(
      evaluateFlowAlerts(snapshot, previous),
      evaluateDeclarativeFlowAlerts(this.declarativeAlertRules, snapshot, previous),
    );
    this.lastNetworkSnapshot = snapshot;

    for (const alert of alerts) {
      const incident = incidentFromFlowAlert(alert);
      const existing = this.incidents.get(incident.id);
      const next = existing?.status === "open" ? mergeFlowIncident(existing, alert) : incident;
      this.incidents.set(next.id, next);
      this.persistLater(() => this.persistence.saveIncident(next));
      this.emit({ type: "INCIDENT_UPSERTED", incident: next });
    }

    const activeFlowRules = new Set(alerts.map((alert) => alert.ruleId));
    for (const [id, incident] of this.incidents) {
      if (
        incident.status === "open" &&
        incident.alertSource === "flow" &&
        incident.ruleId &&
        !activeFlowRules.has(incident.ruleId)
      ) {
        const resolved = {
          ...incident,
          status: "resolved" as const,
          updatedAt: new Date().toISOString(),
        };
        this.incidents.set(id, resolved);
        this.persistLater(() => this.persistence.saveIncident(resolved));
        this.emit({ type: "INCIDENT_RESOLVED", incidentId: id });
      }
    }
    trimIncidentMap(this.incidents);
  }

  private buildHealthSnapshot(): ClusterHealthSnapshot {
    const openIncidents = [...this.incidents.values()].filter((item) => item.status === "open");
    const criticalCount = openIncidents.filter((item) => item.severity === "critical").length;
    const warningCount = openIncidents.filter((item) => item.severity === "warning").length;

    let health: ClusterHealth = "disconnected";
    if (this.connected) {
      if (criticalCount > 0) {
        health = "critical";
      } else if (warningCount > 0) {
        health = "degraded";
      } else {
        health = "healthy";
      }
    }

    const snapshot = this.networkEngine.getSnapshot();
    const podNodes = snapshot.topology.nodes.filter((node) => node.kind === "Pod");
    const serviceNodes = snapshot.topology.nodes.filter((node) => node.kind === "Service");

    return {
      health,
      connected: this.connected,
      clusterName: this.connected ? this.config?.name?.trim() || "Connected" : "Not connected",
      podCount: podNodes.length,
      runningPods: podNodes.filter((node) => node.status === "healthy").length,
      failedPods: podNodes.filter((node) => node.status === "degraded").length,
      serviceCount: serviceNodes.length,
      openIncidents: openIncidents.length,
      eventsPerMinute: this.eventTimestamps.length,
    };
  }

  private emitHealth(): void {
    this.scheduleHealthEmit(true);
  }

  private scheduleHealthEmit(immediate = false): void {
    if (immediate) {
      if (this.healthEmitTimer) {
        clearTimeout(this.healthEmitTimer);
        this.healthEmitTimer = null;
      }
      this.emit({ type: "HEALTH_UPDATE", snapshot: this.buildHealthSnapshot() });
      return;
    }
    if (this.healthEmitTimer) {
      return;
    }
    this.healthEmitTimer = setTimeout(() => {
      this.healthEmitTimer = null;
      this.emit({ type: "HEALTH_UPDATE", snapshot: this.buildHealthSnapshot() });
    }, HEALTH_EMIT_MIN_MS);
  }

  private async fetchAgentProfileFromUrl(baseUrl: string): Promise<AgentProfilePayload | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_PROFILE_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/profile`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { profile?: AgentProfilePayload };
      return body.profile ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchAgentProfileViaPodProxy(
    namespace: string,
    podName: string,
    port: number,
  ): Promise<AgentProfilePayload | null> {
    if (!this.client) {
      return null;
    }
    try {
      const response = await this.client.fetchPodProxy(
        namespace,
        podName,
        port,
        "/api/v1/profile",
        AGENT_PROFILE_TIMEOUT_MS,
      );
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { profile?: AgentProfilePayload };
      return body.profile ?? null;
    } catch {
      return null;
    }
  }

  private async fetchAgentProfilesForNode(nodeName: string): Promise<Map<string, AgentProfilePayload>> {
    const profiles = new Map<string, AgentProfilePayload>();
    const baseUrl = resolveEbpfUrl(this.config?.ebpfCollectorUrl);
    const port = parseAgentPort(baseUrl);

    const storeProfile = (profile: AgentProfilePayload) => {
      if (!profile.node_name) {
        return;
      }
      profiles.set(profile.node_name, profile);
      const short = profile.node_name.split(".")[0];
      if (short && short !== profile.node_name) {
        profiles.set(short, profile);
      }
    };

    if (this.client) {
      try {
        const agentPods = await listAgentPods(this.client);
        const agentPod = agentPods.find((pod) => nodeNamesMatch(pod.nodeName, nodeName));
        if (agentPod) {
          const profile = await this.fetchAgentProfileViaPodProxy(
            agentPod.namespace,
            agentPod.name,
            port,
          );
          if (profile) {
            storeProfile(profile);
            return profiles;
          }
        }
      } catch {
        // Fall back to direct agent URL below.
      }
    }

    const primary = await this.fetchAgentProfileFromUrl(baseUrl);
    if (primary && nodeNamesMatch(primary.node_name, nodeName)) {
      storeProfile(primary);
    }

    return profiles;
  }

  private async getProfile(nodeName?: string): Promise<ProfileSnapshot> {
    if (!this.connected || !this.client) {
      return {
        nodes: [],
        updatedAt: new Date().toISOString(),
      };
    }

    const selectedNode = nodeName?.trim();
    const nodeMetrics = await this.client.listNodeMetrics().catch(() => new Map());

    if (!selectedNode) {
      const nodes = await this.client.listNodes().catch(() => []);
      return buildProfileSnapshot({
        nodes,
        pods: [],
        network: this.networkEngine.getSnapshot(),
        events: this.events,
        agentProfiles: new Map(),
        nodeMetrics,
        podMetrics: [],
        namespaceScope: this.activeNamespace,
      });
    }

    const [nodesResult, pods, agentProfiles, podMetrics] = await Promise.all([
      this.client.listNodes().catch(() => []),
      this.client.listPodsOnNode(selectedNode, this.activeNamespace).catch(() => []),
      this.fetchAgentProfilesForNode(selectedNode),
      this.client.listPodMetrics(this.activeNamespace).catch(() => []),
    ]);

    let nodes = nodesResult;
    if (nodes.length === 0) {
      nodes = deriveNodesFromPods(pods);
    }

    return buildProfileSnapshot({
      nodes,
      pods,
      network: this.networkEngine.getSnapshot(),
      events: this.events,
      agentProfiles,
      nodeMetrics,
      podMetrics,
      namespaceScope: this.activeNamespace,
      selectedNode,
    });
  }
}
