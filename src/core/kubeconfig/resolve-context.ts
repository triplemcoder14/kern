import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";

interface KubeconfigDoc {
  "current-context"?: string;
  clusters?: Array<{
    name: string;
    cluster?: { server?: string };
  }>;
  contexts?: Array<{
    name: string;
    context?: { cluster?: string };
  }>;
}

const PLACEHOLDER_CLUSTER_NAMES = new Set([
  "minikube",
  "local-cluster",
  "cluster",
  "default",
  "docker-desktop",
  "docker-for-desktop",
]);

const LOCAL_CLUSTER_SERVERS = [
  /^https?:\/\/127\.0\.0\.1(:\d+)?\/?$/,
  /^https?:\/\/localhost(:\d+)?\/?$/,
  /^https?:\/\/host\.docker\.internal(:\d+)?\/?$/,
];

export function isPlaceholderClusterName(name?: string): boolean {
  const trimmed = name?.trim();
  if (!trimmed) {
    return true;
  }
  return PLACEHOLDER_CLUSTER_NAMES.has(trimmed.toLowerCase());
}

function isLocalClusterServer(server?: string): boolean {
  const trimmed = server?.trim();
  if (!trimmed) {
    return true;
  }
  return LOCAL_CLUSTER_SERVERS.some((pattern) => pattern.test(trimmed));
}

function friendlyClusterName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.includes("ocp") || trimmed.startsWith("api-")) {
    return trimmed
      .replace(/^api-/i, "")
      .replace(/:\d+$/, "")
      .replace(/-/g, ".");
  }
  return trimmed;
}

function readKubeconfigDoc(kubeconfigPath?: string): KubeconfigDoc | null {
  const candidates = [
    kubeconfigPath,
    process.env.KUBECONFIG?.split(/[:;]/)[0]?.trim(),
    join(homedir(), ".kube", "config"),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const doc = load(raw) as KubeconfigDoc | null;
      if (doc && typeof doc === "object") {
        return doc;
      }
    } catch {
      // try next candidate path
    }
  }
  return null;
}

/** Read the active kubectl context name from the local kubeconfig (API server host). */
export function resolveKubeContextName(kubeconfigPath?: string): string | null {
  const doc = readKubeconfigDoc(kubeconfigPath);
  return doc?.["current-context"]?.trim() || null;
}

/** Resolve the cluster entry tied to the current context (better than context name when it says "minikube"). */
export function resolveKubeClusterEntryName(kubeconfigPath?: string): string | null {
  const doc = readKubeconfigDoc(kubeconfigPath);
  if (!doc) {
    return null;
  }

  const contextName = doc["current-context"]?.trim();
  if (!contextName) {
    return null;
  }

  const context = doc.contexts?.find((item) => item.name === contextName);
  const clusterRef = context?.context?.cluster;
  if (!clusterRef) {
    return isPlaceholderClusterName(contextName) ? null : contextName;
  }

  const cluster = doc.clusters?.find((item) => item.name === clusterRef);
  const server = cluster?.cluster?.server;
  const clusterName = cluster?.name?.trim() || clusterRef;

  if (isPlaceholderClusterName(contextName) || isLocalClusterServer(server)) {
    return friendlyClusterName(clusterName);
  }

  return contextName;
}

export function resolveClusterDisplayName(explicit?: string, kubeconfigYaml?: string): string {
  if (typeof process !== "undefined" && process.env?.KERN_CLUSTER_NAME?.trim()) {
    return process.env.KERN_CLUSTER_NAME.trim();
  }

  const trimmed = explicit?.trim();
  if (trimmed && !isPlaceholderClusterName(trimmed)) {
    return trimmed;
  }

  if (kubeconfigYaml?.trim()) {
    try {
      const doc = load(kubeconfigYaml) as KubeconfigDoc | null;
      const contextName = doc?.["current-context"]?.trim();
      if (contextName && !isPlaceholderClusterName(contextName)) {
        return contextName;
      }
      const context = doc?.contexts?.find((item) => item.name === contextName);
      const clusterRef = context?.context?.cluster;
      const cluster = doc?.clusters?.find((item) => item.name === clusterRef);
      if (cluster?.name) {
        return friendlyClusterName(cluster.name);
      }
    } catch {
      // fall through
    }
  }

  const clusterEntry = resolveKubeClusterEntryName();
  if (clusterEntry && !isPlaceholderClusterName(clusterEntry)) {
    return clusterEntry;
  }

  const contextName = resolveKubeContextName();
  if (contextName && !isPlaceholderClusterName(contextName)) {
    return contextName;
  }

  return "cluster";
}
