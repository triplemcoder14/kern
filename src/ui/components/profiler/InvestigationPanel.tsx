import { useMemo, useState } from "react";
import type {
  NodeProfileDetail,
  ProcessSample,
  ProfileStackFrame,
  ProfileStackFrameKind,
  ProfileStackSource,
} from "../../../core/types/profiling";
import {
  buildInvestigationWorkflow,
  explainStackFrame,
  type InvestigationNextStep,
} from "./investigation-workflow";

function stackSourceNote(source?: ProfileStackSource): string {
  if (source === "proc") {
    return "Kernel stacks are sampled from /proc/PID/stack when process attribution is available.";
  }
  if (source === "ebpf") {
    return "Kernel stacks are sampled with eBPF perf events.";
  }
  return "CPU stacks and kernel functions are inferred until eBPF perf sampling lands.";
}
void stackSourceNote;

function stackShareLabel(source?: ProfileStackSource): string {
  if (source === "proc") {
    return "sampled";
  }
  if (source === "ebpf") {
    return "eBPF";
  }
  return "inferred";
}

/** Normalize executable names so "node" is not read as a Kubernetes node. */
export function friendlyRuntimeName(name: string): string {
  const base = name.trim().split(/[\s/]/)[0] ?? name;
  if (/^node(\d*)$/i.test(base) || /^nodejs$/i.test(base)) {
    return "Node.js";
  }
  if (/^python\d*/i.test(base)) {
    return "Python";
  }
  if (/^java$/i.test(base) || /^openjdk/i.test(base)) {
    return "Java";
  }
  if (/^(ruby|mri)$/i.test(base)) {
    return "Ruby";
  }
  if (/^(go|golang)$/i.test(base)) {
    return "Go";
  }
  if (/^rustc$/i.test(base) || /^cargo$/i.test(base)) {
    return "Rust";
  }
  if (/^dotnet$/i.test(base) || /^mono$/i.test(base)) {
    return ".NET";
  }
  return name;
}

export type FrameClassification =
  | "Application"
  | "Runtime"
  | "Library"
  | "Kernel"
  | "Workload"
  | "Process"
  | "Root"
  | "Frame";

export type InvestigationTarget =
  | {
      kind: "kernel";
      function: string;
      share?: number;
      meaning?: string;
      frameKind?: ProfileStackFrameKind;
      namespace?: string;
      pod?: string;
      processName?: string;
      pid?: number;
      parentLabel?: string;
      childLabel?: string;
    }
  | {
      kind: "pod";
      namespace: string;
      pod: string;
      cpuPercent?: number;
      rssMb?: number;
    }
  | {
      kind: "process";
      pid: number;
      name: string;
      pod?: string;
      namespace?: string;
    }
  | {
      kind: "stack";
      label: string;
      heat?: number;
      depth?: number;
      namespace?: string;
      path?: string;
      subtitle?: string;
      sharePct?: number;
      samples?: number;
      frameKind?: ProfileStackFrameKind;
      binary?: string;
      classification?: FrameClassification;
      pod?: string;
      container?: string;
      processName?: string;
      pid?: number;
      threadId?: string;
      parentLabel?: string;
      childLabel?: string;
      ownerKnown?: boolean;
    };

interface InvestigationPanelProps {
  detail: NodeProfileDetail;
  target: InvestigationTarget | null;
  onClear: () => void;
  clusterName?: string;
  onNavigate?: (target: "memory" | "network" | "events" | "profiling") => void;
  onCommand?: (step: InvestigationNextStep) => void;
}

function isNumericSubtitle(value?: string): boolean {
  return Boolean(value && /^\d+$/.test(value.trim()));
}

/** Symbol offsets like +0x82970 — never Kubernetes ownership. */
function isSymbolOffset(value?: string): boolean {
  return Boolean(value && /^\+?0x[0-9a-f]+$/i.test(value.trim()));
}

