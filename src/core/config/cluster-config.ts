export interface ClusterConfig {
  clusterName: string;
  proxyUrl: string;
  ebpfCollectorUrl: string;
  token: string;
  kubeconfig: string;
}

const STORAGE_KEY = "port-of-k8s-cluster-config";

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  clusterName: "minikube",
  proxyUrl: "/k8s-api",
  ebpfCollectorUrl: "http://127.0.0.1:9474",
  token: "",
  kubeconfig: "",
};

export function loadClusterConfig(): ClusterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    proxyUrl: config.proxyUrl.trim() || "/k8s-api",
    ebpfCollectorUrl: config.ebpfCollectorUrl.trim() || DEFAULT_CLUSTER_CONFIG.ebpfCollectorUrl,
    token: config.token.trim() || undefined,
    kubeconfig: config.kubeconfig.trim() || undefined,
    origin: window.location.origin,
  };
}
