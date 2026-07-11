import type { MonitorSeverity } from "../types/monitoring";

export interface DeclarativeAlertRule {
  id: string;
  enabled: boolean;
  type: "latency" | "drop" | "timeout" | "silence" | "spike";
  severity: MonitorSeverity;
  threshold?: {
    latencyMs?: number;
    spikeFactor?: number;
    minPriorFlows?: number;
  };
  match?: {
    namespace?: string;
    pathContains?: string;
    verdict?: string;
  };
  title?: string;
  cause?: string;
}

export function parseDeclarativeAlertRules(raw: string | undefined): DeclarativeAlertRule[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as DeclarativeAlertRule[];
    return Array.isArray(parsed) ? parsed.filter((rule) => rule.enabled !== false) : [];
  } catch {
    return [];
  }
}
