import type {
  NodeProfileDetail,
  PodConsumer,
  ProcessSample,
  ProfileStackFrame,
} from "../types/profiling";

export type MemoryFlameMode = "retained" | "allocated" | "count";

/**
 * Build a retained-memory flamegraph from live agent RSS data.
 *
 * Hierarchy: all → pod → process
 * Width = share of retained RSS (not CPU samples).
 *
 * Allocation-site stacks (malloc/runtime.mallocgc) will replace the
 * process leaf when an alloc sampler lands — until then RSS ownership
 * answers "who owns the memory?" which is the memory investigation question.
 */
export function buildMemoryStack(
  detail: Pick<NodeProfileDetail, "name" | "topPods" | "topProcesses" | "memoryUsedMb" | "memoryDetail">,
  mode: MemoryFlameMode = "retained",
): ProfileStackFrame[] {
  let pods = [...detail.topPods].sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0));
  const processes = detail.topProcesses;

  // Fallbacks so Heap is never blank when the agent has node RSS or process samples.
  if (pods.length === 0 && processes.length > 0) {
    pods = processes
      .filter((proc) => (proc.rssMb ?? 0) > 0)
      .sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0))
      .slice(0, 12)
      .map((proc) => ({
        namespace: proc.namespace || "node",
        pod: proc.pod || proc.name,
        rssMb: proc.rssMb,
        cpuPercent: proc.cpuPercent,
      }));
  }
  if (pods.length === 0 && (detail.memoryUsedMb ?? 0) > 0) {
    pods = [
      {
        namespace: "node",
        pod: detail.name,
        rssMb: detail.memoryUsedMb,
      },
    ];
  }
  if (pods.length === 0) {
    return [];
  }

  const podWeight = (pod: PodConsumer): number => {
    if (mode === "count") {
      return Math.max(1, processesForPod(processes, pod).length);
    }
    // Retained and allocated both use RSS until alloc sampling exists.
    return Math.max(0, pod.rssMb ?? 0);
  };

  const weights = pods.map(podWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const fallbackTotal = Math.max(detail.memoryUsedMb ?? 0, 1);
  const rootTotal = totalWeight > 0 ? totalWeight : fallbackTotal;

  const frames: ProfileStackFrame[] = [
    {
      id: "mem-root",
      label: "all",
      subtitle: modeLabel(mode),
      depth: 0,
      width: 1,
      offset: 0,
      heat: 0.35,
      kind: "root",
      sharePct: 100,
      bytes: Math.round(rootTotal * 1024 * 1024),
      path: "all",
    },
  ];

  let offset = 0;
  pods.forEach((pod, index) => {
    const weight = weights[index] ?? 0;
    if (weight <= 0 && totalWeight > 0) {
      return;
    }
    const width = totalWeight > 0 ? weight / rootTotal : 1 / pods.length;
    const podRssBytes = Math.round((pod.rssMb ?? 0) * 1024 * 1024);
    const sharePct = Math.round(width * 1000) / 10;
    const podId = `mem-pod-${pod.namespace}/${pod.pod}`;
    frames.push({
      id: podId,
      label: `pod: ${pod.pod}`,
      subtitle: pod.namespace,
      depth: 1,
      width,
      offset,
      heat: Math.min(1, width * 1.4),
      kind: "workload",
      namespace: pod.namespace,
      sharePct,
      bytes: podRssBytes,
      path: `all › ${pod.namespace}/${pod.pod}`,
    });

    const procs = processesForPod(processes, pod);
    const procTotal =
      mode === "count"
        ? Math.max(1, procs.length)
        : procs.reduce((sum, proc) => sum + Math.max(0, proc.rssMb ?? 0), 0);

    if (procs.length === 0) {
      // Leaf placeholder when we only have pod cgroup RSS.
      frames.push({
        id: `${podId}-rss`,
        label: mode === "count" ? "consumers (unknown)" : "rss (cgroup)",
        subtitle: "No process samples attributed",
        depth: 2,
        width,
        offset,
        heat: Math.min(1, width * 1.2),
        kind: "hop",
        namespace: pod.namespace,
        sharePct,
        bytes: podRssBytes,
        path: `all › ${pod.namespace}/${pod.pod} › rss`,
      });
      offset += width;
      return;
    }

    let procOffset = offset;
    procs.forEach((proc) => {
      const procWeight =
        mode === "count" ? 1 : Math.max(0, proc.rssMb ?? 0);
      const procShare = procTotal > 0 ? procWeight / procTotal : 1 / procs.length;
      const procWidth = width * procShare;
      const procBytes = Math.round((proc.rssMb ?? 0) * 1024 * 1024);
      frames.push({
        id: `mem-proc-${proc.pid}`,
        label: `process: ${proc.name}`,
        subtitle: `pid ${proc.pid}`,
        depth: 2,
        width: procWidth,
        offset: procOffset,
        heat: Math.min(1, procShare * width * 1.5),
        kind: "hop",
        namespace: pod.namespace,
        sharePct: Math.round(procShare * sharePct * 10) / 10,
        bytes: procBytes,
        samples: mode === "count" ? 1 : undefined,
        path: `all › ${pod.namespace}/${pod.pod} › ${proc.name}`,
      });
      procOffset += procWidth;
    });

    offset += width;
  });

  return frames;
}

export function memoryTimelineEvents(detail: NodeProfileDetail): NodeProfileDetail["timeline"] {
  return detail.timeline.filter((event) => {
    const hay = `${event.title} ${event.detail ?? ""}`.toLowerCase();
    return (
      hay.includes("oom") ||
      hay.includes("memory") ||
      hay.includes("reclaim") ||
      hay.includes("swap") ||
      hay.includes("psi") ||
      hay.includes("fault") ||
      hay.includes("kswapd")
    );
  });
}

function processesForPod(processes: ProcessSample[], pod: PodConsumer): ProcessSample[] {
  return processes
    .filter((proc) => proc.namespace === pod.namespace && proc.pod === pod.pod)
    .sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0));
}

function modeLabel(mode: MemoryFlameMode): string {
  if (mode === "count") {
    return "Width = allocation / consumer count";
  }
  if (mode === "allocated") {
    return "Width = allocated bytes (RSS proxy until alloc sampling)";
  }
  return "Width = retained RSS bytes";
}
