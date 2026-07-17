import { useEffect, useMemo, useRef, useState } from "react";
import {
  flameColor,
  flameCpuFrameColor,
  flameLabelColor,
  flameShareTone,
  FLAME_GRADIENT_CSS,
} from "../../../core/network/flame-colors";
import type { ProcessSample, ProfileStackFrame } from "../../../core/types/profiling";
import type { InvestigationTarget } from "./InvestigationPanel";

function formatBytes(value?: number): string {
  if (value === undefined || value <= 0) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Prefer middle ellipsis so Go/package suffixes stay readable in narrow frames. */
function frameDisplayLabel(frame: ProfileStackFrame, maxChars: number): string {
  const label = frame.label;
  if (label.length <= maxChars) {
    return label;
  }
  if (maxChars < 8) {
    return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  const head = Math.ceil((maxChars - 1) * 0.4);
  const tail = maxChars - 1 - head;
  return `${label.slice(0, head)}…${label.slice(-tail)}`;
}

function frameFillColor(
  variant: TraceFlameVariant,
  frame: ProfileStackFrame,
  heat: number,
  alpha: number,
): string {
  if (variant === "cpu") {
    return flameCpuFrameColor(frame.kind, heat, alpha);
  }
  return flameColor(heat, alpha);
}

function formatFrameKind(kind?: string): string {
  switch (kind) {
    case "app":
    case "application":
      return "Application";
    case "runtime":
      return "Runtime";
    case "library":
      return "Library";
    case "user":
      return "Userspace";
    case "kernel":
      return "Kernel";
    case "root":
      return "Profile root";
    default:
      return kind ?? "—";
  }
}

function isStackLayerKind(kind?: string): boolean {
  return kind === "app" || kind === "runtime" || kind === "library" || kind === "user" || kind === "kernel";
}

type CpuLayerKey = "app" | "runtime" | "library" | "kernel";

const DEFAULT_CPU_LAYERS: Record<CpuLayerKey, boolean> = {
  app: true,
  runtime: true,
  library: true,
  kernel: true,
};

function layerKeyFor(frame: ProfileStackFrame): CpuLayerKey | null {
  if (frame.kind === "app" || frame.kind === "application") {
    return "app";
  }
  if (frame.kind === "runtime") {
    return "runtime";
  }
  if (frame.kind === "library" || frame.kind === "user") {
    return "library";
  }
  if (frame.kind === "kernel") {
    return "kernel";
  }
  return null;
}

function isLayerVisible(frame: ProfileStackFrame, layers: Record<CpuLayerKey, boolean>): boolean {
  const key = layerKeyFor(frame);
  if (!key) {
    return true;
  }
  return layers[key];
}

function applyLayerFilter(
  frames: ProfileStackFrame[],
  layers: Record<CpuLayerKey, boolean>,
): ProfileStackFrame[] {
  return frames
    .filter((frame) => isLayerVisible(frame, layers))
    .map((frame) => {
      const visibleAncestors = ancestorBreadcrumb(frames, frame).filter((ancestor) =>
        isLayerVisible(ancestor, layers),
      );
      return { ...frame, depth: visibleAncestors.length };
    });
}

function frameContains(parent: ProfileStackFrame, child: ProfileStackFrame): boolean {
  return (
    child.offset >= parent.offset - 0.0001 &&
    child.offset + child.width <= parent.offset + parent.width + 0.0001
  );
}

function crossesSyscallBoundary(frame: ProfileStackFrame, all: ProfileStackFrame[]): boolean {
  if (frame.kind !== "kernel") {
    return false;
  }
  const ancestors = ancestorBreadcrumb(all, frame);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor.kind === "kernel") {
      return false;
    }
    if (isStackLayerKind(ancestor.kind)) {
      return true;
    }
    if (ancestor.depth <= 2) {
      return true;
    }
  }
  return false;
}

function friendlyProcessName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "java" || lower.startsWith("java")) {
    return "Java";
  }
  if (lower === "node" || lower.startsWith("node")) {
    return "Node.js";
  }
  if (lower.includes("python")) {
    return "Python";
  }
  if (lower === "kubelet") {
    return "kubelet";
  }
  if (lower.includes("containerd")) {
    return "containerd";
  }
  return name;
}

function isGenericLibraryLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower === "libc.so" ||
    lower.startsWith("libc-") ||
    lower === "libpthread.so" ||
    lower.startsWith("libpthread") ||
    lower.startsWith("ld-") ||
    lower === "ld.so" ||
    lower.startsWith("linux-vdso") ||
    lower === "[vdso]" ||
    lower.startsWith("0x")
  );
}

function isSyncSymbol(label: string): boolean {
  const lower = label.toLowerCase();
  return ["pthread_cond", "futex", "nanosleep", "mutex", "rwlock", "park_on", "do_futex"].some((hint) =>
    lower.includes(hint),
  );
}

