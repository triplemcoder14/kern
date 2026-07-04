import type { K8sEventObject, K8sPodObject } from "../k8s-api/client";
import type { Incident, MonitorCategory, MonitorEvent, MonitorSeverity } from "../types/monitoring";

function severityFromEventType(type?: string): MonitorSeverity {
  if (type === "Warning") {
    return "warning";
  }
  if (type === "Error") {
    return "critical";
  }
  return "info";
}

function categoryFromReason(reason?: string, kind?: string): MonitorCategory {
  const value = `${reason ?? ""} ${kind ?? ""}`.toLowerCase();
  if (value.includes("network") || value.includes("connection") || value.includes("timeout")) {
    return "network";
  }
  if (value.includes("service") || value.includes("endpoint")) {
    return "service";
  }
  if (value.includes("cost") || value.includes("quota") || value.includes("limit")) {
    return "cost";
  }
  if (kind === "Pod") {
    return "workload";
  }
  return "incident";
}

export function eventFromK8sEvent(event: K8sEventObject): MonitorEvent {
  const timestamp = event.lastTimestamp ?? event.eventTime ?? new Date().toISOString();
  const reason = event.reason ?? "Event";
  const involved = event.involvedObject;

  const source =
    event.reportingComponent ??
    event.source?.component ??
    (involved?.kind === "Pod" ? "kubelet" : "kube-apiserver");

  return {
    id: event.metadata.uid ?? `${involved?.kind}-${involved?.name}-${timestamp}`,
    timestamp,
    severity: severityFromEventType(event.type),
    category: categoryFromReason(reason, involved?.kind),
    title: reason,
    message: event.message ?? reason,
    namespace: involved?.namespace ?? event.metadata.namespace,
    resourceKind: involved?.kind,
    resourceName: involved?.name,
    source,
  };
}

export function eventFromPodFailure(pod: K8sPodObject): MonitorEvent | null {
  const phase = pod.status?.phase;
  const waitingReason = pod.status?.containerStatuses?.[0]?.state?.waiting?.reason;
  const terminatedReason = pod.status?.containerStatuses?.[0]?.state?.terminated?.reason;

  if (phase !== "Failed" && waitingReason !== "CrashLoopBackOff" && !terminatedReason) {
    return null;
  }

  const reason = waitingReason ?? terminatedReason ?? phase ?? "Failed";
  return {
    id: `pod-failure-${pod.metadata.namespace}-${pod.metadata.name}`,
    timestamp: new Date().toISOString(),
    severity: "critical",
    category: "workload",
    title: `Pod ${reason}`,
    message: `Pod ${pod.metadata.name} in ${pod.metadata.namespace} is unhealthy (${reason})`,
    namespace: pod.metadata.namespace,
    resourceKind: "Pod",
    resourceName: pod.metadata.name,
    source: "kubernetes",
  };
}

export function incidentFromEvent(event: MonitorEvent): Incident | null {
  if (event.severity === "info") {
    return null;
  }

  return {
    id: `incident-${event.id}`,
    openedAt: event.timestamp,
    updatedAt: event.timestamp,
    severity: event.severity,
    category: event.category,
    title: event.title,
    summary: event.message,
    namespace: event.namespace,
    resourceKind: event.resourceKind,
    resourceName: event.resourceName,
    status: "open",
    eventIds: [event.id],
  };
}

export function mergeIncident(existing: Incident, event: MonitorEvent): Incident {
  return {
    ...existing,
    updatedAt: event.timestamp,
    severity: event.severity === "critical" ? "critical" : existing.severity,
    summary: event.message,
    eventIds: existing.eventIds.includes(event.id)
      ? existing.eventIds
      : [...existing.eventIds, event.id],
  };
}

export function incidentKey(event: MonitorEvent): string {
  return `${event.category}:${event.namespace ?? "_"}:${event.resourceKind ?? "_"}:${event.resourceName ?? event.title}`;
}
