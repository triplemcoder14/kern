export interface ClusterConfig {
  clusterName: string;
  proxyUrl: string;
  ebpfCollectorUrl: string;
  token: string;
  kubeconfig: string;
}

const STORAGE_KEY = "kern-cluster-config";
const LEGACY_STORAGE_KEY = "port-of-k8s-cluster-config";

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  clusterName: "minikube",
  proxyUrl: "http://127.0.0.1:8001 (server)",
  ebpfCollectorUrl: "http://127.0.0.1:9474",
  token: "",
  kubeconfig: "",
};

export function loadClusterConfig(): ClusterConfig {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
      }
    }
    if (!raw) {
      return DEFAULT_CLUSTER_CONFIG;
    }
    return { ...DEFAULT_CLUSTER_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CLUSTER_CONFIG;
  }
}

export function saveClusterConfig(config: ClusterConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function configToConnectInput(config: ClusterConfig) {
  return {
    clusterName: config.clusterName.trim() || "minikube",
    ebpfCollectorUrl: config.ebpfCollectorUrl.trim() || DEFAULT_CLUSTER_CONFIG.ebpfCollectorUrl,
    token: config.token.trim() || undefined,
    kubeconfig: config.kubeconfig.trim() || undefined,
  };
}
