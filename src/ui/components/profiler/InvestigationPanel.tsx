import type { NodeProfileDetail, PodConsumer, ProcessSample } from "../../../core/types/profiling";

export type InvestigationTarget =
  | { kind: "kernel"; function: string; share?: number; meaning?: string }
  | { kind: "pod"; namespace: string; pod: string; cpuPercent?: number; rssMb?: number }
  | { kind: "process"; pid: number; name: string; pod?: string; namespace?: string }
  | { kind: "stack"; label: string; heat?: number };

interface InvestigationPanelProps {
  detail: NodeProfileDetail;
  target: InvestigationTarget | null;
  onClear: () => void;
}

function findRelatedPod(
  detail: NodeProfileDetail,
  target: InvestigationTarget,
): PodConsumer | undefined {
  if (target.kind === "pod") {
    return detail.topPods.find((pod) => pod.namespace === target.namespace && pod.pod === target.pod);
  }
  if (target.kind === "process" && target.pod) {
    return detail.topPods.find((pod) => pod.namespace === target.namespace && pod.pod === target.pod);
  }
  return detail.topPods[0];
}

function findRelatedProcess(
  detail: NodeProfileDetail,
  target: InvestigationTarget,
): ProcessSample | undefined {
  if (target.kind === "process") {
    return detail.topProcesses.find((proc) => proc.pid === target.pid);
  }
  if (target.kind === "pod") {
    return detail.topProcesses.find(
      (proc) => proc.namespace === target.namespace && proc.pod === target.pod,
    );
  }
  return detail.topProcesses[0];
}

function stackNeighbors(detail: NodeProfileDetail, label: string): { parent?: string; child?: string } {
  const labels = detail.cpuStack.map((frame) => frame.label);
  const index = labels.indexOf(label);
  if (index < 0) {
    return {};
  }
  return {
    parent: index > 0 ? labels[index - 1] : undefined,
    child: index < labels.length - 1 ? labels[index + 1] : undefined,
  };
}

function causesFor(target: InvestigationTarget, detail: NodeProfileDetail): string[] {
  if (target.kind === "kernel") {
    const hotspot = detail.kernelHotspots.find((item) => item.function === target.function);
    if (hotspot?.meaning) {
      return [hotspot.meaning];
    }
    if (target.function.includes("tcp") || target.function.includes("sendmsg")) {
      return ["High outbound network traffic", "Frequent small writes", "Socket buffer contention"];
    }
    if (target.function.includes("epoll") || target.function.includes("schedule")) {
      return ["Runnable thread pressure", "Event loop saturation", "Scheduler latency"];
    }
    return ["Kernel path inferred from live process and network context"];
  }
  if (target.kind === "pod" || target.kind === "process") {
    return ["Top consumer on this node in the current sample window"];
  }
  return ["Inferred stack frame — eBPF sampling will replace this in a future release"];
}

function titleFor(target: InvestigationTarget): string {
  switch (target.kind) {
    case "kernel":
      return target.function;
    case "pod":
      return `${target.namespace}/${target.pod}`;
    case "process":
      return target.pod ? `${target.namespace}/${target.pod}` : target.name;
    case "stack":
      return target.label;
  }
}

export function InvestigationPanel({ detail, target, onClear }: InvestigationPanelProps) {
  if (!target) {
    return (
      <aside className="profile-investigation panel">
        <div className="panel-header">Investigation</div>
        <div className="profile-investigation-empty">
          <p>Select a kernel function, pod, or stack frame to inspect likely causes and related consumers.</p>
          <p className="profile-investigation-note">CPU stacks and kernel functions are inferred until eBPF perf sampling lands.</p>
        </div>
      </aside>
    );
  }

  const pod = findRelatedPod(detail, target);
  const process = findRelatedProcess(detail, target);
  const neighbors = target.kind === "stack" ? stackNeighbors(detail, target.label) : {};
  const causes = causesFor(target, detail);

  return (
    <aside className="profile-investigation panel">
      <div className="profile-investigation-head">
        <div className="panel-header">Investigation</div>
        <button type="button" className="profile-investigation-clear" onClick={onClear}>
          Clear
        </button>
      </div>

      <div className="profile-investigation-body">
        <div className="profile-investigation-selected">
          <span className="profile-investigation-kicker">Selected</span>
          <strong>{titleFor(target)}</strong>
          {target.kind === "kernel" && target.share !== undefined ? (
            <span className="profile-investigation-meta">CPU share ~{(target.share * 100).toFixed(1)}% (inferred)</span>
          ) : null}
        </div>

        {pod ? (
          <div className="profile-investigation-block">
            <span className="profile-panel-label">Top pod</span>
            <div className="profile-kv">
              <span>{pod.namespace}/{pod.pod}</span>
              <span>{pod.cpuPercent !== undefined ? `${pod.cpuPercent.toFixed(1)}% CPU` : "—"}</span>
            </div>
          </div>
        ) : null}

        {process ? (
          <div className="profile-investigation-block">
            <span className="profile-panel-label">Top process</span>
            <div className="profile-kv">
              <span>{process.name}</span>
              <span>PID {process.pid}</span>
            </div>
          </div>
        ) : null}

        {neighbors.parent || neighbors.child ? (
          <div className="profile-investigation-block">
            <span className="profile-panel-label">Stack context</span>
            {neighbors.parent ? <div className="profile-kv"><span>Parent</span><span>{neighbors.parent}</span></div> : null}
            {neighbors.child ? <div className="profile-kv"><span>Child</span><span>{neighbors.child}</span></div> : null}
          </div>
        ) : null}

        <div className="profile-investigation-block">
          <span className="profile-panel-label">Possible causes</span>
          <ul className="profile-investigation-causes">
            {causes.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
