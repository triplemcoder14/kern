import { podBelongsToWorkload } from "./attribution";
import type { InvestigationFocus } from "./types";

export function podMatchesInvestigation(
  podName: string,
  podNamespace: string | undefined,
  investigation: Pick<InvestigationFocus, "name" | "namespace" | "memberPods">,
  ownerWorkload?: string,
): boolean {
  if (investigation.namespace && podNamespace && podNamespace !== investigation.namespace) {
    return false;
  }
  // Previous prefix-only matching (missed odd naming / owner-ref cases):
  // if (podName === investigation.name) return true;
  // if (podName.startsWith(`${investigation.name}-`)) return true;
  // if (investigation.memberPods?.includes(podName)) return true;
  return podBelongsToWorkload(podName, {
    workloadName: investigation.name,
    memberPods: investigation.memberPods,
    ownerWorkload,
  });
}

/** Pick the node hosting the investigated workload (most matching pods wins). */
export function resolveInvestigationNode(
  investigation: Pick<InvestigationFocus, "name" | "namespace" | "memberPods" | "nodeName">,
  placements:
    | Array<{ namespace: string; name: string; nodeName: string; ownerWorkload?: string }>
    | undefined,
  nodeSummaries: Array<{ name: string; cpuPercent?: number }> = [],
): string | undefined {
  if (investigation.nodeName) {
    return investigation.nodeName;
  }
  if (!placements || placements.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const pod of placements) {
    if (!podMatchesInvestigation(pod.name, pod.namespace, investigation, pod.ownerWorkload)) {
      continue;
    }
    counts.set(pod.nodeName, (counts.get(pod.nodeName) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return undefined;
  }
  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    const cpuA = nodeSummaries.find((node) => node.name === a[0])?.cpuPercent ?? 0;
    const cpuB = nodeSummaries.find((node) => node.name === b[0])?.cpuPercent ?? 0;
    return cpuB - cpuA;
  });
  return ranked[0]?.[0];
}