function frameHotspotScore(frame: ProfileStackFrame): number {
  const share = frame.sharePct ?? 0;
  let weight = 1;
  if (frame.kind === "app" || frame.kind === "application") {
    weight = 4;
  } else if (frame.kind === "runtime") {
    weight = 3.5;
  } else if (isSyncSymbol(frame.label)) {
    weight = 3.2;
  } else if (frame.kind === "library" && !isGenericLibraryLabel(frame.label)) {
    weight = 2.2;
  } else if (frame.kind === "kernel") {
    weight = 1.4;
  } else if (isGenericLibraryLabel(frame.label)) {
    weight = 0.35;
  }
  return share * weight;
}

type InsightEvidence = {
  id: string;
  text: string;
  /** Clicking applies this investigation shortcut. */
  action?: "kernel-only" | "focus-label" | "userspace-only";
  focusLabel?: string;
};

type CpuInsight = {
  title: string;
  summary: string;
  confidence: "Low" | "Medium" | "High";
  evidence: InsightEvidence[];
  focusLabel?: string;
};

// Previous descriptive insight (no confidence wording / interpretation):
// function buildCpuInsight(frames: ProfileStackFrame[]): string | null { ... }

function buildCpuInsight(
  frames: ProfileStackFrame[],
  processes?: ProcessSample[],
): CpuInsight | null {
  const scored = frames
    .filter((frame) => !isRootCpuFrame(frame) && (frame.sharePct ?? 0) > 0)
    .sort((a, b) => frameHotspotScore(b) - frameHotspotScore(a));
  if (scored.length === 0) {
    return null;
  }

  // Prefer a meaningful subject over generic libc.so / raw hex.
  // const top = scored[0];
  const top =
    scored.find((frame) => !isGenericLibraryLabel(frame.label)) ?? scored[0];

  let userSamples = 0;
  let kernelSamples = 0;
  let runtimeSamples = 0;
  let appSamples = 0;
  for (const frame of frames) {
    if (isRootCpuFrame(frame)) {
      continue;
    }
    const samples = frame.samples ?? frame.sharePct ?? 0;
    if (frame.kind === "kernel") {
      kernelSamples += samples;
    } else if (frame.kind === "runtime") {
      runtimeSamples += samples;
      userSamples += samples;
    } else if (frame.kind === "app" || frame.kind === "application") {
      appSamples += samples;
      userSamples += samples;
    } else if (isStackLayerKind(frame.kind)) {
      userSamples += samples;
    }
  }
  const layerTotal = userSamples + kernelSamples;
  const userPct = layerTotal > 0 ? Math.round((100 * userSamples) / layerTotal) : undefined;
  const kernelPct = layerTotal > 0 ? Math.round((100 * kernelSamples) / layerTotal) : undefined;

  const topKernel = scored.find(
    (frame) =>
      frame.kind === "kernel" &&
      !frame.label.startsWith("0x") &&
      !/^(el0|do_el0|invoke_syscall|entry_syscall)/i.test(frame.label),
  );
  const topSync = scored.find((frame) => isSyncSymbol(frame.label));
  const topProcess = [...(processes ?? [])].sort(
    (a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0),
  )[0];

  const workloadLabel = topProcess
    ? `${friendlyProcessName(topProcess.name)}${topProcess.pid ? ` (PID ${topProcess.pid})` : ""}`
    : friendlyProcessName(top.label);
  const workloadShare = topProcess?.cpuPercent !== undefined
    ? Math.round(topProcess.cpuPercent)
    : top.sharePct;

  const interpretation = interpretCpuHotspot(top, topKernel, topSync, {
    userPct,
    kernelPct,
    runtimeSamples,
    appSamples,
  });

  const evidence: InsightEvidence[] = [];
  if (kernelPct !== undefined) {
    evidence.push({
      id: "kernel-share",
      text: `~${kernelPct}% of sampled execution crossed into the kernel`,
      action: "kernel-only",
    });
  }
  if (topSync?.label) {
    evidence.push({
      id: "sync-transition",
      text: `Dominant transition through ${topSync.label}()`,
      action: "focus-label",
      focusLabel: topSync.label,
    });
  } else if (topKernel?.label) {
    evidence.push({
      id: "kernel-frame",
      text: `Hottest kernel frame: ${topKernel.label}`,
      action: "focus-label",
      focusLabel: topKernel.label,
    });
  }
  if (userPct !== undefined && userPct < 45) {
    evidence.push({
      id: "limited-app",
      text: "Limited application CPU observed in this sample set",
      action: "userspace-only",
    });
  } else if (appSamples > 0 && runtimeSamples >= appSamples * 2) {
    evidence.push({
      id: "runtime-heavy",
      text: "Runtime frames outweigh application frames in sampled userspace",
    });
  }

  let confidence: CpuInsight["confidence"] = "Medium";
  if (evidence.length >= 3 && (workloadShare ?? 0) >= 25) {
    confidence = "High";
  } else if (evidence.length <= 1 || (workloadShare ?? 0) < 12) {
    confidence = "Low";
  }

  const transition = topSync?.label ?? topKernel?.label;
  const summaryParts = [
    `${workloadLabel} accounted for ~${workloadShare ?? top.sharePct}% of sampled CPU.`,
  ];
  if (transition && (kernelPct ?? 0) >= 50) {
    summaryParts.push(
      `Most execution entered the kernel through ${transition}(), suggesting blocked or waiting workers rather than active computation.`,
    );
  } else if (interpretation) {
    summaryParts.push(interpretation);
  }

  return {
    title: "Likely hotspot",
    summary: summaryParts.join(" "),
    confidence,
    evidence,
    focusLabel: topSync?.label ?? top.label,
  };
}

