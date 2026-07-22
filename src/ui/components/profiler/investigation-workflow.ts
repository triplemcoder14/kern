import type { ProcessSample, ProfileStackFrame } from "../../../core/types/profiling";

export type InvestigationConfidence = "Low" | "Medium" | "High";

export type InvestigationEvidence = {
  id: string;
  text: string;
  action?: "kernel-only" | "focus-label" | "userspace-only";
  focusLabel?: string;
};

export type InvestigationQuestion = {
  id: string;
  question: string;
  answer: string;
};

export type InvestigationNextStep = {
  id: string;
  label: string;
  hint: string;
  action: "focus-label" | "kernel-only" | "userspace-only" | "navigate";
  focusLabel?: string;
  nav?: "memory" | "network" | "events" | "profiling";
};

export type LayeredHotspot = {
  id: string;
  layer: "Application" | "Runtime" | "Libraries" | "Kernel";
  label: string;
  sharePct: number;
  focusLabel: string;
};

export type FrameExplanation = {
  title: string;
  what: string;
  commonReasons: string[];
  docsHint?: string;
};

export type ProfileQuality = {
  stars: number;
  samples?: number;
  windowSeconds?: number;
  sampleHz?: number;
  kernelStacks: "ok" | "partial" | "missing";
  userspaceStacks: "ok" | "partial" | "missing";
  pidAttribution: "ok" | "partial" | "missing";
  podAttribution: "ok" | "partial" | "missing";
  notes: string[];
};

export type InvestigationWorkflow = {
  headline: string;
  confidence: InvestigationConfidence;
  reasoning: string[];
  interpretation: string;
  evidence: InvestigationEvidence[];
  questions: InvestigationQuestion[];
  nextSteps: InvestigationNextStep[];
  hotspots: LayeredHotspot[];
  quality: ProfileQuality;
  focusLabel?: string;
  workloadLabel?: string;
};

function isRootCpuFrame(frame: ProfileStackFrame): boolean {
  return (
    frame.depth === 0 ||
    frame.label === "all" ||
    frame.label === "Node CPU" ||
    frame.label === "CPU Samples" ||
    frame.kind === "root"
  );
}

function isSyncSymbol(label: string): boolean {
  return /nanosleep|futex|pthread_cond|mutex|rwlock|park|epoll_wait|io_uring|schedule/i.test(
    label,
  );
}

function isGenericLibraryLabel(label: string): boolean {
  return /^(libc\.so|ld-linux|libpthread|libm\.so|\[unknown\])/i.test(label);
}

function friendlyProcessName(name: string): string {
  if (/^node(\s|$)/i.test(name) || name === "node") {
    return "Node.js";
  }
  if (/^python/i.test(name)) {
    return "Python";
  }
  if (/^java/i.test(name)) {
    return "Java";
  }
  return name;
}

function formatSampleCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}

function frameScore(frame: ProfileStackFrame): number {
  return frame.sharePct ?? (frame.samples ? Math.min(100, frame.samples / 100) : 0);
}

/**
 * Build a structured investigation workflow from a CPU flame sample.
 * Language stays engineering-first: evidence → interpretation, never certainty.
 */
