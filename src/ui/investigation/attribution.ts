/** Strip ReplicaSet / DaemonSet / StatefulSet hash suffixes for workload names. */
export function workloadBaseName(podName: string): string {
  const parts = podName.split("-");
  if (
    parts.length >= 3 &&
    /^[a-z0-9]{4,10}$/i.test(parts[parts.length - 1] ?? "") &&
    /^[a-z0-9]{4,10}$/i.test(parts[parts.length - 2] ?? "")
  ) {
    return parts.slice(0, -2).join("-") || podName;
  }
  if (
    parts.length >= 2 &&
    (/^[a-z0-9]{5,10}$/i.test(parts[parts.length - 1] ?? "") ||
      /^\d+$/.test(parts[parts.length - 1] ?? ""))
  ) {
    return parts.slice(0, -1).join("-") || podName;
  }
  return podName;
}

export interface OwnerRef {
  apiVersion?: string;
  kind?: string;
  name?: string;
  uid?: string;
  controller?: boolean;
}

/**
 * Resolve the Kubernetes workload name that owns a pod.
 * Pods are usually owned by a ReplicaSet; ReplicaSets by a Deployment.
 * Without a full owner chain we strip hash suffixes (same heuristic as the service map).
 */
export function resolveWorkloadNameFromOwners(
  podName: string,
  ownerRefs?: OwnerRef[] | null,
): string {
  const controller =
    ownerRefs?.find((ref) => ref.controller) ?? ownerRefs?.[0] ?? undefined;
  const kind = controller?.kind ?? "";
  const ownerName = controller?.name?.trim() ?? "";

  if (kind === "StatefulSet" || kind === "DaemonSet" || kind === "Job" || kind === "CronJob") {
    return ownerName || workloadBaseName(podName);
  }
  if (kind === "ReplicaSet" && ownerName) {
    return workloadBaseName(ownerName);
  }
  if (ownerName) {
    return workloadBaseName(ownerName);
  }
  return workloadBaseName(podName);
}

/** True when a pod belongs to the investigated workload via name, members, or owner. */
export function podBelongsToWorkload(
  podName: string,
  options: {
    workloadName: string;
    memberPods?: string[];
    ownerWorkload?: string;
  },
): boolean {
  const { workloadName, memberPods, ownerWorkload } = options;
  if (!workloadName) {
    return false;
  }
  if (podName === workloadName) {
    return true;
  }
  if (memberPods?.includes(podName)) {
    return true;
  }
  if (ownerWorkload && ownerWorkload === workloadName) {
    return true;
  }
  if (podName.startsWith(`${workloadName}-`)) {
    return true;
  }
  if (workloadBaseName(podName) === workloadName) {
    return true;
  }
  return false;
}
