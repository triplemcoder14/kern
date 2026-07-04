import type { ClusterStats, K8sResource, ResourceKind } from "./k8s";

export type WorkerRequest =
  | { type: "LOAD_CLUSTER" }
  | { type: "RESET_CLUSTER" }
  | { type: "APPLY_YAML"; yaml: string }
  | { type: "DELETE"; kind: ResourceKind; namespace: string; name: string }
  | { type: "LIST"; kind: ResourceKind; namespace?: string }
  | { type: "GET"; kind: ResourceKind; namespace: string; name: string }
  | { type: "SUBSCRIBE" };

export type WorkerEvent =
  | { type: "CLUSTER_READY"; stats: ClusterStats }
  | { type: "RESOURCE_ADDED"; resource: K8sResource }
  | { type: "RESOURCE_UPDATED"; resource: K8sResource }
  | { type: "RESOURCE_DELETED"; kind: ResourceKind; namespace: string; name: string }
  | { type: "ERROR"; message: string }
  | { type: "RESOURCES_SNAPSHOT"; resources: K8sResource[] };

export interface WorkerResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface WorkerMessage {
  id: string;
  request: WorkerRequest;
}

export interface WorkerEnvelope {
  type: "request";
  message: WorkerMessage;
}

export interface WorkerEventEnvelope {
  type: "event";
  event: WorkerEvent;
}

export interface WorkerResponseEnvelope {
  type: "response";
  response: WorkerResponse;
}

export type MainToWorker = WorkerEnvelope;
export type WorkerToMain = WorkerEventEnvelope | WorkerResponseEnvelope;
