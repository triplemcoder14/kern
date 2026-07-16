import type { K8sApiClient } from "./client";

export const DEFAULT_AGENT_NAMESPACE = "kern";
export const DEFAULT_AGENT_PORT = 9474;

export type AgentPodRef = {
  namespace: string;
  name: string;
  nodeName: string;
  hostIP: string;
};

export async function listAgentPods(client: K8sApiClient): Promise<AgentPodRef[]> {
  let pods = await client.listAgentPods(DEFAULT_AGENT_NAMESPACE).catch(() => []);
  if (pods.length === 0) {
    pods = await client.listAgentPods();
  }
  return pods;
}

export async function fetchDirectAgent(
  baseUrl: string,
  path: string,
  timeoutMs = 5000,
): Promise<Response | null> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = `${baseUrl.replace(/\/$/, "")}${normalized}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAgentViaPodProxy(
  client: K8sApiClient,
  path: string,
  options: { port?: number; timeoutMs?: number; maxPods?: number } = {},
): Promise<{ response: Response; pod: { namespace: string; name: string } } | null> {
  const port = options.port ?? DEFAULT_AGENT_PORT;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxPods = options.maxPods ?? 5;
  const pods = await listAgentPods(client);

  for (const pod of pods.slice(0, maxPods)) {
    try {
      const response = await client.fetchPodProxy(
        pod.namespace,
        pod.name,
        port,
        path,
        timeoutMs,
      );
      if (response.ok) {
        return { response, pod };
      }
    } catch {
      // try next agent pod
    }
  }

  return null;
}

/** Pull the same path from every agent pod and return successful JSON bodies. */
export async function fetchAllAgentJson<T>(
  client: K8sApiClient,
  path: string,
  options: { port?: number; timeoutMs?: number; maxPods?: number } = {},
): Promise<Array<{ body: T; pod: AgentPodRef }>> {
  const port = options.port ?? DEFAULT_AGENT_PORT;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxPods = options.maxPods ?? 16;
  const pods = await listAgentPods(client);
  const results: Array<{ body: T; pod: AgentPodRef }> = [];

  await Promise.all(
    pods.slice(0, maxPods).map(async (pod) => {
      try {
        // Prefer hostNetwork node IP (works from laptop → multipass without svc PF).
        if (pod.hostIP) {
          const direct = await fetchDirectAgent(`http://${pod.hostIP}:${port}`, path, timeoutMs);
          if (direct) {
            results.push({ body: (await direct.json()) as T, pod });
            return;
          }
        }

        const response = await client.fetchPodProxy(
          pod.namespace,
          pod.name,
          port,
          path,
          timeoutMs,
        );
        if (!response.ok) {
          return;
        }
        results.push({
          body: (await response.json()) as T,
          pod,
        });
      } catch {
        // skip unreachable agents
      }
    }),
  );

  return results;
}
