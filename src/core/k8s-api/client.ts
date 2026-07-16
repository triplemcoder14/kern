import type { ClusterConnectionConfig } from "../types/monitoring";
import { ALL_NAMESPACES, resolveK8sNamespace, type MonitorNamespaceScope } from "../monitoring/scope";
import { resolveKubeContextName } from "../kubeconfig/resolve-context";

const KUBECTL_PROXY_PORT = 8001;

function kubectlProxyHint(): string {
  const context = resolveKubeContextName();
  if (context) {
    return `Start kubectl proxy: kubectl proxy --port=${KUBECTL_PROXY_PORT} --context=${context}`;
  }
  return `Start kubectl proxy: kubectl proxy --port=${KUBECTL_PROXY_PORT}`;
}

function isLocalKubectlProxy(proxyUrl: string): boolean {
  try {
    const parsed = new URL(proxyUrl.startsWith("http") ? proxyUrl : `http://${proxyUrl}`);
    const host = parsed.hostname;
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    const localHost =
      host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
    return localHost && port === String(KUBECTL_PROXY_PORT);
  } catch {
    return /127\.0\.0\.1:8001|localhost:8001/.test(proxyUrl);
  }
}

function unauthorizedProxyHint(proxyUrl: string): string {
  if (isLocalKubectlProxy(proxyUrl)) {
    return [
      "Unauthorized from kubectl proxy.",
      "Restart it with your active context:",
      `kubectl proxy --port=${KUBECTL_PROXY_PORT}`,
      "If Settings → Advanced has a Bearer token, clear it — local proxy already authenticates via kubeconfig.",
    ].join(" ");
  }
  return "Unauthorized — check the Bearer token / kubeconfig credentials for this cluster.";
}

function deadProxyClusterHint(): string {
  const context = resolveKubeContextName();
  if (context) {
    return `kubectl proxy is pointing at a dead cluster (context: ${context}). Check kubectl config get-contexts, then restart: kubectl proxy --port=${KUBECTL_PROXY_PORT} --context=<your-context>`;
  }
  return `kubectl proxy is pointing at a dead cluster. Check kubectl config current-context, then: kubectl proxy --port=${KUBECTL_PROXY_PORT}`;
}

interface ListMeta {
  resourceVersion?: string;
}

interface K8sList<T> {
  items: T[];
  metadata?: ListMeta;
}

interface K8sEventObject {
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    resourceVersion?: string;
  };
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
  reason?: string;
  message?: string;
  type?: string;
  lastTimestamp?: string;
  eventTime?: string;
  reportingComponent?: string;
  reportingInstance?: string;
  source?: {
    component?: string;
    host?: string;
  };
}

interface K8sNamespaceObject {
  metadata: {
    name: string;
  };
}

export interface K8sEventList {
  items: K8sEventObject[];
  resourceVersion: string;
}

interface K8sPodObject {
  metadata: {
    name: string;
    namespace?: string;
  };
  spec?: {
    nodeName?: string;
    containers?: Array<{
      name?: string;
      ports?: Array<{ containerPort: number; protocol?: string }>;
      resources?: {
        limits?: { memory?: string; cpu?: string };
        requests?: { memory?: string; cpu?: string };
      };
    }>;
  };
  status?: {
    phase?: string;
    podIP?: string;
    hostIP?: string;
    containerStatuses?: Array<{
      state?: {
        waiting?: { reason?: string };
        terminated?: { reason?: string };
      };
    }>;
  };
}

interface K8sServiceObject {
  metadata: {
    name: string;
    namespace?: string;
  };
  spec?: {
    clusterIP?: string;
    type?: string;
    selector?: Record<string, string>;
    ports?: Array<{
      name?: string;
      port: number;
      targetPort?: number | string;
      protocol?: string;
    }>;
  };
}

interface K8sEndpointsObject {
  metadata: {
    name: string;
    namespace?: string;
  };
  subsets?: Array<{
    addresses?: Array<{ ip?: string; targetRef?: { kind?: string; name?: string } }>;
    ports?: Array<{ port?: number; protocol?: string; name?: string }>;
  }>;
}

interface K8sNodeObject {
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
    capacity?: Record<string, string>;
    addresses?: Array<{ type?: string; address?: string }>;
  };
}

export interface K8sNodeSummary {
  name: string;
  zone?: string;
  cpuCores?: number;
  memoryTotalMb?: number;
  internalIPs: string[];
  ready: boolean;
}

