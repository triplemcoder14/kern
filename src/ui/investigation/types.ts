import type { NavId, NavPage } from "../components/AppShell";

/** How far back retained data is included when an investigation starts. */
export type InvestigationWindow = "5m" | "15m" | "1h";

/**
 * How deep the workload investigation is focused.
 * Collection stays node-level; this only narrows presentation.
 */
export type InvestigationLevel = "workload" | "pod" | "process";

/** Persistent cross-page focus started from Service Map (or elsewhere). */
export interface InvestigationFocus {
  kind: "Service" | "Workload" | "Pod" | "Namespace";
  name: string;
  namespace: string;
  /** Pod names belonging to this service/workload when known. */
  memberPods?: string[];
  /** Node where the workload is scheduled (resolved when known). */
  nodeName?: string;
  /** Drill-down depth within the workload investigation. */
  level?: InvestigationLevel;
  /** Selected pod name when level is pod or process. */
  pod?: string;
  /** Selected process PID when level is process. */
  pid?: number;
  /** Process display name when known. */
  processName?: string;
  clusterName: string;
  startedFrom: string;
  /** When the user entered investigation mode (not the data window start). */
  startedAt: number;
  /** Retained lookback for historical + live hybrid queries. */
  window: InvestigationWindow;
  /** Keep appending matching live events after the historical load. */
  live: boolean;
}

export type InvestigateTarget =
  | { nav: "profiling"; page: "profiling"; label: string }
  | { nav: "network"; page: "network-dns"; label: string }
  | { nav: "network"; page: "network-tcp"; label: string }
  | { nav: "network"; page: "network-flows"; label: string }
  | { nav: "network"; page: "network-map"; label: string }
  | { nav: "events"; page: "events"; label: string };

export const INVESTIGATE_ACTIONS: InvestigateTarget[] = [
  { nav: "profiling", page: "profiling", label: "Investigate CPU" },
  { nav: "network", page: "network-dns", label: "Investigate DNS" },
  { nav: "network", page: "network-tcp", label: "Investigate TCP" },
  { nav: "network", page: "network-flows", label: "Investigate Flows" },
  { nav: "events", page: "events", label: "View Timeline" },
  { nav: "network", page: "network-map", label: "View Map" },
];

export const DEFAULT_INVESTIGATION_WINDOW: InvestigationWindow = "15m";

export function investigationLabel(focus: InvestigationFocus): string {
  if (focus.kind === "Namespace") {
    return focus.namespace || focus.name;
  }
  return focus.namespace ? `${focus.namespace}/${focus.name}` : focus.name;
}

export function investigationLevel(focus: InvestigationFocus): InvestigationLevel {
  return focus.level ?? "workload";
}

export function investigationStartedAgo(focus: InvestigationFocus, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - focus.startedAt) / 60_000));
  if (minutes <= 0) {
    return "just now";
  }
  if (minutes === 1) {
    return "1 minute ago";
  }
  return `${minutes} minutes ago`;
}

export function investigationWindowMs(window: InvestigationWindow): number {
  if (window === "5m") {
    return 5 * 60_000;
  }
  if (window === "1h") {
    return 60 * 60_000;
  }
  return 15 * 60_000;
}

export function investigationWindowLabel(window: InvestigationWindow): string {
  if (window === "5m") {
    return "Last 5 minutes";
  }
  if (window === "1h") {
    return "Last 1 hour";
  }
  return "Last 15 minutes";
}

/** Narrow focus to a pod under the same workload investigation. */
export function drillToPod(focus: InvestigationFocus, pod: string): InvestigationFocus {
  return {
    ...focus,
    level: "pod",
    pod,
    pid: undefined,
    processName: undefined,
  };
}

/** Narrow focus to a process under the current pod/workload. */
export function drillToProcess(
  focus: InvestigationFocus,
  pid: number,
  processName?: string,
  pod?: string,
): InvestigationFocus {
  return {
    ...focus,
    level: "process",
    pod: pod ?? focus.pod,
    pid,
    processName,
  };
}

/** Climb back to workload / pod level via breadcrumb. */
export function climbInvestigation(
  focus: InvestigationFocus,
  level: InvestigationLevel,
): InvestigationFocus {
  if (level === "workload") {
    return {
      ...focus,
      level: "workload",
      pod: undefined,
      pid: undefined,
      processName: undefined,
    };
  }
  if (level === "pod") {
    return {
      ...focus,
      level: "pod",
      pid: undefined,
      processName: undefined,
    };
  }
  return { ...focus, level: "process" };
}

export type StartInvestigation = (
  focus: Omit<InvestigationFocus, "startedAt" | "clusterName" | "window" | "live"> & {
    clusterName?: string;
    window?: InvestigationWindow;
    live?: boolean;
    nodeName?: string;
    level?: InvestigationLevel;
  },
  dest?: { nav: NavId; page: NavPage },
) => void;