function interpretCpuHotspot(
  top: ProfileStackFrame,
  topKernel: ProfileStackFrame | undefined,
  topSync: ProfileStackFrame | undefined,
  stats: {
    userPct?: number;
    kernelPct?: number;
    runtimeSamples: number;
    appSamples: number;
  },
): string | null {
  const label = (topSync?.label ?? top.label).toLowerCase();
  const kernel = (topKernel?.label ?? "").toLowerCase();
  const syncHints = ["pthread_cond", "futex", "nanosleep", "mutex", "rwlock", "park", "wait"];
  const ioHints = ["epoll", "poll", "select", "io_uring"];
  const netHints = ["tcp_", "udp_", "sock_", "netif", "napi", "recvmsg", "sendmsg"];

  if (syncHints.some((hint) => label.includes(hint) || kernel.includes(hint))) {
    // return "Likely waiting on thread synchronization rather than active computation — blocked or idle workers are a common cause.";
    return "Likely waiting on thread synchronization rather than active computation.";
  }
  if (netHints.some((hint) => label.includes(hint) || kernel.includes(hint))) {
    return "Most kernel activity looks network-related — this profile suggests a network-bound workload.";
  }
  if (ioHints.some((hint) => label.includes(hint) || kernel.includes(hint))) {
    return "Samples concentrate on event-wait / I/O paths — the node may be blocked on readiness rather than burning CPU in app code.";
  }
  if (kernel.includes("schedule") || kernel.includes("pick_next")) {
    return "Scheduler activity is elevated — threads are likely sleeping or contending for CPU time.";
  }
  if (
    top.kind === "runtime" ||
    label.includes("libjvm") ||
    label.startsWith("runtime.") ||
    (stats.runtimeSamples > 0 && stats.runtimeSamples >= stats.appSamples * 2)
  ) {
    return "CPU time looks dominated by runtime machinery rather than application code.";
  }
  if (top.kind === "app" && (stats.userPct ?? 0) >= 65) {
    return "Application frames dominate sampled userspace time — focus on this code path first.";
  }
  return null;
}

function isOffsetSubtitle(value?: string): boolean {
  return Boolean(value && /^\+?0x[0-9a-fA-F]+$/.test(value.trim()));
}

/** Prefer share-of-node when present so color matches the legend thresholds. */
function framePressureHeat(frame: ProfileStackFrame): number {
  if (frame.sharePct !== undefined) {
    // Soft curve: small frames stay green, mid pressure amber, hot frames red.
    // return Math.min(1, (frame.sharePct / 100) ** 0.82);
    if (frame.sharePct >= 20) {
      return Math.min(1, 0.82 + (frame.sharePct - 20) / 400);
    }
    if (frame.sharePct >= 10) {
      return 0.5 + ((frame.sharePct - 10) / 10) * 0.22;
    }
    return 0.12 + (frame.sharePct / 10) * 0.32;
  }
  return Math.max(0, Math.min(1, frame.heat));
}

function isRootCpuFrame(frame: ProfileStackFrame): boolean {
  return (
    frame.depth === 0 ||
    frame.label === "all" ||
    // frame.label === "Node CPU" ||
    // frame.label === "CPU Samples" ||
    frame.label === "Node CPU" ||
    frame.label === "CPU Samples" ||
    frame.kind === "root"
  );
}

function isNumericSubtitle(value?: string): boolean {
  return Boolean(value && /^\d+$/.test(value.trim()));
}

function podNameFromPath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  const parts = path.split("/");
  return parts[parts.length - 1] || undefined;
}

function ancestorBreadcrumb(
  frames: ProfileStackFrame[],
  selected: ProfileStackFrame,
): ProfileStackFrame[] {
  return frames
    .filter(
      (frame) =>
        frame.depth < selected.depth &&
        selected.offset >= frame.offset - 0.0001 &&
        selected.offset + selected.width <= frame.offset + frame.width + 0.0001,
    )
    .sort((a, b) => a.depth - b.depth);
}

function frameKey(frame: ProfileStackFrame, index = 0): string {
  return frame.id ?? `${frame.depth}:${frame.label}:${frame.binary ?? ""}:${index}`;
}

function frameGeometry(frame: ProfileStackFrame, canvasWidth: number): { x: number; blockWidth: number } {
  // True icicle/flame layout: x and width are proportional — never warp x by block size.
  // const blockWidth = Math.max(18, frame.width * canvasWidth);
  // const x = frame.offset * (canvasWidth - Math.min(blockWidth, canvasWidth * 0.995));
  const rawWidth = Math.max(0, frame.width) * canvasWidth;
  const x = Math.max(0, frame.offset) * canvasWidth;
  const blockWidth = Math.max(rawWidth, rawWidth > 0 ? 1 : 0);
  return { x, blockWidth: Math.min(blockWidth, Math.max(0, canvasWidth - x)) };
}