function looksLikeK8sName(value?: string): boolean {
  if (!value || isSymbolOffset(value) || isNumericSubtitle(value)) {
    return false;
  }
  // Reject flame geometry / path separators used for kernel chains.
  if (value.includes(" → ") || value.startsWith("0x")) {
    return false;
  }
  return /^[a-z0-9]([a-z0-9.[\]_-]{0,251}[a-z0-9])?$/i.test(value);
}

function ancestorFrames(frames: ProfileStackFrame[], selected: ProfileStackFrame): ProfileStackFrame[] {
  return frames
    .filter(
      (frame) =>
        frame.depth < selected.depth &&
        selected.offset >= frame.offset - 0.0001 &&
        selected.offset + selected.width <= frame.offset + frame.width + 0.0001,
    )
    .sort((a, b) => a.depth - b.depth);
}

function hottestChild(frames: ProfileStackFrame[], selected: ProfileStackFrame): ProfileStackFrame | undefined {
  return frames
    .filter(
      (frame) =>
        frame.depth === selected.depth + 1 &&
        frame.offset >= selected.offset - 0.0001 &&
        frame.offset + frame.width <= selected.offset + selected.width + 0.0001,
    )
    .sort((a, b) => (b.sharePct ?? b.heat) - (a.sharePct ?? a.heat))[0];
}

function classifyFrame(frame: ProfileStackFrame): FrameClassification {
  if (frame.kind === "app") {
    return "Application";
  }
  if (frame.kind === "runtime") {
    return "Runtime";
  }
  if (frame.kind === "library" || frame.kind === "user") {
    return "Library";
  }
  if (frame.kind === "kernel") {
    return "Kernel";
  }
  if (frame.kind === "root") {
    return "Root";
  }
  if (frame.kind === "workload" || frame.kind === "service") {
    return "Workload";
  }
  if (frame.depth === 1) {
    return "Workload";
  }
  if (frame.depth === 2 && isNumericSubtitle(frame.subtitle)) {
    return "Process";
  }
  return "Frame";
}

function resolveOwnerFromAncestors(
  frame: ProfileStackFrame,
  ancestors: ProfileStackFrame[],
): {
  namespace?: string;
  pod?: string;
  processName?: string;
  pid?: number;
  threadId?: string;
} {
  let namespace = looksLikeK8sName(frame.namespace) ? frame.namespace : undefined;
  let pod: string | undefined;
  let processName: string | undefined;
  let pid: number | undefined;
  let threadId: string | undefined;

  // Only treat path as ns/pod when it looks like Kubernetes ownership, not kernel chains.
  if (frame.path?.includes("/") && !frame.path.includes(" → ")) {
    const [ns, ...rest] = frame.path.split("/");
    if (looksLikeK8sName(ns) && rest.length > 0 && looksLikeK8sName(rest.join("/"))) {
      namespace = namespace ?? ns;
      pod = rest.join("/");
    }
  }

  for (const ancestor of ancestors) {
    if (looksLikeK8sName(ancestor.namespace)) {
      namespace = namespace ?? ancestor.namespace;
    }
    // Classic flame: depth 1 = pod lane (subtitle may be k8s namespace).
    // Merged eBPF: depth 1 is often a binary/symbol with subtitle "+0x…" — ignore that.
    if (
      ancestor.depth === 1 &&
      ancestor.kind !== "kernel" &&
      ancestor.kind !== "root" &&
      !isSymbolOffset(ancestor.subtitle) &&
      (looksLikeK8sName(ancestor.namespace) || looksLikeK8sName(ancestor.subtitle))
    ) {
      pod = pod ?? ancestor.label;
      namespace =
        namespace ??
        (looksLikeK8sName(ancestor.namespace) ? ancestor.namespace : undefined) ??
        (looksLikeK8sName(ancestor.subtitle) ? ancestor.subtitle : undefined);
    }
    if (ancestor.depth === 2 && isNumericSubtitle(ancestor.subtitle)) {
      processName = processName ?? ancestor.label;
      pid = pid ?? Number(ancestor.subtitle);
    }
  }

  if (
    frame.depth === 1 &&
    frame.kind !== "kernel" &&
    !isSymbolOffset(frame.subtitle) &&
    (looksLikeK8sName(frame.namespace) || looksLikeK8sName(frame.subtitle))
  ) {
    pod = pod ?? frame.label;
    namespace =
      namespace ??
      (looksLikeK8sName(frame.namespace) ? frame.namespace : undefined) ??
      (looksLikeK8sName(frame.subtitle) ? frame.subtitle : undefined);
  }
  if (frame.depth === 2 && isNumericSubtitle(frame.subtitle)) {
    processName = processName ?? frame.label;
    pid = pid ?? Number(frame.subtitle);
  }
  if (isNumericSubtitle(frame.subtitle) && frame.depth > 2) {
    threadId = frame.subtitle;
  }

  return { namespace, pod, processName, pid, threadId };
}

