import type { NodeProfileDetail, PodConsumer, ProcessSample } from "../../../core/types/profiling";
import { friendlyRuntimeName, type InvestigationTarget } from "./InvestigationPanel";

interface InsightCardsProps {
  detail: NodeProfileDetail;
  onSelect: (target: InvestigationTarget) => void;
}

function psiLabel(level: string): string {
  if (level === "critical") {
    return "Critical";
  }
  if (level === "warn") {
    return "High";
  }
  return "Low";
}

function isRealK8sWorkload(pod: PodConsumer): boolean {
  // resolveMemoryConsumers may synthesize namespace "node" for host processes — not a workload.
  return Boolean(pod.namespace && pod.pod && pod.namespace !== "node");
}

function pickTopWorkload(detail: NodeProfileDetail): PodConsumer | undefined {
  const fromPods = [...(detail.topPods ?? [])]
    .filter(isRealK8sWorkload)
    .sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0));
  if (fromPods[0] && (fromPods[0].cpuPercent ?? 0) > 0) {
    return fromPods[0];
  }

  // Synthesize from processes that already carry Kubernetes ownership.
  const byPod = new Map<string, PodConsumer>();
  for (const proc of detail.topProcesses ?? []) {
    if (!proc.namespace || !proc.pod || proc.namespace === "node") {
      continue;
    }
    const key = `${proc.namespace}/${proc.pod}`;
    const current = byPod.get(key) ?? {
      namespace: proc.namespace,
      pod: proc.pod,
      cpuPercent: 0,
      rssMb: 0,
    };
    current.cpuPercent = (current.cpuPercent ?? 0) + (proc.cpuPercent ?? 0);
    current.rssMb = (current.rssMb ?? 0) + (proc.rssMb ?? 0);
    byPod.set(key, current);
  }
  const fromProcs = [...byPod.values()].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))[0];
  if (fromProcs && (fromProcs.cpuPercent ?? 0) > 0) {
    return fromProcs;
  }

  // Prefer CPU when present; otherwise fall back to memory-ranked real workloads.
  // if (fromPods[0]) {
  //   return fromPods[0];
  // }
  // Last resort: memory-ranked pod (may lack CPU — card must not pretend 0.0% is a reading).
  return fromPods[0] ?? fromProcs;
}

function pickTopProcess(detail: NodeProfileDetail): ProcessSample | undefined {
  return [...(detail.topProcesses ?? [])].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))[0];
}

export function InsightCards({ detail, onSelect }: InsightCardsProps) {
  // const topPod = detail.topPods[0];
  const topWorkload = pickTopWorkload(detail);
  const topHotspot = detail.kernelHotspots[0];
  const topProcess = pickTopProcess(detail);
  const inferredStacks = detail.stackSource !== "proc" && detail.stackSource !== "ebpf";
  const shareSuffix = inferredStacks ? " inferred" : detail.stackSource === "proc" ? " sampled" : " eBPF";
  const processLabel = topProcess ? friendlyRuntimeName(topProcess.name) : "—";

  return (
    <div className="profile-insights">
      <button
        type="button"
        className="profile-insight-card"
        onClick={() => {
          if (topWorkload) {
            onSelect({
              kind: "pod",
              namespace: topWorkload.namespace,
              pod: topWorkload.pod,
              cpuPercent: topWorkload.cpuPercent,
              rssMb: topWorkload.rssMb,
            });
          }
        }}
      >
        {/* <span className="profile-insight-label">Top CPU consumer</span> */}
        <span className="profile-insight-label">Top workload</span>
        <strong>
          {topWorkload ? `${topWorkload.namespace}/${topWorkload.pod}` : "—"}
        </strong>
        <span className="profile-insight-value">
          {topWorkload?.cpuPercent !== undefined && topWorkload.cpuPercent > 0
            ? `${topWorkload.cpuPercent.toFixed(1)}%`
            : topWorkload?.rssMb !== undefined && topWorkload.rssMb > 0
              ? `${Math.round(topWorkload.rssMb)} MB RSS`
              : topWorkload
                ? "CPU unavailable"
                : "No pod attribution yet"}
        </span>
      </button>

      <button
        type="button"
        className="profile-insight-card"
        onClick={() => {
          if (topProcess) {
            onSelect({
              kind: "process",
              pid: topProcess.pid,
              name: topProcess.name,
              namespace: topProcess.namespace,
              pod: topProcess.pod,
            });
          }
        }}
      >
        <span className="profile-insight-label">Top process</span>
        <strong>{processLabel}</strong>
        <span className="profile-insight-value">
          {topProcess
            ? [
                topProcess.cpuPercent !== undefined ? `${topProcess.cpuPercent.toFixed(1)}%` : null,
                `PID ${topProcess.pid}`,
                topProcess.namespace && topProcess.pod
                  ? `${topProcess.namespace}/${topProcess.pod}`
                  : topProcess.name !== processLabel
                    ? topProcess.name
                    : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "—"}
        </span>
      </button>

      <button
        type="button"
        className="profile-insight-card"
        onClick={() => {
          if (topHotspot) {
            onSelect({
              kind: "kernel",
              function: topHotspot.function,
              share: topHotspot.share,
              meaning: topHotspot.meaning,
            });
          }
        }}
      >
        {/* <span className="profile-insight-label">Hottest kernel function</span> */}
        <span className="profile-insight-label">Top kernel function</span>
        <strong>{topHotspot?.function ?? "—"}</strong>
        <span className={`profile-insight-value${inferredStacks ? " inferred" : ""}`}>
          {topHotspot ? `${((topHotspot.share ?? 0) * 100).toFixed(0)}%${shareSuffix}` : "—"}
        </span>
      </button>


      <div className="profile-insight-card profile-insight-card-static">
        <span className="profile-insight-label">Memory pressure</span>
        <strong>{psiLabel(detail.psi?.memoryLevel ?? "normal")}</strong>
        <span className="profile-insight-value">
          {detail.psi?.memoryAvg10 !== undefined ? `PSI ${detail.psi.memoryAvg10.toFixed(1)}` : "PSI —"}
        </span>
      </div>
    </div>
  );
}
