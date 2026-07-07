import type { NodeProfileDetail } from "../../../core/types/profiling";
import type { InvestigationTarget } from "./InvestigationPanel";

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

export function InsightCards({ detail, onSelect }: InsightCardsProps) {
  const topPod = detail.topPods[0];
  const topHotspot = detail.kernelHotspots[0];
  const topProcess = detail.topProcesses[0];
  const hotSyscall = detail.cpuStack
    .filter((frame) => frame.depth >= 3)
    .sort((a, b) => b.heat - a.heat)[0];
  const inferredStacks = detail.stackSource !== "proc" && detail.stackSource !== "ebpf";
  const shareSuffix = inferredStacks ? " inferred" : detail.stackSource === "proc" ? " sampled" : " eBPF";

  return (
    <div className="profile-insights">
      <button
        type="button"
        className="profile-insight-card"
        onClick={() => {
          if (topPod) {
            onSelect({
              kind: "pod",
              namespace: topPod.namespace,
              pod: topPod.pod,
              cpuPercent: topPod.cpuPercent,
              rssMb: topPod.rssMb,
            });
          } else if (topProcess) {
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
        <span className="profile-insight-label">Top CPU consumer</span>
        <strong>{topPod ? `${topPod.namespace}/${topPod.pod}` : topProcess?.name ?? "—"}</strong>
        <span className="profile-insight-value">
          {topPod?.cpuPercent !== undefined
            ? `${topPod.cpuPercent.toFixed(1)}%`
            : topProcess?.cpuPercent !== undefined
              ? `${topProcess.cpuPercent.toFixed(1)}%`
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
        <span className="profile-insight-label">Hottest kernel function</span>
        <strong>{topHotspot?.function ?? "—"}</strong>
        <span className={`profile-insight-value${inferredStacks ? " inferred" : ""}`}>
          {topHotspot ? `${(topHotspot.share * 100).toFixed(0)}%${shareSuffix}` : "—"}
        </span>
      </button>

      <button
        type="button"
        className="profile-insight-card"
        onClick={() => {
          if (hotSyscall) {
            onSelect({ kind: "stack", label: hotSyscall.label, heat: hotSyscall.heat });
          }
        }}
      >
        <span className="profile-insight-label">Hottest syscall path</span>
        <strong>{hotSyscall?.label ?? "—"}</strong>
        <span className={`profile-insight-value${inferredStacks ? " inferred" : ""}`}>
          {hotSyscall ? `${(hotSyscall.heat * 100).toFixed(0)}%${shareSuffix}` : "—"}
        </span>
      </button>

      <div className="profile-insight-card profile-insight-card-static">
        <span className="profile-insight-label">Memory pressure</span>
        <strong>{psiLabel(detail.psi.memoryLevel)}</strong>
        <span className="profile-insight-value">
          {detail.psi.memoryAvg10 !== undefined ? `PSI ${detail.psi.memoryAvg10.toFixed(1)}` : "PSI —"}
        </span>
      </div>
    </div>
  );
}