/**
 * Build a stack investigation target that only describes the selected frame.
 * Never falls back to node-wide hottest pod/process.
 */
export function buildStackInvestigationTarget(
  frame: ProfileStackFrame,
  allFrames: ProfileStackFrame[],
  processes?: ProcessSample[],
): Extract<InvestigationTarget, { kind: "stack" }> {
  const ancestors = ancestorFrames(allFrames, frame);
  const child = hottestChild(allFrames, frame);
  const parent = ancestors[ancestors.length - 1];
  let owner = resolveOwnerFromAncestors(frame, ancestors);

  const matched = matchProcessForFrame(frame, processes);
  if (matched) {
    owner = {
      ...owner,
      processName: owner.processName ?? matched.name,
      pid: owner.pid ?? matched.pid,
      namespace: owner.namespace ?? (looksLikeK8sName(matched.namespace) ? matched.namespace : undefined),
      pod: owner.pod ?? (looksLikeK8sName(matched.pod) ? matched.pod : undefined),
    };
  }

  const ownerKnown = Boolean(owner.namespace || owner.pod || owner.processName || owner.pid);
  const namespace = looksLikeK8sName(owner.namespace)
    ? owner.namespace
    : looksLikeK8sName(frame.namespace)
      ? frame.namespace
      : undefined;

  return {
    kind: "stack",
    label: frame.label,
    heat: frame.heat,
    depth: frame.depth,
    // namespace: owner.namespace ?? frame.namespace,
    namespace,
    path: frame.path,
    subtitle: frame.subtitle,
    sharePct: frame.sharePct,
    samples: frame.samples,
    frameKind: frame.kind,
    binary: frame.binary,
    classification: classifyFrame(frame),
    pod: owner.pod,
    container: owner.pod ? owner.processName ?? owner.pod : undefined,
    processName: owner.processName,
    pid: owner.pid,
    threadId: owner.threadId,
    parentLabel: parent && parent.label !== frame.label ? parent.label : undefined,
    childLabel: child && child.label !== frame.label ? child.label : undefined,
    ownerKnown,
  };
}

/** Prefer exact process/comm matches — never attribute via loose binary path contains. */
function looksLikeProcessComm(label: string): boolean {
  if (!label || isSymbolOffset(label) || isNumericSubtitle(label)) {
    return false;
  }
  if (label.includes("::") || label.includes("(") || label.includes(" ")) {
    return false;
  }
  if (/^(schedule|__schedule|futex|epoll|sys_|do_|el0|invoke_|entry_|tcp_|udp_|sock_)/i.test(label)) {
    return false;
  }
  // Keep '-' literal at end of class so names like kern-agent match.
  return /^[A-Za-z0-9_./+-]{1,64}$/.test(label);
}

function binaryBasename(binary?: string): string | undefined {
  if (!binary) {
    return undefined;
  }
  const parts = binary.split("/");
  return parts[parts.length - 1] || undefined;
}

function processMatchesLabel(proc: ProcessSample, label: string): boolean {
  return proc.name.toLowerCase() === label.toLowerCase();
}

