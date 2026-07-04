import { load } from "js-yaml";
import type { ClusterConnectionConfig } from "../types/monitoring";

interface KubeconfigDoc {
  clusters?: Array<{
    name: string;
    cluster: {
      server: string;
      "insecure-skip-tls-verify"?: boolean;
    };
  }>;
  contexts?: Array<{
    name: string;
    context: {
      cluster: string;
      user: string;
      namespace?: string;
    };
  }>;
  users?: Array<{
    name: string;
  user?: {
      token?: string;
      "client-certificate-data"?: string;
      "client-key-data"?: string;
    };
  }>;
  "current-context"?: string;
}

export function parseKubeconfig(
  yaml: string,
  proxyUrl = "/k8s-api",
  origin?: string,
): ClusterConnectionConfig {
  const doc = load(yaml) as KubeconfigDoc | null;
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid kubeconfig: expected a YAML object");
  }

  const contextName = doc["current-context"];
  if (!contextName) {
    throw new Error("Kubeconfig missing current-context");
  }

  const context = doc.contexts?.find((item) => item.name === contextName);
  if (!context) {
    throw new Error(`Context "${contextName}" not found in kubeconfig`);
  }

  const cluster = doc.clusters?.find((item) => item.name === context.context.cluster);
  if (!cluster) {
    throw new Error(`Cluster "${context.context.cluster}" not found in kubeconfig`);
  }

  const userEntry = doc.users?.find((item) => item.name === context.context.user);

  return {
    name: contextName,
    serverUrl: cluster.cluster.server,
    proxyUrl,
    origin,
    token: userEntry?.user?.token,
  };
}

export function buildManualConnection(
  proxyUrl: string,
  token?: string,
  clusterName = "local-cluster",
  origin?: string,
): ClusterConnectionConfig {
  return {
    name: clusterName,
    serverUrl: proxyUrl,
    proxyUrl,
    origin,
    token,
  };
}
