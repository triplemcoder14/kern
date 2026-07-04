export type ResourceKind = "Pod" | "Deployment" | "Service" | "Namespace";

export interface ObjectMeta {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  uid?: string;
  creationTimestamp?: string;
}

export interface PodSpec {
  containers: Array<{
    name: string;
    image: string;
    ports?: Array<{ containerPort: number; protocol?: string }>;
  }>;
}

export interface PodStatus {
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
  podIP?: string;
  hostIP?: string;
}

export interface Pod {
  apiVersion: "v1";
  kind: "Pod";
  metadata: ObjectMeta;
  spec: PodSpec;
  status?: PodStatus;
}

export interface DeploymentSpec {
  replicas: number;
  selector: { matchLabels: Record<string, string> };
  template: {
    metadata: { labels: Record<string, string> };
    spec: PodSpec;
  };
}

export interface DeploymentStatus {
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
}

export interface Deployment {
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: ObjectMeta;
  spec: DeploymentSpec;
  status?: DeploymentStatus;
}

export interface ServiceSpec {
  type?: "ClusterIP" | "NodePort" | "LoadBalancer";
  selector?: Record<string, string>;
  ports?: Array<{
    name?: string;
    port: number;
    targetPort?: number | string;
    protocol?: string;
  }>;
  clusterIP?: string;
}

export interface Service {
  apiVersion: "v1";
  kind: "Service";
  metadata: ObjectMeta;
  spec: ServiceSpec;
}

export interface Namespace {
  apiVersion: "v1";
  kind: "Namespace";
  metadata: ObjectMeta;
  status?: { phase: "Active" | "Terminating" };
}

export type K8sResource = Pod | Deployment | Service | Namespace;

export interface ClusterStats {
  pods: number;
  deployments: number;
  services: number;
  namespaces: number;
}

export function resourceKey(kind: ResourceKind, namespace: string, name: string): string {
  return `${kind}/${namespace}/${name}`;
}

export function getResourceNamespace(resource: K8sResource): string {
  if (resource.kind === "Namespace") {
    return "";
  }
  return resource.metadata.namespace ?? "default";
}

export function getResourceStatus(resource: K8sResource): string {
  switch (resource.kind) {
    case "Pod":
      return resource.status?.phase ?? "Pending";
    case "Deployment":
      return `${resource.status?.readyReplicas ?? 0}/${resource.status?.replicas ?? resource.spec.replicas} ready`;
    case "Service":
      return resource.spec.type ?? "ClusterIP";
    case "Namespace":
      return resource.status?.phase ?? "Active";
  }
}