function matchProcessForFrame(
  frame: ProfileStackFrame,
  processes?: ProcessSample[],
): ProcessSample | undefined {
  if (!processes?.length) {
    return undefined;
  }

  if (isNumericSubtitle(frame.subtitle)) {
    const byPid = processes.find((proc) => proc.pid === Number(frame.subtitle));
    if (byPid) {
      return byPid;
    }
  }

  const label = frame.label;
  const base = binaryBasename(frame.binary);
  const candidates = processes.filter((proc) => {
    if (looksLikeProcessComm(label) && processMatchesLabel(proc, label)) {
      return true;
    }
    if (base && processMatchesLabel(proc, base)) {
      return true;
    }
    return false;
  });
  if (candidates.length === 0) {
    return undefined;
  }
  // Prefer a sample that already has Kubernetes ownership.
  return (
    candidates.find((proc) => looksLikeK8sName(proc.namespace) && looksLikeK8sName(proc.pod)) ??
    [...candidates].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))[0]
  );
}

/**
 * Match workload by the selected frame/comm name (e.g. kern-agent → kern/kern-agent-*).
 * This is name-scoped to the frame — not "hottest pod on the node".
 */
function matchWorkloadForLabel(
  label: string,
  detail: NodeProfileDetail,
): { namespace: string; pod: string; container?: string } | undefined {
  if (!looksLikeProcessComm(label)) {
    return undefined;
  }
  const needle = label.toLowerCase();

  const containerHit = detail.topContainers?.find((item) => {
    if (item.namespace === "node") {
      return false;
    }
    const container = item.container.toLowerCase();
    const pod = item.pod.toLowerCase();
    return (
      container === needle ||
      pod === needle ||
      pod.startsWith(`${needle}-`) ||
      container.startsWith(`${needle}-`)
    );
  });
  if (containerHit) {
    return {
      namespace: containerHit.namespace,
      pod: containerHit.pod,
      container: containerHit.container,
    };
  }

  const podHits = detail.topPods
    .filter((item) => item.namespace !== "node")
    .filter((item) => {
      const pod = item.pod.toLowerCase();
      return pod === needle || pod.startsWith(`${needle}-`);
    })
    .sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0));

  if (podHits[0]) {
    return {
      namespace: podHits[0].namespace,
      pod: podHits[0].pod,
      container: label,
    };
  }

  return undefined;
}

/**
 * Fill Frame Owner from live node detail for the selected frame only.
 * Still never uses node-wide hottest pod/process.
 */