function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="network-flame-kv">
      <span title={hint}>{label}</span>
      <span title={value}>{value}</span>
    </div>
  );
}

export type TraceFlameVariant = "network" | "cpu" | "memory";

interface TraceFlameStackProps {
  frames: ProfileStackFrame[];
  label?: string;
  variant?: TraceFlameVariant;
  onSelect?: (target: InvestigationTarget) => void;
  selectedLabel?: string;
  /** Sample window length in seconds (shown in CPU meta strip). */
  sampleSeconds?: number;
  /** Nominal sampling frequency in Hz when known. */
  sampleHz?: number;
  /** Node name for selected-frame detail. */
  nodeName?: string;
  /** When true, hold the current flame snapshot (parent can also pause polling). */
  paused?: boolean;
  /** Notify parent when user pauses/resumes inspection. */
  onPausedChange?: (paused: boolean) => void;
  /** Hottest processes on the node — used to attribute findings to a workload. */
  processes?: ProcessSample[];
}

export function TraceFlameStack({
  frames,
  label,
  variant = "network",
  onSelect,
  selectedLabel,
  sampleSeconds,
  // sampleHz = 99,
  sampleHz = 20,
  nodeName,
  paused: pausedProp,
  onPausedChange,
  processes,
}: TraceFlameStackProps) {
  const title =
    label ??
    (variant === "cpu"
      ? "Node performance flamegraph"
      : variant === "memory"
        ? "Retained heap flamegraph"
        : "Network flame graph");
  const hint =
    variant === "cpu"
      // ? "CPU Samples → pod → process → app / runtime / library → kernel. Double-click a frame to focus its subtree."
      // ? "Merged CPU samples (pyramid). Wide frames = shared stack prefixes across the node. Application / Runtime / Library / Kernel by color. Click to pause; double-click to zoom."
      ? "Wider bars used more CPU. Click a frame to inspect it; double-click to zoom in."
      : variant === "memory"
        // ? "all → pod → process. Width = retained RSS bytes (not CPU samples). Click a frame for ownership."
        ? "Wider bars hold more memory. Click a frame to see what owns it."
        : "Click a frame to inspect protocol, peer, bytes, and latency.";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinnedFrame, setPinnedFrame] = useState<ProfileStackFrame | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [highlightLabel, setHighlightLabel] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<CpuLayerKey, boolean>>(DEFAULT_CPU_LAYERS);
  const [pausedLocal, setPausedLocal] = useState(false);
  const frozenFramesRef = useRef<ProfileStackFrame[] | null>(null);

  const paused = pausedProp ?? pausedLocal;
  const setPaused = (next: boolean) => {
    if (pausedProp === undefined) {
      setPausedLocal(next);
    }
    onPausedChange?.(next);
  };

  useEffect(() => {
    if (!paused) {
      frozenFramesRef.current = frames;
    } else if (!frozenFramesRef.current) {
      frozenFramesRef.current = frames;
    }
  }, [frames, paused]);

  const stableFrames = paused && frozenFramesRef.current ? frozenFramesRef.current : frames;

  const rootFrame = stableFrames.find((frame) => isRootCpuFrame(frame)) ?? stableFrames[0] ?? null;
  const totalSamples = rootFrame?.samples;
  const windowSeconds = sampleSeconds ?? 30;
  // Retained sample counts are not limited to the display window — don't invent CPU-sec from them.
  // const cpuTimeSeconds =
  //   totalSamples !== undefined && sampleHz > 0
  //     ? (totalSamples / sampleHz).toFixed(1)
  //     : undefined;

  const layerFiltered = useMemo(
    () => (variant === "cpu" ? applyLayerFilter(stableFrames, layers) : stableFrames),
    [stableFrames, layers, variant],
  );

  const selected =
    (selectedId
      ? layerFiltered.find((frame, index) => frameKey(frame, index) === selectedId) ??
        stableFrames.find((frame, index) => frameKey(frame, index) === selectedId)
      : null) ??
    (pinnedFrame
      ? layerFiltered.find(
          (frame) =>
            frame.label === pinnedFrame.label &&
            frame.depth === pinnedFrame.depth &&
            (frame.binary ?? "") === (pinnedFrame.binary ?? ""),
        ) ?? pinnedFrame
      : null) ??
    layerFiltered.find((frame) => frame.label === selectedLabel) ??
    null;

  const focused = useMemo(() => {
    if (!focusId) {
      return layerFiltered;
    }
    const target =
      layerFiltered.find((frame, index) => frameKey(frame, index) === focusId) ??
      layerFiltered.find((frame) => (frame.id ?? `${frame.depth}-${frame.label}`) === focusId) ??
      null;
    if (!target) {
      return layerFiltered;
    }
    const descendants = layerFiltered.filter(
      (frame) =>
        frame === target ||
        (frame.depth > target.depth &&
          frame.offset >= target.offset - 0.0001 &&
          frame.offset + frame.width <= target.offset + target.width + 0.0001),
    );
    if (descendants.length === 0) {
      return layerFiltered;
    }
    const baseOffset = target.offset;
    const baseWidth = Math.max(target.width, 0.0001);
    return descendants.map((frame) => ({
      ...frame,
      depth: frame.depth - target.depth,
      offset: (frame.offset - baseOffset) / baseWidth,
      width: frame.width / baseWidth,
    }));
  }, [layerFiltered, focusId]);

  const overviewFrames = useMemo(
    () => stableFrames.filter((frame) => frame.depth === 1),
    [stableFrames],
  );

  const cpuInsight = useMemo(
    // () => (variant === "cpu" ? buildCpuInsight(stableFrames) : null),
    () => (variant === "cpu" ? buildCpuInsight(stableFrames, processes) : null),
    [stableFrames, processes, variant],
  );

  const applyInsightEvidence = (item: InsightEvidence) => {
    frozenFramesRef.current = frames;
    setPaused(true);
    if (item.action === "kernel-only") {
      setLayers({ app: false, runtime: false, library: false, kernel: true });
      setHighlightLabel(null);
      return;
    }
    if (item.action === "userspace-only") {
      setLayers({ app: true, runtime: true, library: true, kernel: false });
      setHighlightLabel(null);
      return;
    }
    if (item.action === "focus-label" && item.focusLabel) {
      setHighlightLabel(item.focusLabel);
      const match =
        stableFrames.find((frame) => frame.label === item.focusLabel) ?? null;
      if (match) {
        const id = frameKey(match);
        setSelectedId(id);
        setPinnedFrame(match);
        setFocusId(id);
        onSelect?.({
          kind: "stack",
          label: match.label,
          heat: framePressureHeat(match),
          depth: match.depth,
          namespace: match.namespace,
          path: match.path,
          subtitle: match.subtitle,
          sharePct: match.sharePct,
          samples: match.samples,
        });
      }
    }
  };

  const focusTarget = useMemo(() => {
    if (!focusId) {
      return null;
    }
    return (
      stableFrames.find((frame, index) => frameKey(frame, index) === focusId) ??
      stableFrames.find((frame) => (frame.id ?? `${frame.depth}-${frame.label}`) === focusId) ??
      null
    );
  }, [stableFrames, focusId]);

  const focusCrumb = useMemo(() => {
    if (!focusTarget) {
      return [];
    }
    return [...ancestorBreadcrumb(stableFrames, focusTarget), focusTarget];
  }, [stableFrames, focusTarget]);

  const pauseForInspect = (frame: ProfileStackFrame, id: string) => {
    frozenFramesRef.current = frames;
    setPaused(true);
    setSelectedId(id);
    setPinnedFrame(frame);
    onSelect?.({
      kind: "stack",
      label: frame.label,
      heat: framePressureHeat(frame),
      depth: frame.depth,
      namespace: frame.namespace,
      path: frame.path,
      subtitle: frame.subtitle,
      sharePct: frame.sharePct,
      samples: frame.samples,
    });
  };

  const resumeLive = () => {
    frozenFramesRef.current = null;
    setPaused(false);
    setPinnedFrame(null);
  };

  if (stableFrames.length === 0) {
    return (
      <div className="network-flame">
        <span className="profile-panel-label">{title}</span>
        <div className="profile-log-empty">No flame samples yet.</div>
      </div>
    );
  }

  const rowHeight = 28;
  const width = 720;
  const depthRows = Math.max(...focused.map((frame) => frame.depth), 0) + 1;
  const height = depthRows * rowHeight + 10;
  const shareTone = flameShareTone(selected?.sharePct);

  const selectedPod =
    selected?.depth === 1
      ? selected.label
      : podNameFromPath(selected?.path) ?? (selected && !isOffsetSubtitle(selected.subtitle) && !isNumericSubtitle(selected.subtitle)
          ? selected.subtitle
          : undefined);
  const selectedThread =
    selected && selected.depth === 2 && isNumericSubtitle(selected.subtitle)
      ? selected.subtitle
      : undefined;
  const selectedBreadcrumb = selected ? ancestorBreadcrumb(stableFrames, selected) : [];
  const stackPath = selected
    ? [...selectedBreadcrumb, selected]
        .filter((frame) => frame.depth >= 2 || isStackLayerKind(frame.kind))
        .map((frame) => frame.label)
    : [];

  const toggleLayer = (key: CpuLayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className={`network-flame network-flame-sleek${paused ? " network-flame-paused" : ""}`}>
      <div className="profile-flamegraph-wrap network-flame-graph">
        <div className="network-flame-title-row">
          <span className="profile-panel-label">{title}</span>
          <div className="network-flame-toolbar">
            <div className="network-flame-legend" aria-hidden>
              {variant === "cpu" ? (
                <>
                  <span className="network-flame-legend-swatch network-flame-legend-app" />
                  Application
                  <span className="network-flame-legend-swatch network-flame-legend-runtime" />
                  Runtime
                  <span className="network-flame-legend-swatch network-flame-legend-user" />
                  Library
                  <span className="network-flame-legend-swatch network-flame-legend-kernel" />
                  Kernel
                </>
              ) : (
                <>
                  <span className="network-flame-legend-swatch network-flame-legend-good" />
                  {"<10%"}
                  <span className="network-flame-legend-swatch network-flame-legend-warn" />
                  10–20%
                  <span className="network-flame-legend-swatch network-flame-legend-hot" />
                  {">20%"}
                </>
              )}
            </div>
            {paused ? (
              <button
                type="button"
                className="network-flame-pause-btn is-paused"
                onClick={resumeLive}
              >
                Resume
              </button>
            ) : (
              <button
                type="button"
                className="network-flame-pause-btn"
                onClick={() => {
                  frozenFramesRef.current = frames;
                  setPaused(true);
                }}
              >
                Pause
              </button>
            )}
            {focusId ? (
              <button
                type="button"
                className="network-flame-reset"
                onClick={() => setFocusId(null)}
              >
                Reset zoom
              </button>
            ) : null}
          </div>
        </div>
        <p className="network-flame-hint">{hint}</p>
        {/* {paused ? (
          <p className="network-flame-paused-banner" role="status">
            Updates paused while you inspect. Click Resume live when you are done.
          </p>
        ) : null} */}

        {variant === "cpu" && cpuInsight ? (
          <div className="network-flame-insight" role="status">
            {/* <span className="profile-panel-label">Top finding</span> */}
            {/* <p>{cpuInsight.body}</p> */}
            <div className="network-flame-insight-head">
              <span className="profile-panel-label">{cpuInsight.title}</span>
              <span className={`network-flame-confidence network-flame-confidence-${cpuInsight.confidence.toLowerCase()}`}>
                Confidence: {cpuInsight.confidence}
              </span>
            </div>
            <p>{cpuInsight.summary}</p>
            {cpuInsight.evidence.length > 0 ? (
              <div className="network-flame-evidence">
                <span className="profile-panel-label">Evidence</span>
                <ul>
                  {cpuInsight.evidence.map((item) => (
                    <li key={item.id}>
                      {item.action ? (
                        <button
                          type="button"
                          className="network-flame-evidence-btn"
                          onClick={() => applyInsightEvidence(item)}
                        >
                          {item.text}
                        </button>
                      ) : (
                        <span>{item.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {variant === "cpu" ? (
          <div className="network-flame-layers" role="group" aria-label="Stack layers">
            {(
              [
                ["app", "Application"],
                ["runtime", "Runtime"],
                ["library", "Library"],
                ["kernel", "Kernel"],
              ] as const
            ).map(([key, labelText]) => (
              <label key={key} className={`network-flame-layer${layers[key] ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => toggleLayer(key)}
                />
                {labelText}
              </label>
            ))}
          </div>
        ) : null}

        {variant === "cpu" && focusCrumb.length > 0 ? (
          <div className="network-flame-focus-crumb" aria-label="Zoom path">
            {focusCrumb.map((frame, index) => (
              <span key={`${frame.id ?? frame.label}-${index}`}>
                {index > 0 ? <span className="network-flame-breadcrumb-sep">›</span> : null}
                <button
                  type="button"
                  className="network-flame-crumb-btn"
                  onClick={() => setFocusId(frameKey(frame, index))}
                >
                  {frame.label}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {variant === "cpu" ? (
          <div className="network-flame-meta" aria-label="Sample window summary">
            {/* <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Samples</span>
              <span className="network-flame-meta-value">
                {totalSamples !== undefined ? totalSamples.toLocaleString() : "—"}
              </span>
            </div>
            <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Window</span>
              <span className="network-flame-meta-value">{windowSeconds}s</span>
            </div>
            <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Frequency</span>
              <span className="network-flame-meta-value">{sampleHz} Hz</span>
            </div>
            <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Observed CPU</span>
              <span className="network-flame-meta-value">
                {cpuTimeSeconds !== undefined ? `${cpuTimeSeconds} CPU-sec` : "—"}
              </span>
            </div> */}
            <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Snapshots</span>
              <span className="network-flame-meta-value">
                {totalSamples !== undefined ? totalSamples.toLocaleString() : "—"}
              </span>
              <span className="network-flame-meta-hint">retained across CPUs</span>
            </div>
            <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Profile age</span>
              <span className="network-flame-meta-value">{windowSeconds}s</span>
              <span className="network-flame-meta-hint">UI refresh window</span>
            </div>
            <div className="network-flame-meta-item">
              <span className="network-flame-meta-label">Sample rate</span>
              <span className="network-flame-meta-value">~{sampleHz} Hz</span>
              <span className="network-flame-meta-hint">per CPU</span>
            </div>
          </div>
        ) : null}

        {variant !== "cpu" ? (
          <div
            className="network-flame-scale"
            style={{ background: FLAME_GRADIENT_CSS }}
            aria-hidden
          />
        ) : null}

        {(variant === "cpu" || variant === "memory") && overviewFrames.length > 0 ? (
          <svg
            className="profile-flame-overview"
            viewBox={`0 0 ${width} 20`}
            role="img"
            aria-label="Node flame overview"
          >
            {overviewFrames.map((frame, index) => {
              const id = frameKey(frame, index);
              const { x, blockWidth } = frameGeometry(frame, width);
              const heat = framePressureHeat(frame);
              return (
                <rect
                  key={id}
                  x={x}
                  y={3}
                  width={Math.max(2, blockWidth)}
                  height={14}
                  rx={2}
                  fill={frameFillColor(variant, frame, heat, 0.95)}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={0.4}
                >
                  <title>{`${frame.label} · ${frame.sharePct ?? 0}%`}</title>
                </rect>
              );
            })}
          </svg>
        ) : null}

        <div className="profile-flamegraph-scroll">
          <svg
            className="profile-flamegraph"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={title}
          >
            {focused.map((frame, index) => {
              const id = frameKey(frame, index);
              const y = 4 + frame.depth * rowHeight;
              const { x, blockWidth } = frameGeometry(frame, width);
              const isSelected =
                selectedId === id ||
                (selected !== null &&
                  selected.label === frame.label &&
                  selected.depth === frame.depth &&
                  (selected.binary ?? "") === (frame.binary ?? "")) ||
                selectedLabel === frame.label;
              const isHighlighted = Boolean(highlightLabel && frame.label === highlightLabel);
              const chars = Math.max(4, Math.floor(blockWidth / 5.2));
              const heat = framePressureHeat(frame);
              const fill = frameFillColor(
                variant,
                frame,
                heat,
                isSelected || isHighlighted ? 1 : highlightLabel ? 0.35 : 0.93,
              );
              const showPidLine =
                variant === "cpu" &&
                frame.depth === 2 &&
                isNumericSubtitle(frame.subtitle) &&
                blockWidth >= 56;
              const showRootShare =
                variant === "cpu" &&
                isRootCpuFrame(frame) &&
                frame.sharePct !== undefined &&
                blockWidth >= 72;
              const showSyscallBoundary =
                variant === "cpu" && crossesSyscallBoundary(frame, layerFiltered) && blockWidth >= 36;
              const showLabel = blockWidth >= 22;
              return (
                <g
                  key={id}
                  className={`network-flame-frame${isSelected || isHighlighted ? " network-flame-frame-active" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => pauseForInspect(frame, id)}
                  onDoubleClick={() => {
                    pauseForInspect(frame, id);
                    setFocusId(id);
                  }}
                >
                  <title>
                    {[
                      frame.label,
                      isStackLayerKind(frame.kind) ? formatFrameKind(frame.kind) : null,
                      frame.binary ? `Binary: ${frame.binary}` : null,
                      isOffsetSubtitle(frame.subtitle) ? `Offset: ${frame.subtitle}` : frame.subtitle,
                      variant === "memory" && frame.bytes !== undefined
                        ? `Retained: ${formatBytes(frame.bytes)}`
                        : null,
                      frame.samples !== undefined ? `Samples: ${frame.samples}` : null,
                      frame.sharePct !== undefined
                        ? `Percentage: ${frame.sharePct}%`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </title>
                  {showSyscallBoundary ? (
                    <g className="network-flame-syscall-boundary">
                      <line
                        x1={x}
                        x2={x + blockWidth}
                        y1={y - 2}
                        y2={y - 2}
                        stroke="rgba(255,255,255,0.35)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      {blockWidth >= 120 ? (
                        <text
                          x={x + blockWidth / 2}
                          y={y - 5}
                          textAnchor="middle"
                          className="profile-flame-label"
                          fill="rgba(255,255,255,0.45)"
                          fontSize={8}
                        >
                          syscall boundary
                        </text>
                      ) : null}
                    </g>
                  ) : null}
                  <rect
                    x={x}
                    y={y}
                    width={Math.max(1, blockWidth)}
                    height={24}
                    rx={blockWidth < 8 ? 1 : 3}
                    fill={fill}
                    stroke={
                      isSelected || isHighlighted
                        ? "rgba(255,255,255,0.55)"
                        : "rgba(0,0,0,0.18)"
                    }
                    strokeWidth={isSelected || isHighlighted ? 1.6 : 0.5}
                  />
                  {showLabel ? (
                    showPidLine || showRootShare ? (
                      <>
                        <text
                          x={x + 8}
                          y={y + 11}
                          className="profile-flame-label profile-flame-label-primary"
                          fill={flameLabelColor(heat)}
                        >
                          {frameDisplayLabel(frame, chars)}
                        </text>
                        <text
                          x={x + 8}
                          y={y + 21}
                          className="profile-flame-label profile-flame-label-secondary"
                          fill={flameLabelColor(heat)}
                          opacity={0.85}
                        >
                          {showPidLine ? frame.subtitle : `${frame.sharePct}%`}
                        </text>
                      </>
                    ) : (
                      <text
                        x={x + 8}
                        y={y + 15}
                        className="profile-flame-label"
                        fill={flameLabelColor(heat)}
                      >
                        {frameDisplayLabel(frame, chars)}
                      </text>
                    )
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {selected ? (
        <div className={`network-flame-detail network-flame-detail-${shareTone}`}>
          <div className="network-flame-detail-head">
            <div>
              <span className="profile-panel-label">Selected frame</span>
              <h3 className="network-flame-detail-title" title={selected.label}>
                {selected.label}
              </h3>
              {isStackLayerKind(selected.kind) ? (
                <p className="network-flame-detail-sub">{formatFrameKind(selected.kind)}</p>
              ) : null}
              {selected.subtitle &&
              !isNumericSubtitle(selected.subtitle) &&
              !isOffsetSubtitle(selected.subtitle) ? (
                <p className="network-flame-detail-sub">{selected.subtitle}</p>
              ) : null}
              {isRootCpuFrame(selected) && nodeName?.trim() ? (
                <p className="network-flame-detail-sub">Node: {nodeName}</p>
              ) : null}
              {selectedThread ? (
                <p className="network-flame-detail-sub">PID {selectedThread}</p>
              ) : null}
            </div>
            <div className="network-flame-detail-actions">
              {variant === "cpu" && selected.depth > 0 ? (
                <button
                  type="button"
                  className="network-flame-reset"
                  onClick={() => {
                    setPaused(true);
                    setFocusId(selected.id ?? frameKey(selected));
                  }}
                >
                  Focus subtree
                </button>
              ) : null}
              {selected.sharePct !== undefined ? (
                <span className={`network-flame-share network-flame-share-${shareTone}`}>
                  {selected.sharePct}%
                </span>
              ) : null}
            </div>
          </div>

          {variant === "cpu" && stackPath.length > 1 ? (
            <div className="network-flame-breadcrumb" aria-label="Stack path">
              {stackPath.map((pathLabel, index) => (
                <span key={`${pathLabel}-${index}`}>
                  {index > 0 ? <span className="network-flame-breadcrumb-sep">↓</span> : null}
                  <span title={pathLabel}>{pathLabel}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="network-flame-detail-grid">
            {variant === "cpu" ? (
              <>
                <DetailRow label="Frame" value={selected.label} />
                <DetailRow label="Type" value={formatFrameKind(selected.kind)} />
                <DetailRow
                  label="CPU"
                  value={selected.sharePct !== undefined ? `${selected.sharePct}%` : "—"}
                  hint="Share of sampled node CPU in this window."
                />
                <DetailRow
                  label="Samples"
                  value={selected.samples !== undefined ? selected.samples.toLocaleString() : "—"}
                />
                <DetailRow
                  label="Binary"
                  value={selected.binary?.trim() ? selected.binary : "—"}
                />
                <DetailRow
                  label="Offset"
                  value={isOffsetSubtitle(selected.subtitle) ? selected.subtitle! : "—"}
                  hint="File offset when symbols were unavailable."
                />
                <DetailRow label="Pod" value={selectedPod?.trim() ? selectedPod : "—"} />
                <DetailRow
                  label="PID"
                  value={selectedThread ?? "—"}
                  hint="Linux PID for this process frame."
                />
                <DetailRow
                  label="Namespace"
                  value={selected.namespace?.trim() ? selected.namespace : "—"}
                />
                <DetailRow label="Node" value={nodeName?.trim() ? nodeName : "—"} />
                <DetailRow
                  label="Sampling window"
                  value={sampleSeconds !== undefined ? `${sampleSeconds}s` : `${windowSeconds}s`}
                />
              </>
            ) : variant === "memory" ? (
              <>
                <DetailRow
                  label="Retained memory"
                  value={formatBytes(selected.bytes)}
                  hint="RSS owned by this frame. Width of the flame is proportional to these bytes."
                />
                <DetailRow
                  label="Share of node"
                  value={selected.sharePct !== undefined ? `${selected.sharePct}%` : "—"}
                />
                <DetailRow
                  label="Flame depth"
                  value={String(selected.depth)}
                  hint="0 = node → 1 = pod → 2 = process / alloc site"
                />
                <DetailRow
                  label="Pod namespace"
                  value={selected.namespace?.trim() ? selected.namespace : "—"}
                />
              </>
            ) : (
              <>
                <DetailRow label="Kind" value={selected.endpointKind ?? selected.kind ?? "—"} />
                <DetailRow
                  label="Pod namespace"
                  value={selected.namespace?.trim() ? selected.namespace : "—"}
                  hint="Set on destination/workload frames (depth ≥ 2). Protocol frames like TCP have none."
                />
                <DetailRow
                  label="Protocol"
                  value={
                    selected.protocol
                      ? selected.port
                        ? `${selected.protocol}/${selected.port}`
                        : selected.protocol
                      : "—"
                  }
                />
                <DetailRow label="Peer / IP" value={selected.ip ?? "—"} />
                <DetailRow label="Bytes" value={formatBytes(selected.bytes)} />
                <DetailRow
                  label="Latency"
                  value={selected.latencyMs !== undefined ? `${selected.latencyMs} ms` : "—"}
                />
                <DetailRow
                  label="Flows"
                  value={selected.flowCount !== undefined ? String(selected.flowCount) : "—"}
                />
                <DetailRow
                  label="Flame depth"
                  value={String(selected.depth)}
                  hint="0 = network root → 1 = protocol → 2 = endpoint → 3 = workload"
                />
              </>
            )}
          </div>

          {selected.path ? (
            <div className="network-flame-path">
              <span className="profile-panel-label">Path</span>
              <code>{selected.path}</code>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