export interface K8sNodeResourceMetrics {
  cpuUsageNano?: number;
  memoryUsedKi?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const LIST_FETCH_TIMEOUT_MS = (() => {
  const raw = typeof process !== "undefined" ? process.env.KERN_K8S_LIST_TIMEOUT_MS : undefined;
  if (!raw?.trim()) {
    return 30_000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();

export interface K8sPodMetricSummary {
  namespace: string;
  name: string;
  cpuUsageNano?: number;
  memoryUsedKi?: number;
  containers?: Array<{
    name: string;
    cpuUsageNano?: number;
    memoryUsedKi?: number;
  }>;
}

/** Kubelet /stats/summary pod memory (bytes already converted to MiB in helpers). */
export interface K8sPodMemoryStat {
  namespace: string;
  name: string;
  rssMb?: number;
  workingSetMb?: number;
  containers?: Array<{
    name: string;
    rssMb?: number;
    workingSetMb?: number;
  }>;
}

export class K8sApiClient {
  private config: ClusterConnectionConfig;

  constructor(config: ClusterConnectionConfig) {
    this.config = config;
  }

  updateConfig(config: ClusterConnectionConfig): void {
    this.config = config;
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    // Local kubectl proxy already authenticates with kubeconfig (certs/exec).
    // A leftover Bearer token (e.g. from OpenShift) overrides that and causes 401.
    if (this.config.token && !isLocalKubectlProxy(this.config.proxyUrl)) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }
    return headers;
  }

  private url(path: string): string {
    const base = this.config.proxyUrl.replace(/\/$/, "");
    if (base.startsWith("http://") || base.startsWith("https://")) {
      return `${base}${path}`;
    }
    const origin = this.config.origin?.replace(/\/$/, "") ?? "";
    return `${origin}${base}${path}`;
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(this.url(path), {
        ...init,
        signal: init.signal ?? controller.signal,
        headers: { ...this.headers(), ...init.headers },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async ping(): Promise<{ version: string }> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout("/version");
    } catch (error) {
      const detail =
        error instanceof Error && error.name === "AbortError"
          ? "timed out after 10s"
          : error instanceof Error
            ? error.message
            : "network error";
      throw new Error(`${kubectlProxyHint()} (${detail})`);
    }

    if (!response.ok) {
      const body = await response.text();
      let hint = body.trim() || response.statusText;
      if (body.includes("no such host") || body.includes("dial tcp")) {
        hint = deadProxyClusterHint();
      } else if (response.status === 401 || body.includes("Unauthorized")) {
        hint = unauthorizedProxyHint(this.config.proxyUrl);
      }
      throw new Error(`Cluster unreachable (${response.status}): ${hint}`);
    }

    const body = (await response.json()) as { gitVersion?: string };
    return { version: body.gitVersion ?? "unknown" };
  }

  /** Detect a human-readable cluster name from the live API (works when kubeconfig context is wrong). */
  async detectClusterDisplayName(): Promise<string | null> {
    try {
      const response = await this.fetchWithTimeout(
        "/apis/config.openshift.io/v1/infrastructures/cluster",
        {},
        DEFAULT_FETCH_TIMEOUT_MS,
      );
      if (response.ok) {
        const body = (await response.json()) as {
          status?: { infrastructureName?: string; apiServerURL?: string };
        };
        const infra = body.status?.infrastructureName?.trim();
        if (infra) {
          return infra;
        }
        const apiUrl = body.status?.apiServerURL?.trim();
        if (apiUrl) {
          try {
            const host = new URL(apiUrl).hostname;
            if (host && !host.includes("127.0.0.1")) {
              return host.replace(/^api\./, "");
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch {
      // not OpenShift or API unavailable
    }

    try {
      const nodes = await this.listNodes();
      if (nodes.length > 0) {
        const names = nodes.map((node) => node.name).filter(Boolean);
        const first = names[0] ?? "";

        // Single-node local engines (minikube / kind / k3d) often use that engine name.
        if (names.length === 1 && /^(minikube|kind|k3d|docker-desktop)/i.test(first)) {
          return first;
        }

        // Multipass / kubeadm style hostnames: k8s-cp, k8s-w1, …
        if (names.some((name) => /^k8s-/i.test(name))) {
          return `kubeadm (${names.length} nodes)`;
        }

        const parts = first.split(".");
        if (parts.length >= 3) {
          return parts.slice(-3).join(".");
        }

        if (names.length > 1) {
          return `${first} (+${names.length - 1})`;
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  private namespacePath(namespace?: MonitorNamespaceScope): string {
    const scoped = resolveK8sNamespace(namespace ?? ALL_NAMESPACES);
    return scoped ? `/namespaces/${encodeURIComponent(scoped)}` : "";
  }

  async listEvents(namespace?: MonitorNamespaceScope): Promise<K8sEventList> {
    const nsPath = this.namespacePath(namespace);
    const response = await this.fetchWithTimeout(
      `/api/v1${nsPath}/events?limit=500`,
      {},
      LIST_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`Failed to list events (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sEventObject>;
    return {
      items: body.items ?? [],
      resourceVersion: body.metadata?.resourceVersion ?? "0",
    };
  }

  async listNamespaces(): Promise<string[]> {
    try {
      const namespaces = await this.fetchNamespaceNames("/api/v1/namespaces");
      if (namespaces.length > 0) {
        return namespaces;
      }
    } catch {
      // fall through to OpenShift projects
    }

    try {
      return await this.fetchNamespaceNames("/apis/project.openshift.io/v1/projects");
    } catch {
      return [];
    }
  }

  private async fetchNamespaceNames(path: string): Promise<string[]> {
    const response = await this.fetchWithTimeout(path, {}, LIST_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Failed to list namespaces (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sNamespaceObject>;
    return (body.items ?? [])
      .map((item) => item.metadata.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  async getConfigMap(namespace: string, name: string): Promise<Record<string, string> | null> {
    const response = await this.fetchWithTimeout(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`,
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to read ConfigMap ${namespace}/${name} (${response.status})`);
    }
    const body = (await response.json()) as { data?: Record<string, string> };
    return body.data ?? {};
  }

  async listPods(namespace?: MonitorNamespaceScope): Promise<K8sPodObject[]> {
    const nsPath = this.namespacePath(namespace);
    const response = await this.fetchWithTimeout(`/api/v1${nsPath}/pods`, {}, LIST_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Failed to list pods (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sPodObject>;
    return body.items ?? [];
  }

  async listServices(namespace?: MonitorNamespaceScope): Promise<K8sServiceObject[]> {
    const nsPath = this.namespacePath(namespace);
    const response = await this.fetchWithTimeout(
      `/api/v1${nsPath}/services`,
      {},
      LIST_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`Failed to list services (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sServiceObject>;
    return body.items ?? [];
  }

  async listEndpoints(namespace?: MonitorNamespaceScope): Promise<K8sEndpointsObject[]> {
    const nsPath = this.namespacePath(namespace);
    const response = await this.fetchWithTimeout(
      `/api/v1${nsPath}/endpoints`,
      {},
      LIST_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`Failed to list endpoints (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sEndpointsObject>;
    return body.items ?? [];
  }

  async listNodes(): Promise<K8sNodeSummary[]> {
    const response = await this.fetchWithTimeout("/api/v1/nodes", {}, LIST_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Failed to list nodes (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sNodeObject>;
    return (body.items ?? []).map((node) => {
      const ready = (node.status?.conditions ?? []).some(
        (condition) => condition.type === "Ready" && condition.status === "True",
      );
      const zone =
        node.metadata.labels?.["topology.kubernetes.io/zone"] ??
        node.metadata.labels?.["failure-domain.beta.kubernetes.io/zone"];
      const cpu = node.status?.capacity?.cpu;
      const memoryKi = node.status?.capacity?.memory;
      const internalIPs = (node.status?.addresses ?? [])
        .filter((entry) => entry.type === "InternalIP" && entry.address)
        .map((entry) => entry.address as string);
      return {
        name: node.metadata.name,
        zone,
        cpuCores: cpu ? Number.parseInt(cpu, 10) : undefined,
        memoryTotalMb: memoryKi ? parseCapacityMemoryMi(memoryKi) : undefined,
        internalIPs,
        ready,
      };
    });
  }

  async listNodeMetrics(): Promise<Map<string, K8sNodeResourceMetrics>> {
    const response = await this.fetchWithTimeout("/apis/metrics.k8s.io/v1beta1/nodes");
    if (!response.ok) {
      return new Map();
    }
    const body = (await response.json()) as K8sList<{
      metadata: { name: string };
      usage?: { cpu?: string; memory?: string };
    }>;
    const map = new Map<string, K8sNodeResourceMetrics>();
    for (const item of body.items ?? []) {
      map.set(item.metadata.name, {
        cpuUsageNano: parseNanoCpu(item.usage?.cpu),
        memoryUsedKi: parseKiQuantity(item.usage?.memory),
      });
    }
    return map;
  }

  async listPodMetrics(namespace?: MonitorNamespaceScope): Promise<K8sPodMetricSummary[]> {
    const scoped = resolveK8sNamespace(namespace ?? ALL_NAMESPACES);
    const path = scoped
      ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(scoped)}/pods`
      : "/apis/metrics.k8s.io/v1beta1/pods";
    const response = await this.fetchWithTimeout(path, {}, LIST_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as K8sList<{
      metadata: { name: string; namespace?: string };
      containers?: Array<{ name?: string; usage?: { cpu?: string; memory?: string } }>;
    }>;
    return (body.items ?? []).map((item) => {
      let cpuNano = 0;
      let memoryKi = 0;
      const containers = (item.containers ?? []).map((container) => {
        const containerCpu = parseNanoCpu(container.usage?.cpu) ?? 0;
        const containerMem = parseKiQuantity(container.usage?.memory) ?? 0;
        cpuNano += containerCpu;
        memoryKi += containerMem;
        return {
          name: container.name ?? "container",
          cpuUsageNano: containerCpu > 0 ? containerCpu : undefined,
          memoryUsedKi: containerMem > 0 ? containerMem : undefined,
        };
      });
      return {
        namespace: item.metadata.namespace ?? "default",
        name: item.metadata.name,
        cpuUsageNano: cpuNano > 0 ? cpuNano : undefined,
        memoryUsedKi: memoryKi > 0 ? memoryKi : undefined,
        containers,
      };
    });
  }

  /**
   * Per-pod RSS / working set from kubelet stats/summary.
   * Preferred when metrics-server is missing or incomplete.
   */
  async listNodePodMemoryStats(nodeName: string): Promise<K8sPodMemoryStat[]> {
    const path = `/api/v1/nodes/${encodeURIComponent(nodeName)}/proxy/stats/summary`;
    const response = await this.fetchWithTimeout(path, {}, LIST_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as {
      pods?: Array<{
        podRef?: { name?: string; namespace?: string };
        memory?: {
          rssBytes?: number;
          workingSetBytes?: number;
          usageBytes?: number;
        };
        containers?: Array<{
          name?: string;
          memory?: {
            rssBytes?: number;
            workingSetBytes?: number;
            usageBytes?: number;
          };
        }>;
      }>;
    };

    const out: K8sPodMemoryStat[] = [];
    for (const pod of body.pods ?? []) {
      const name = pod.podRef?.name?.trim() ?? "";
      const namespace = pod.podRef?.namespace?.trim() ?? "default";
      if (!name) {
        continue;
      }
      const containers: NonNullable<K8sPodMemoryStat["containers"]> = [];
      for (const container of pod.containers ?? []) {
        const containerName = container.name?.trim() ?? "";
        if (!containerName) {
          continue;
        }
        containers.push({
          name: containerName,
          rssMb: bytesToMb(container.memory?.rssBytes),
          workingSetMb:
            bytesToMb(container.memory?.workingSetBytes) ??
            bytesToMb(container.memory?.usageBytes),
        });
      }
      out.push({
        namespace,
        name,
        rssMb: bytesToMb(pod.memory?.rssBytes),
        workingSetMb:
          bytesToMb(pod.memory?.workingSetBytes) ?? bytesToMb(pod.memory?.usageBytes),
        containers,
      });
    }
    return out;
  }

  async listPodsOnNode(
    nodeName: string,
    namespace?: MonitorNamespaceScope,
  ): Promise<Array<{ namespace: string; name: string; nodeName: string; memoryLimitMb?: number }>> {
    const nsPath = this.namespacePath(namespace);
    const query = new URLSearchParams({
      fieldSelector: `spec.nodeName=${nodeName}`,
      limit: "500",
    });
    const response = await this.fetchWithTimeout(
      `/api/v1${nsPath}/pods?${query.toString()}`,
      {},
      LIST_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`Failed to list pods on node ${nodeName} (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sPodObject>;
    return (body.items ?? [])
      .map((pod) => ({
        namespace: pod.metadata.namespace ?? "default",
        name: pod.metadata.name,
        nodeName: pod.spec?.nodeName ?? nodeName,
        memoryLimitMb: sumPodMemoryLimitMb(pod),
      }))
      .filter((pod) => pod.name.length > 0);
  }

  async listPodsOnNodes(namespace?: MonitorNamespaceScope): Promise<Array<{ namespace: string; name: string; nodeName: string }>> {
    const pods = await this.listPods(namespace);
    return pods
      .map((pod) => ({
        namespace: pod.metadata.namespace ?? "default",
        name: pod.metadata.name,
        nodeName: pod.spec?.nodeName ?? "",
      }))
      .filter((pod) => pod.nodeName.length > 0);
  }

  async listAgentPods(namespace?: string): Promise<
    Array<{ namespace: string; name: string; nodeName: string; hostIP: string }>
  > {
    const query = new URLSearchParams({ labelSelector: "app=kern-agent" });
    const path = namespace
      ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?${query.toString()}`
      : `/api/v1/pods?${query.toString()}`;
    const response = await this.fetchWithTimeout(path, {}, LIST_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Failed to list kern-agent pods (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sPodObject>;
    return (body.items ?? [])
      .map((pod) => ({
        namespace: pod.metadata.namespace ?? "default",
        name: pod.metadata.name,
        nodeName: pod.spec?.nodeName ?? "",
        // hostNetwork agents expose the node IP as podIP
        hostIP: pod.status?.hostIP || pod.status?.podIP || "",
      }))
      .filter((pod) => pod.name.length > 0 && pod.nodeName.length > 0);
  }

  async listLabeledPods(
    namespace: string,
    labelSelector: string,
  ): Promise<Array<{ name: string; nodeName: string }>> {
    const query = new URLSearchParams({ labelSelector });
    const response = await this.fetchWithTimeout(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?${query.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to list pods in ${namespace} (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sPodObject>;
    return (body.items ?? [])
      .map((pod) => ({
        name: pod.metadata.name,
        nodeName: pod.spec?.nodeName ?? "",
      }))
      .filter((pod) => pod.name.length > 0 && pod.nodeName.length > 0);
  }

  async fetchPodProxy(
    namespace: string,
    podName: string,
    port: number,
    proxyPath: string,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const normalized = proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`;
    return this.fetchWithTimeout(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}:${port}/proxy${normalized}`,
      {},
      timeoutMs,
    );
  }

  async watchEvents(
    resourceVersion: string,
    onEvent: (event: K8sEventObject, type: "ADDED" | "MODIFIED" | "DELETED") => void,
    signal: AbortSignal,
    namespace?: MonitorNamespaceScope,
  ): Promise<void> {
    const nsPath = this.namespacePath(namespace);
    const path = `/api/v1${nsPath}/events?watch=1&resourceVersion=${encodeURIComponent(resourceVersion)}`;
    const response = await fetch(this.url(path), {
      headers: {
        ...this.headers(),
        Accept: "application/json;stream=watch",
      },
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Watch failed (${response.status})`);
    }

    await this.consumeWatchStream(response.body, onEvent);
  }

  private async consumeWatchStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: K8sEventObject, type: "ADDED" | "MODIFIED" | "DELETED") => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const envelope = JSON.parse(trimmed) as {
            type?: "ADDED" | "MODIFIED" | "DELETED";
            object?: K8sEventObject;
          };
          if (envelope.object && envelope.type) {
            onEvent(envelope.object, envelope.type);
          }
        } catch {
          // skip malformed watch frames
        }
      }
    }
  }
}

export type { K8sEndpointsObject, K8sEventObject, K8sPodObject, K8sServiceObject };

function parseCapacityMemoryMi(value: string): number {
  if (value.endsWith("Ki")) {
    return Math.round(Number.parseInt(value, 10) / 1024);
  }
  if (value.endsWith("Mi")) {
    return Number.parseInt(value, 10);
  }
  if (value.endsWith("Gi")) {
    return Number.parseInt(value, 10) * 1024;
  }
  return 0;
}

function sumPodMemoryLimitMb(pod: K8sPodObject): number | undefined {
  let total = 0;
  let found = false;
  for (const container of pod.spec?.containers ?? []) {
    const raw = container.resources?.limits?.memory;
    if (!raw) {
      continue;
    }
    const mb = parseCapacityMemoryMi(raw);
    if (mb > 0) {
      total += mb;
      found = true;
    }
  }
  return found ? total : undefined;
}

function parseKiQuantity(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  if (trimmed.endsWith("Ki")) {
    return Math.round(numeric);
  }
  if (trimmed.endsWith("Mi")) {
    return Math.round(numeric * 1024);
  }
  if (trimmed.endsWith("Gi")) {
    return Math.round(numeric * 1024 * 1024);
  }
  if (trimmed.endsWith("Ti")) {
    return Math.round(numeric * 1024 * 1024 * 1024);
  }
  if (trimmed.endsWith("k")) {
    return Math.round(numeric / 1024);
  }
  if (trimmed.endsWith("M")) {
    return Math.round((numeric * 1000 * 1000) / 1024);
  }
  if (trimmed.endsWith("G")) {
    return Math.round((numeric * 1000 * 1000 * 1000) / 1024);
  }
  // Bare number from metrics APIs is usually bytes.
  return Math.round(numeric / 1024);
}

function bytesToMb(bytes?: number): number | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return undefined;
  }
  return Math.round(bytes / (1024 * 1024));
}

function parseNanoCpu(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number.parseInt(value.replace(/n$/, ""), 10);
  return Number.isFinite(numeric) ? numeric : undefined;
}