function enrichOwnerFromDetail(
  target: InvestigationTarget,
  detail: NodeProfileDetail,
): {
  namespace?: string;
  pod?: string;
  container?: string;
  processName?: string;
  pid?: number;
  threadId?: string;
} {
  if (target.kind === "pod") {
    return {
      namespace: target.namespace,
      pod: target.pod,
      container: target.pod,
    };
  }

  if (target.kind === "process") {
    const proc =
      detail.topProcesses.find((item) => item.pid === target.pid) ??
      detail.topProcesses.find(
        (item) =>
          item.name === target.name &&
          looksLikeK8sName(item.namespace) &&
          looksLikeK8sName(item.pod),
      );
    const namespace = looksLikeK8sName(proc?.namespace)
      ? proc?.namespace
      : looksLikeK8sName(target.namespace)
        ? target.namespace
        : undefined;
    const pod = looksLikeK8sName(proc?.pod)
      ? proc?.pod
      : looksLikeK8sName(target.pod)
        ? target.pod
        : undefined;
    const workload =
      !namespace || !pod
        ? matchWorkloadForLabel(proc?.name ?? target.name, detail)
        : undefined;
    const container =
      detail.topContainers?.find((item) => item.namespace === (namespace ?? workload?.namespace) && item.pod === (pod ?? workload?.pod))
        ?.container ??
      workload?.container ??
      (pod || workload?.pod ? proc?.name ?? target.name : undefined);
    return {
      namespace: namespace ?? workload?.namespace,
      pod: pod ?? workload?.pod,
      container,
      processName: proc?.name ?? target.name,
      pid: proc?.pid ?? target.pid,
    };
  }

  if (target.kind === "kernel") {
    return {
      namespace: looksLikeK8sName(target.namespace) ? target.namespace : undefined,
      pod: looksLikeK8sName(target.pod) ? target.pod : undefined,
      processName: target.processName,
      pid: target.pid,
    };
  }

  // stack
  let namespace = looksLikeK8sName(target.namespace) ? target.namespace : undefined;
  let pod = looksLikeK8sName(target.pod) ? target.pod : undefined;
  let processName = target.processName;
  let pid = target.pid;
  const threadId = target.threadId;
  let container = target.container;

  const byPid =
    pid !== undefined ? detail.topProcesses.find((item) => item.pid === pid) : undefined;
  const label = target.label;
  const base = binaryBasename(target.binary);
  const byName = detail.topProcesses.filter((item) => {
    if (processName && processMatchesLabel(item, processName)) {
      return true;
    }
    if (looksLikeProcessComm(label) && processMatchesLabel(item, label)) {
      return true;
    }
    if (base && processMatchesLabel(item, base)) {
      return true;
    }
    return false;
  });
  const proc =
    byPid ??
    byName.find((item) => looksLikeK8sName(item.namespace) && looksLikeK8sName(item.pod)) ??
    byName[0];

  if (proc) {
    processName = proc.name;
    pid = proc.pid;
    if (looksLikeK8sName(proc.namespace)) {
      namespace = proc.namespace;
    }
    if (looksLikeK8sName(proc.pod)) {
      pod = proc.pod;
    }
  } else if (!processName && looksLikeProcessComm(label)) {
    // Frame label is the process/comm (common in eBPF when symbols collapse to the binary).
    processName = label;
  }

  if (!namespace || !pod) {
    const workload = matchWorkloadForLabel(processName ?? label, detail);
    if (workload) {
      namespace = namespace ?? workload.namespace;
      pod = pod ?? workload.pod;
      container = container ?? workload.container;
    }
  }

  if ((!namespace || !pod) && processName) {
    const podHit = detail.topPods.find((item) =>
      detail.topProcesses.some(
        (procItem) =>
          processMatchesLabel(procItem, processName!) &&
          procItem.namespace === item.namespace &&
          procItem.pod === item.pod,
      ),
    );
    if (podHit) {
      namespace = namespace ?? podHit.namespace;
      pod = pod ?? podHit.pod;
    }
  }

  container =
    detail.topContainers?.find((item) => item.namespace === namespace && item.pod === pod)
      ?.container ??
    container ??
    (pod && processName ? processName : undefined);

  return { namespace, pod, container, processName, pid, threadId };
}

// function findRelatedPod(detail, target) {
//   ...
//   return detail.topPods[0];
// }
// function findRelatedProcess(detail, target) {
//   ...
//   return detail.topProcesses[0];
// }

function titleFor(target: InvestigationTarget): string {
  switch (target.kind) {
    case "kernel":
      return target.function;
    case "pod":
      return `${target.namespace}/${target.pod}`;
    case "process":
      return target.pod ? `${target.namespace}/${target.pod}` : friendlyRuntimeName(target.name);
    case "stack":
      return target.label;
  }
}

function selectedKicker(target: InvestigationTarget): string {
  if (target.kind === "stack") {
    return "Selected Frame";
  }
  if (target.kind === "kernel") {
    return "Selected Frame";
  }
  if (target.kind === "pod") {
    return "Selected Workload";
  }
  return "Selected Process";
}

function classificationFor(target: InvestigationTarget): FrameClassification {
  if (target.kind === "stack") {
    return target.classification ?? "Frame";
  }
  if (target.kind === "kernel") {
    return "Kernel";
  }
  if (target.kind === "pod") {
    return "Workload";
  }
  return "Process";
}

