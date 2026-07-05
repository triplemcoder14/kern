import { networkTalkEvent } from "../../core/monitoring/network-introspection";
import type { NetworkFlow } from "../../core/types/network";
import type { MonitorEvent } from "../../core/types/monitoring";

export type SimulatedTalkVariant = "warning" | "critical";

function mockFlow(variant: SimulatedTalkVariant): NetworkFlow {
  const now = new Date().toISOString();
  const critical = variant === "critical";

  return {
    id: `sim-${Date.now()}`,
    timestamp: now,
    lastSeen: now,
    path: "Pod/frontend-sim/default → Service/backend-sim/default",
    source: "ebpf",
    src: { kind: "Pod", name: "frontend-sim", namespace: "default" },
    dst: { kind: "Service", name: "backend-sim", namespace: "default" },
    protocol: "TCP",
    port: 8080,
    verdict: critical ? "DROPPED" : "TIMEOUT",
    latencyMs: critical ? undefined : 240,
  };
}

export function simulateDegradedTalkEvent(variant: SimulatedTalkVariant): MonitorEvent {
  return networkTalkEvent(mockFlow(variant), "degraded");
}
