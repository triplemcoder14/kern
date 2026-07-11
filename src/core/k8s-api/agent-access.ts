import type { K8sApiClient } from "./client";

export const DEFAULT_AGENT_NAMESPACE = "kern";
export const DEFAULT_AGENT_PORT = 9474;

export async function listAgentPods(
  client: K8sApiClient,
): Promise<Array<{ namespace: string; name: string; nodeName: string }>> {
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