function interpretationFor(target: InvestigationTarget, detail: NodeProfileDetail): string[] {
  if (target.kind === "stack") {
    const fakeFrame: ProfileStackFrame = {
      label: target.label,
      depth: target.depth ?? 0,
      width: 0,
      offset: 0,
      heat: target.heat ?? 0,
      kind: target.frameKind,
      sharePct: target.sharePct,
      samples: target.samples,
      binary: target.binary,
      namespace: target.namespace,
    };
    const explained = explainStackFrame(fakeFrame);
    const lines = [explained.what];
    if (target.ownerKnown && target.processName) {
      lines.push(
        `This sample is attributed to ${friendlyRuntimeName(target.processName)}${
          target.pod ? ` in ${target.namespace ?? "?"}/${target.pod}` : ""
        }.`,
      );
      if (!target.pod) {
        lines.push(
          "Kubernetes pod ownership was not resolved for this PID in the current sample (process is known; namespace/pod are not).",
        );
      }
    } else if (!target.ownerKnown) {
      lines.push(
        "Pod/process ownership is not attached to this frame in the current sample. KERN will not invent a hottest-on-node owner.",
      );
    }
    if (detail.stackSource !== "proc" && detail.stackSource !== "ebpf") {
      lines.push(
        "This frame was inferred from available sampling. Userspace symbols may be partial; deeper attribution is coming.",
      );
    } else if (explained.docsHint) {
      lines.push(explained.docsHint);
    }
    if (explained.commonReasons.length > 0) {
      lines.push(`Common reasons: ${explained.commonReasons.join(", ")}.`);
    }
    return lines;
  }

  if (target.kind === "kernel") {
    if (target.meaning) {
      return [target.meaning];
    }
    return [
      `${target.function} is a kernel path observed in this sample window.`,
      "Inspect stack context around this frame before assuming application CPU burn.",
    ];
  }

  if (target.kind === "pod") {
    return [
      `You selected workload ${target.namespace}/${target.pod}.`,
      target.cpuPercent !== undefined
        ? `It used ~${target.cpuPercent.toFixed(1)}% CPU in the current window.`
        : "CPU share for this workload is unavailable in this sample.",
    ];
  }

  return [
    `You selected process ${friendlyRuntimeName(target.name)} (PID ${target.pid}).`,
    target.pod
      ? `It runs in ${target.namespace ?? "?"}/${target.pod}.`
      : "No pod ownership was attached to this process sample.",
  ];
}
void interpretationFor;

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-kv">
      <span>{label}</span>
      <span title={value}>{value}</span>
    </div>
  );
}