export function buildInvestigationWorkflow(
  frames: ProfileStackFrame[],
  processes?: ProcessSample[],
  options?: { windowSeconds?: number; sampleHz?: number },
): InvestigationWorkflow | null {
  const scored = frames
    .filter((frame) => !isRootCpuFrame(frame) && (frame.sharePct ?? 0) > 0)
    .sort((a, b) => frameScore(b) - frameScore(a));
  if (scored.length === 0) {
    return null;
  }

  const top =
    scored.find((frame) => !isGenericLibraryLabel(frame.label)) ?? scored[0];

  let userSamples = 0;
  let kernelSamples = 0;
  let runtimeSamples = 0;
  let appSamples = 0;
  let librarySamples = 0;
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
    } else if (frame.kind === "app") {
      appSamples += samples;
      userSamples += samples;
    // } else if (frame.kind === "app" || frame.kind === "application") {
    //   appSamples += samples;
    //   userSamples += samples;
    } else if (frame.kind === "library" || frame.kind === "user") {
      librarySamples += samples;
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
  const workloadShare =
    topProcess?.cpuPercent !== undefined
      ? Math.round(topProcess.cpuPercent)
      : Math.round(top.sharePct ?? 0);

  const transition = topSync?.label ?? topKernel?.label;
  const waiting =
    (kernelPct ?? 0) >= 50 &&
    Boolean(transition && /nanosleep|futex|epoll|park|schedule|wait/i.test(transition));

  const headline = waiting
    ? "Likely waiting workload"
    : (kernelPct ?? 0) >= 55
      ? "Kernel-heavy profile"
      : (userPct ?? 0) >= 65
        ? "Userspace-heavy profile"
        : "Mixed CPU profile";

  const reasoning: string[] = [];
  if (workloadShare > 0) {
    reasoning.push(`${workloadShare}% of samples belong to ${workloadLabel}`);
  }
  if (kernelPct !== undefined) {
    reasoning.push(`${kernelPct}% crossed the syscall boundary`);
  }
  if (transition) {
    reasoning.push(`Dominant kernel path: ${transition}()`);
  }
  if ((userPct ?? 100) < 45 || appSamples < runtimeSamples) {
    reasoning.push("Little application CPU observed");
  } else if (appSamples > 0) {
    reasoning.push("Application frames are present in userspace samples");
  }

  const interpretation = waiting
    ? "This workload appears to spend most of its time waiting rather than performing active computation."
    : (kernelPct ?? 0) >= 55
      ? "Most sampled time is in the kernel. Start from the dominant syscall path before assuming an application CPU burn."
      : "Userspace frames dominate this sample. Focus on the hottest application or runtime frames first.";

  const evidence: InvestigationEvidence[] = [];
  if (kernelPct !== undefined) {
    evidence.push({
      id: "kernel-share",
      text: `~${kernelPct}% of sampled execution crossed into the kernel`,
      action: "kernel-only",
    });
  }
  if (transition) {
    evidence.push({
      id: "sync-transition",
      text: `Dominant transition through ${transition}()`,
      action: "focus-label",
      focusLabel: transition,
    });
  }
  if ((userPct ?? 100) < 45) {
    evidence.push({
      id: "limited-app",
      text: "Limited application CPU observed in this sample set",
      action: "userspace-only",
    });
  }

  let confidence: InvestigationConfidence = "Medium";
  if (evidence.length >= 3 && workloadShare >= 25) {
    confidence = "High";
  } else if (evidence.length <= 1 || workloadShare < 12) {
    confidence = "Low";
  }

  const questions: InvestigationQuestion[] = [
    {
      id: "what",
      question: "What happened?",
      answer:
        workloadShare > 0
          ? `Most sampled CPU belonged to ${workloadLabel}.`
          : "A dominant workload owner is not clear from this sample.",
    },
    {
      id: "cpu-bound",
      question: "Is this CPU bound?",
      answer: waiting
        ? "Probably not. Workers spent most time sleeping or waiting."
        : (userPct ?? 0) >= 65
          ? "Possibly. Userspace frames dominate — check for active computation paths."
          : "Unclear. Kernel and userspace share are mixed in this window.",
    },
    {
      id: "kernel-busy",
      question: "Is the kernel busy?",
      answer:
        kernelPct === undefined
          ? "Not enough kernel samples to say."
          : kernelPct >= 55
            ? `Moderately to heavily. Most kernel time entered through ${transition ?? "syscall paths"}().`
            : `Lightly. Only ~${kernelPct}% of samples crossed into the kernel.`,
    },
    {
      id: "investigate-app",
      question: "Should I investigate the application?",
      answer: waiting
        ? "Not first. Start with scheduling, timers, or worker behaviour."
        : (userPct ?? 0) >= 65
          ? "Yes — application or runtime frames look like the primary cost."
          : "Maybe second. Confirm the kernel path, then return to app frames if needed.",
    },
  ];

  const nextSteps: InvestigationNextStep[] = [];
  if (workloadLabel.toLowerCase().includes("node")) {
    nextSteps.push({
      id: "node-workers",
      label: "Investigate Node.js worker behaviour",
      hint: "Timers, idle workers, and libuv waits",
      action: "focus-label",
      focusLabel: transition,
    });
  } else {
    nextSteps.push({
      id: "workload",
      label: `Inspect ${workloadLabel}`,
      hint: "Top process owning sampled CPU",
      action: "focus-label",
      focusLabel: topProcess?.name ?? top.label,
    });
  }
  if (transition) {
    nextSteps.push({
      id: "kernel-path",
      label: `Focus ${transition}()`,
      hint: "Dominant kernel transition",
      action: "focus-label",
      focusLabel: transition,
    });
  }
  nextSteps.push(
    {
      id: "scheduler",
      label: "Inspect scheduler / wait paths",
      hint: "Kernel-only layer filter",
      action: "kernel-only",
    },
    {
      id: "memory",
      label: "Open memory profile",
      hint: "Cross-check RSS and reclaim",
      action: "navigate",
      nav: "memory",
    },
    {
      id: "network",
      label: "Inspect TCP / network activity",
      hint: "Related service-map hops",
      action: "navigate",
      nav: "network",
    },
  );

  const pickLayer = (
    layer: LayeredHotspot["layer"],
    predicate: (frame: ProfileStackFrame) => boolean,
  ): LayeredHotspot | null => {
    const frame = scored.find(predicate);
    if (!frame) {
      return null;
    }
    return {
      id: `${layer}-${frame.label}`,
      layer,
      label: frame.label,
      sharePct: Math.round(frame.sharePct ?? 0),
      focusLabel: frame.label,
    };
  };

  const hotspots = [
    pickLayer(
      "Application",
      (frame) => frame.kind === "app",
      // (frame) => frame.kind === "app" || frame.kind === "application",
    ),
    pickLayer("Runtime", (frame) => frame.kind === "runtime"),
    pickLayer(
      "Libraries",
      (frame) => frame.kind === "library" || frame.kind === "user",
    ),
    pickLayer(
      "Kernel",
      (frame) =>
        frame.kind === "kernel" &&
        !/^(el0|do_el0|invoke_syscall|entry_syscall)/i.test(frame.label),
    ),
  ].filter((item): item is LayeredHotspot => item !== null);

  // Prefer a second kernel hotspot when available.
  const secondKernel = scored.find(
    (frame) =>
      frame.kind === "kernel" &&
      hotspots[hotspots.length - 1]?.focusLabel !== frame.label &&
      !/^(el0|do_el0|invoke_syscall|entry_syscall)/i.test(frame.label),
  );
  if (secondKernel && hotspots.filter((item) => item.layer === "Kernel").length < 2) {
    hotspots.push({
      id: `Kernel-${secondKernel.label}-2`,
      layer: "Kernel",
      label: secondKernel.label,
      sharePct: Math.round(secondKernel.sharePct ?? 0),
      focusLabel: secondKernel.label,
    });
  }

  const root = frames.find((frame) => isRootCpuFrame(frame));
  const sampleCount = root?.samples;
  const hasKernel = frames.some((frame) => frame.kind === "kernel");
  const hasUser = frames.some(
    (frame) =>
      frame.kind === "app" ||
      frame.kind === "runtime" ||
      frame.kind === "library" ||
      frame.kind === "user",
  );
  const hasPid = Boolean(topProcess?.pid);
  const hasPod = Boolean(topProcess?.pod);

  let stars = 3;
  if (sampleCount !== undefined && sampleCount >= 100_000) {
    stars += 1;
  }
  if (hasKernel && hasUser) {
    stars += 1;
  }
  if (!hasUser) {
    stars -= 1;
  }
  stars = Math.max(1, Math.min(5, stars));

  const qualityNotes: string[] = [];
  if (!hasUser) {
    qualityNotes.push("Userspace stacks look thin — frame pointers may be missing");
  } else if (runtimeSamples > appSamples * 3 && appSamples > 0) {
    qualityNotes.push("Runtime frames dominate application symbols");
  }
  if (sampleCount !== undefined && sampleCount < 10_000) {
    qualityNotes.push(
      `Short or sparse sample window (${formatSampleCount(sampleCount)} samples) — treat conclusions lightly`,
    );
  }

  const quality: ProfileQuality = {
    stars,
    samples: sampleCount,
    windowSeconds: options?.windowSeconds,
    sampleHz: options?.sampleHz,
    kernelStacks: hasKernel ? "ok" : "missing",
    userspaceStacks: hasUser ? (appSamples > 0 ? "ok" : "partial") : "missing",
    pidAttribution: hasPid ? "ok" : "partial",
    podAttribution: hasPod ? "ok" : "partial",
    notes: qualityNotes,
  };

  return {
    headline,
    confidence,
    reasoning,
    interpretation,
    evidence,
    questions,
    nextSteps,
    hotspots,
    quality,
    focusLabel: transition ?? top.label,
    workloadLabel,
  };
}

