import type { ClusterConnectionConfig } from "../types/monitoring";

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
    containers?: Array<{
      ports?: Array<{ containerPort: number; protocol?: string }>;
    }>;
  };
  status?: {
    phase?: string;
    podIP?: string;
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
    if (this.config.token) {
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

  private async fetchWithTimeout(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
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
      const hint = "Start kubectl proxy: kubectl proxy --port=8001 --context=minikube";
      const detail =
        error instanceof Error && error.name === "AbortError"
          ? "timed out after 10s"
          : error instanceof Error
            ? error.message
            : "network error";
      throw new Error(`${hint} (${detail})`);
    }

    if (!response.ok) {
      const body = await response.text();
      const hint =
        body.includes("no such host") || body.includes("dial tcp")
          ? "kubectl proxy is pointing at a dead cluster. Run: kubectl config use-context minikube && kubectl proxy --port=8001 --context=minikube"
          : body.trim() || response.statusText;
      throw new Error(`Cluster unreachable (${response.status}): ${hint}`);
    }

    const body = (await response.json()) as { gitVersion?: string };
    return { version: body.gitVersion ?? "unknown" };
  }

  async listEvents(): Promise<K8sEventList> {
    const response = await this.fetchWithTimeout("/api/v1/events");
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
    const response = await this.fetchWithTimeout("/api/v1/namespaces");
    if (!response.ok) {
      throw new Error(`Failed to list namespaces (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sNamespaceObject>;
    return (body.items ?? [])
      .map((item) => item.metadata.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  async listPods(): Promise<K8sPodObject[]> {
    const response = await this.fetchWithTimeout("/api/v1/pods");
    if (!response.ok) {
      throw new Error(`Failed to list pods (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sPodObject>;
    return body.items ?? [];
  }

  async listServices(): Promise<K8sServiceObject[]> {
    const response = await this.fetchWithTimeout("/api/v1/services");
    if (!response.ok) {
      throw new Error(`Failed to list services (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sServiceObject>;
    return body.items ?? [];
  }

  async listEndpoints(): Promise<K8sEndpointsObject[]> {
    const response = await this.fetchWithTimeout("/api/v1/endpoints");
    if (!response.ok) {
      throw new Error(`Failed to list endpoints (${response.status})`);
    }
    const body = (await response.json()) as K8sList<K8sEndpointsObject>;
    return body.items ?? [];
  }

  async watchEvents(
    resourceVersion: string,
    onEvent: (event: K8sEventObject, type: "ADDED" | "MODIFIED" | "DELETED") => void,
    signal: AbortSignal,
  ): Promise<void> {
    const path = `/api/v1/events?watch=1&resourceVersion=${encodeURIComponent(resourceVersion)}`;
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