export function InvestigationPanel({
  detail,
  target,
  onClear,
  clusterName,
  onNavigate,
  onCommand,
}: InvestigationPanelProps) {
  const [showReasoning, setShowReasoning] = useState(false);

  const goToView = (nav: "memory" | "network" | "events" | "profiling") => {
    onNavigate?.(nav);
  };

  const runStep = (step: InvestigationNextStep) => {
    if (step.action === "navigate" && step.nav) {
      goToView(step.nav);
      return;
    }
    onCommand?.(step);
  };

  const workflow = useMemo(
    () =>
      buildInvestigationWorkflow(detail.cpuStack, detail.topProcesses, {
        windowSeconds: detail.sampleSeconds,
        sampleHz: 20,
      }),
    [detail.cpuStack, detail.topProcesses, detail.sampleSeconds],
  );

  if (!target) {
    return (
      <aside className="profile-investigation panel">
        <div className="panel-header">Investigation</div>
        <div className="profile-investigation-empty">
          <p>Select a frame.</p>
          <p>
            Click any frame to inspect ownership, stack context, kernel transitions, and
            recommendations.
          </p>
          {/* <p className="profile-investigation-note">{stackSourceNote(detail.stackSource)}</p> */}
        </div>
      </aside>
    );
  }

  const classification = classificationFor(target);
  const owner = enrichOwnerFromDetail(target, detail);
  const interpretationTarget: InvestigationTarget =
    target.kind === "stack"
      ? {
          ...target,
          namespace: owner.namespace,
          pod: owner.pod,
          container: owner.container,
          processName: owner.processName,
          pid: owner.pid,
          threadId: owner.threadId,
          ownerKnown: Boolean(
            owner.namespace || owner.pod || owner.processName || owner.pid,
          ),
        }
      : target.kind === "process"
        ? {
            ...target,
            namespace: owner.namespace,
            pod: owner.pod,
            name: owner.processName ?? target.name,
            pid: owner.pid ?? target.pid,
          }
        : target;

  // Always-on interpretation list (replaced by summary + progressive disclosure):
  // const interpretation = interpretationFor(interpretationTarget, detail);
  void interpretationTarget;

  const frameExplanation =
    target.kind === "stack"
      ? explainStackFrame({
          label: target.label,
          depth: target.depth ?? 0,
          width: 0,
          offset: 0,
          heat: target.heat ?? 0,
          kind: target.frameKind,
          sharePct: target.sharePct,
          samples: target.samples,
          binary: target.binary,
          namespace: target.namespace,
        })
      : target.kind === "kernel"
        ? explainStackFrame({
            label: target.function,
            depth: 0,
            width: 0,
            offset: 0,
            heat: 0,
            kind: "kernel",
          })
        : null;

  const nodeName = detail.name;
  const namespace = owner.namespace;
  const pod = owner.pod;
  const processName = owner.processName;
  const pid = owner.pid;
  const threadId = owner.threadId;
  const container = owner.container;
  const parentLabel =
    target.kind === "stack" || target.kind === "kernel" ? target.parentLabel : undefined;
  const childLabel =
    target.kind === "stack" || target.kind === "kernel" ? target.childLabel : undefined;
  const executable =
    target.kind === "stack"
      ? target.binary || owner.processName
      : target.kind === "process"
        ? target.name
        : undefined;
  const runtime =
    processName || executable ? friendlyRuntimeName(processName ?? executable ?? "") : undefined;
  const showRuntimeSeparately =
    Boolean(runtime && executable && friendlyRuntimeName(executable) !== executable);

  const crumbParts = [
    clusterName || undefined,
    nodeName || undefined,
    namespace && pod ? `${namespace}/${pod}` : pod || namespace || undefined,
    processName ? `${friendlyRuntimeName(processName)}${pid ? ` · PID ${pid}` : ""}` : undefined,
    titleFor(target),
  ].filter(Boolean) as string[];

  const cpuShare =
    target.kind === "stack" && target.sharePct !== undefined
      ? `${target.sharePct}%`
      : target.kind === "kernel" && target.share !== undefined
        ? `${(target.share * 100).toFixed(1)}%`
        : undefined;

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
          <span className="profile-investigation-kicker">{selectedKicker(target)}</span>
          <strong>{titleFor(target)}</strong>
          <span className={`profile-investigation-badge profile-investigation-badge-${classification.toLowerCase()}`}>
            {classification}
          </span>
          {cpuShare ? (
            <span className="profile-investigation-meta">
              CPU {cpuShare} ({stackShareLabel(detail.stackSource)})
            </span>
          ) : null}
        </div>

        <div className="profile-investigation-block">
          <span className="profile-panel-label">Owner</span>
          <Kv label="Namespace" value={namespace ?? "—"} />
          <Kv label="Pod" value={pod ? `${namespace ? `${namespace}/` : ""}${pod}` : "—"} />
          <Kv
            label="Process"
            value={
              processName
                ? `${friendlyRuntimeName(processName)}${pid !== undefined ? ` · PID ${pid}` : ""}`
                : "—"
            }
          />
          {executable ? <Kv label="Binary" value={executable} /> : null}
          {showRuntimeSeparately ? <Kv label="Runtime" value={runtime!} /> : null}
          {container ? <Kv label="Container" value={container} /> : null}
          {threadId ? <Kv label="Thread" value={threadId} /> : null}
        </div>

        {frameExplanation ? (
          <div className="profile-investigation-block">
            <span className="profile-panel-label">What is this?</span>
            <p className="profile-investigation-explain">{frameExplanation.what}</p>
            {frameExplanation.commonReasons.length > 0 ? (
              <ul className="profile-investigation-causes">
                {frameExplanation.commonReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {workflow ? (
          <div className="profile-investigation-block">
            <span className="profile-panel-label">Investigation Summary</span>
            <div className="profile-investigation-summary-head">
              <strong>{workflow.headline}</strong>
              <span
                className={`network-flame-confidence network-flame-confidence-${workflow.confidence.toLowerCase()}`}
              >
                {workflow.confidence}
              </span>
            </div>
            <p className="profile-investigation-explain">{workflow.interpretation}</p>
            <button
              type="button"
              className="profile-investigation-disclosure"
              aria-expanded={showReasoning}
              onClick={() => setShowReasoning((open) => !open)}
            >
              {showReasoning ? "Hide reasoning ▲" : "Show reasoning ▼"}
            </button>
            {showReasoning ? (
              <div className="profile-investigation-advanced">
                {workflow.reasoning.length > 0 ? (
                  <>
                    <span className="profile-panel-label">Evidence</span>
                    <ul className="profile-investigation-causes">
                      {workflow.reasoning.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {workflow.questions.length > 0 ? (
                  <>
                    <span className="profile-panel-label">Questions</span>
                    <ul className="profile-investigation-causes">
                      {workflow.questions.map((item) => (
                        <li key={item.id}>
                          <strong>{item.question}</strong> {item.answer}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <span className="profile-panel-label">Profile Quality</span>
                <p className="profile-investigation-explain">
                  {"★".repeat(workflow.quality.stars)}
                  {"☆".repeat(5 - workflow.quality.stars)}
                  {workflow.quality.samples !== undefined
                    ? ` · ${workflow.quality.samples.toLocaleString()} samples`
                    : ""}
                  {workflow.quality.windowSeconds !== undefined
                    ? ` · ${workflow.quality.windowSeconds}s`
                    : ""}
                </p>
                {(parentLabel || childLabel) && (
                  <>
                    <span className="profile-panel-label">Stack Context</span>
                    <Kv label="Parent" value={parentLabel ? `${parentLabel}()` : "—"} />
                    <Kv label="Current" value={`${titleFor(target)}()`} />
                    <Kv label="Child" value={childLabel ? `${childLabel}()` : "—"} />
                  </>
                )}
                {crumbParts.length > 1 ? (
                  <>
                    <span className="profile-panel-label">Context</span>
                    <div className="profile-investigation-crumbs">
                      {crumbParts.map((part, index) => (
                        <span key={`${part}-${index}`}>
                          {index > 0 ? (
                            <span className="profile-investigation-crumb-sep">↓</span>
                          ) : null}
                          <span className="profile-investigation-crumb">{part}</span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Always-visible Interpretation / Stack Context / Context crumbs lived here before.
        <div className="profile-investigation-block">
          <span className="profile-panel-label">Interpretation</span>
          <ul>...</ul>
        </div>
        */}

        <div className="profile-investigation-block">
          <span className="profile-panel-label">Related views</span>
          <div className="profile-investigation-actions">
            <button
              type="button"
              className="profile-investigation-action"
              onClick={() => goToView("memory")}
            >
              Memory
            </button>
            <button
              type="button"
              className="profile-investigation-action"
              onClick={() => goToView("network")}
            >
              Network
            </button>
            <button
              type="button"
              className="profile-investigation-action"
              onClick={() => goToView("events")}
            >
              Timeline
            </button>
          </div>
        </div>

        {workflow && workflow.nextSteps.length > 0 ? (
          <div className="profile-investigation-block">
            <span className="profile-panel-label">Recommended Next Steps</span>
            {/* Previous: only navigate steps were listed, and focus/kernel actions had no handler.
            {workflow.nextSteps.filter((step) => step.action === "navigate").map(...)}
            */}
            <ul className="profile-investigation-next-steps">
              {workflow.nextSteps.map((step) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className="profile-investigation-next-btn"
                    onClick={() => runStep(step)}
                  >
                    <span className="profile-investigation-next-label">{step.label}</span>
                    <span className="profile-investigation-next-hint">{step.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
