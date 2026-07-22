import type {
  NodeProfileDetail,
  ProfileLogLine,
  ProfileMetric,
  ProfileStackFrame,
  TimelineEvent,
} from "../../core/types/profiling";
import { podMatchesInvestigation } from "./resolve-node";
import type { InvestigationFocus } from "./types";

function focusNames(focus: Pick<InvestigationFocus, "name" | "memberPods" | "pod">): string[] {
  const names = [focus.name, ...(focus.memberPods ?? [])];
  if (focus.pod) {
    names.push(focus.pod);
  }
  return names;
}

function textMentionsFocus(
  text: string | undefined,
  focus: Pick<InvestigationFocus, "name" | "namespace" | "memberPods" | "pod" | "pid" | "processName">,
): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  if (focus.pid !== undefined) {
    if (lower.includes(`pid ${focus.pid}`) || lower.includes(`pid=${focus.pid}`)) {
      return true;
    }
    if (focus.processName && lower.includes(focus.processName.toLowerCase())) {
      return true;
    }
  }
  if (focus.pod && lower.includes(focus.pod.toLowerCase())) {
    return true;
  }
  const names = focusNames(focus);
  if (names.some((name) => lower.includes(name.toLowerCase()))) {
    return true;
  }
  if (focus.namespace) {
    const needle = `${focus.namespace}/${focus.name}`.toLowerCase();
    if (lower.includes(needle)) {
      return true;
    }
  }
  return false;
}

function frameMatchesFocus(
  frame: ProfileStackFrame,
  focus: Pick<InvestigationFocus, "name" | "namespace" | "memberPods" | "pod" | "pid" | "processName">,
): boolean {
  if (focus.pod) {
    if (podMatchesInvestigation(frame.label, frame.namespace, { ...focus, name: focus.pod })) {
      return true;
    }
    if (frame.subtitle?.toLowerCase().includes(focus.pod.toLowerCase())) {
      return true;
    }
  }
  if (podMatchesInvestigation(frame.label, frame.namespace, focus)) {
    return true;
  }
  if (
    frame.subtitle &&
    podMatchesInvestigation(frame.subtitle.split(/[·|]/)[0]?.trim() ?? "", frame.namespace, focus)
  ) {
    return true;
  }
  if (textMentionsFocus(frame.path, focus) || textMentionsFocus(frame.subtitle, focus)) {
    return true;
  }
  return false;
}

/**
 * Keep root + ancestors of frames that belong to the investigated workload.
 * Network flame is usually: stack → protocol → destination → source workload.
 */
export function filterNetworkStackForFocus(
  frames: ProfileStackFrame[],
  focus: Pick<
    InvestigationFocus,
    "name" | "namespace" | "memberPods" | "pod" | "pid" | "processName" | "level"
  > | null | undefined,
): ProfileStackFrame[] {
  if (!focus?.name || frames.length === 0) {
    return frames;
  }

  const matching = frames.filter((frame) => frameMatchesFocus(frame, focus));
  if (matching.length === 0) {
    // Keep root only so the tab isn't a blank void — empty state is clearer than wrong data.
    return frames.filter((frame) => frame.depth === 0);
  }

  const keep = new Set<ProfileStackFrame>();
  for (const hit of matching) {
    keep.add(hit);
    for (const ancestor of frames) {
      if (
        ancestor.depth < hit.depth &&
        hit.offset >= ancestor.offset - 0.0001 &&
        hit.offset + hit.width <= ancestor.offset + ancestor.width + 0.0001
      ) {
        keep.add(ancestor);
      }
    }
  }
  return frames.filter((frame) => keep.has(frame));
}

export function filterTimelineForFocus(
  events: TimelineEvent[],
  focus: Pick<
    InvestigationFocus,
    "name" | "namespace" | "memberPods" | "pod" | "pid" | "processName"
  > | null | undefined,
): TimelineEvent[] {
  if (!focus?.name) {
    return events;
  }
  return events.filter(
    (event) =>
      textMentionsFocus(event.title, focus) || textMentionsFocus(event.detail, focus),
  );
}

export function filterNetworkLogForFocus(
  lines: ProfileLogLine[],
  focus: Pick<
    InvestigationFocus,
    "name" | "namespace" | "memberPods" | "pod" | "pid" | "processName"
  > | null | undefined,
): ProfileLogLine[] {
  if (!focus?.name) {
    return lines;
  }
  return lines.filter(
    (line) =>
      textMentionsFocus(line.event, focus) ||
      textMentionsFocus(line.value, focus) ||
      textMentionsFocus(line.severity, focus),
  );
}

/** Rough metrics from scoped network frames (not the full node rollup). */
export function networkMetricsFromScopedStack(frames: ProfileStackFrame[]): ProfileMetric[] {
  const interesting = frames.filter((frame) => frame.depth >= 1);
  const latencies = interesting
    .map((frame) => frame.latencyMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const flows = interesting.reduce((sum, frame) => sum + (frame.flowCount ?? 0), 0);
  const drops = 0;
  const p50 =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : undefined;
  const p95 =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : undefined;

  const spark = (value: number) => [
    Math.max(4, Math.round(value)),
    Math.max(4, Math.round(value * 0.95)),
    Math.max(4, Math.round(value * 1.02)),
    Math.max(4, Math.round(value)),
    Math.max(4, Math.round(value * 0.98)),
    Math.max(4, Math.round(value)),
  ];

  return [
    {
      label: "P50",
      value: p50 !== undefined ? `${Math.round(p50)}ms` : "—",
      tone: "ok",
      sparkline: spark(p50 ?? 4),
    },
    {
      label: "P95",
      value: p95 !== undefined ? `${Math.round(p95)}ms` : "—",
      tone: (p95 ?? 0) >= 80 ? "warn" : "ok",
      sparkline: spark(p95 ?? 4),
    },
    {
      label: "Drops",
      value: String(drops),
      tone: "ok",
      sparkline: spark(4),
    },
    {
      label: "Flows",
      value: String(flows || interesting.length),
      tone: "ok",
      sparkline: spark(Math.max(4, flows || interesting.length)),
    },
  ];
}

/** Apply workload investigation focus across profiler detail surfaces. */
export function filterDetailForWorkloadFocus(
  detail: NodeProfileDetail,
  focus: InvestigationFocus | null | undefined,
): Pick<NodeProfileDetail, "stack" | "log" | "timeline"> & {
  networkMetrics: ProfileMetric[];
} {
  if (!focus?.name) {
    return {
      stack: detail.stack,
      log: detail.log,
      timeline: detail.timeline,
      networkMetrics: detail.metrics.filter((metric) =>
        ["P50", "P95", "Drops", "Flows/s", "Flows"].includes(metric.label),
      ),
    };
  }

  const stack = filterNetworkStackForFocus(detail.stack, focus);
  return {
    stack,
    log: filterNetworkLogForFocus(detail.log, focus),
    timeline: filterTimelineForFocus(detail.timeline, focus),
    networkMetrics: networkMetricsFromScopedStack(stack),
  };
}