/** Explain a selected stack frame in plain engineering language. */
export function explainStackFrame(frame: ProfileStackFrame): FrameExplanation {
  const label = frame.label;
  const lower = label.toLowerCase();

  if (/nanosleep|usleep|clock_nanosleep/.test(lower)) {
    return {
      title: label,
      what: "Workers are voluntarily sleeping via a timer syscall.",
      commonReasons: ["timers", "retry backoff", "idle workers", "polling intervals"],
      docsHint: "Usually not active CPU burn — look at who scheduled the sleep.",
    };
  }
  if (/futex|pthread_cond|mutex|rwlock/.test(lower)) {
    return {
      title: label,
      what: "Thread synchronization. The CPU switched away while waiting on a lock or condition.",
      commonReasons: ["lock contention", "blocked workers", "producer/consumer waits"],
    };
  }
  if (/epoll_wait|poll|select|io_uring/.test(lower)) {
    return {
      title: label,
      what: "Event wait. The process is blocked until file descriptors become ready.",
      commonReasons: ["network I/O", "idle event loops", "waiting on sockets"],
    };
  }
  if (/^schedule$|pick_next|__schedule/.test(lower)) {
    return {
      title: label,
      what: "Linux scheduler. The CPU switched execution away from the current thread.",
      commonReasons: ["sleeping", "blocking", "waiting on I/O", "waiting on a mutex"],
    };
  }
  if (/tcp_|udp_|sock_|recvmsg|sendmsg|netif/.test(lower)) {
    return {
      title: label,
      what: "Network stack path inside the kernel.",
      commonReasons: ["packet processing", "socket reads/writes", "network-bound work"],
    };
  }
  if (/do_el0_svc|invoke_syscall|el0t_64/.test(lower)) {
    return {
      title: label,
      what: "Syscall boundary. Userspace asked the kernel to perform privileged work.",
      commonReasons: ["normal syscall entry", "not itself a root cause"],
      docsHint: "Look at the frames above/below for the actual wait or I/O path.",
    };
  }
  if (frame.kind === "runtime" || /v8|libuv|jvm|runtime\./i.test(lower)) {
    return {
      title: label,
      what: "Language runtime machinery (GC, event loop, interpreter, or JIT).",
      commonReasons: ["runtime overhead", "GC pressure", "event-loop waits"],
    };
  }
  if (frame.kind === "app") {
  // if (frame.kind === "app" || frame.kind === "application") {
    return {
      title: label,
      what: "Likely application or process-level code on the sampled path.",
      commonReasons: ["business logic", "request handling", "process entry"],
    };
  }
  if (frame.kind === "library") {
    return {
      title: label,
      what: "Shared library code used by the process.",
      commonReasons: ["libc helpers", "compression", "crypto", "allocator paths"],
    };
  }
  if (frame.kind === "kernel") {
    return {
      title: label,
      what: "Kernel frame from the sampled stack.",
      commonReasons: ["syscall work", "scheduling", "drivers", "memory management"],
    };
  }
  return {
    title: label,
    what: "Stack frame from the sampled profile.",
    commonReasons: ["part of the observed execution path"],
  };
}
