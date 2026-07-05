import type { Incident, MonitorSeverity } from "../types/monitoring";
import type { NetworkEdge, NetworkFlow, NetworkSnapshot } from "../types/network";

const LATENCY_WARNING_MS = 120;
const LATENCY_CRITICAL_MS = 250;
const SPIKE_FACTOR = 3;

export interface FlowAlertCandidate {
  ruleId: string;
  severity: MonitorSeverity;
  title: string;
  summary: string;
  cause: string;
  path?: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
}

function edgePath(edge: NetworkEdge, snapshot: NetworkSnapshot): string | undefined {
  const from = snapshot.topology.nodes.find((node) => node.id === edge.from);
  const to = snapshot.topology.nodes.find((node) => node.id === edge.to);
  if (!from || !to) {
    return edge.label;
  }
  return `${from.kind}/${from.namespace}/${from.name} → ${to.kind}/${to.namespace}/${to.name}`;
}

function flowPath(flow: NetworkFlow): string | undefined {
  return (
    flow.path ??
    `${flow.src.kind}/${flow.src.namespace ?? "default"}/${flow.src.name} → ${flow.dst.kind}/${flow.dst.namespace ?? "default"}/${flow.dst.name}`
  );
}

export function evaluateFlowAlerts(
  current: NetworkSnapshot,
  previous: NetworkSnapshot | null,
): FlowAlertCandidate[] {
  const alerts: FlowAlertCandidate[] = [];
  const seen = new Set<string>();

  const push = (alert: FlowAlertCandidate) => {
    if (seen.has(alert.ruleId)) {
      return;
    }
    seen.add(alert.ruleId);
    alerts.push(alert);
  };

  for (const flow of current.flows) {
    const path = flowPath(flow);
    const namespace = flow.dst.namespace ?? flow.src.namespace;

    if (flow.verdict === "DROPPED") {
      push({
        ruleId: `drop:${path}:${flow.port}`,
        severity: "critical",
        title: "Dropped packets",
        summary: `${flow.protocol}:${flow.port} dropped on ${path ?? "unknown path"}`,
        cause:
          "Traffic was dropped on this path — check NetworkPolicy, CNI drops, or conntrack limits.",
        path,
        namespace,
        resourceKind: flow.dst.kind,
        resourceName: flow.dst.name,
      });
    }

    if (flow.verdict === "TIMEOUT" || flow.verdict === "RETRY") {
      push({
        ruleId: `timeout:${path}:${flow.port}`,
        severity: "warning",
        title: "Connection timeout",
        summary: `${flow.protocol}:${flow.port} timing out on ${path ?? "unknown path"}`,
        cause:
          "Connections are failing or retrying — verify target pod readiness, service endpoints, and DNS.",
        path,
        namespace,
        resourceKind: flow.dst.kind,
        resourceName: flow.dst.name,
      });
    }

    if ((flow.latencyMs ?? 0) >= LATENCY_CRITICAL_MS) {
      push({
        ruleId: `latency-critical:${path}:${flow.port}`,
        severity: "critical",
        title: "High latency",
        summary: `${flow.latencyMs}ms on ${path ?? "unknown path"} (${flow.protocol}:${flow.port})`,
        cause:
          "Round-trip latency is elevated — inspect upstream service load, DNS, or node network saturation.",
        path,
        namespace,
        resourceKind: flow.dst.kind,
        resourceName: flow.dst.name,
      });
    } else if ((flow.latencyMs ?? 0) >= LATENCY_WARNING_MS) {
      push({
        ruleId: `latency-warning:${path}:${flow.port}`,
        severity: "warning",
        title: "Elevated latency",
        summary: `${flow.latencyMs}ms on ${path ?? "unknown path"} (${flow.protocol}:${flow.port})`,
        cause: "Latency is above baseline — watch for saturation or retry storms on this path.",
        path,
        namespace,
        resourceKind: flow.dst.kind,
        resourceName: flow.dst.name,
      });
    }
  }

  for (const edge of current.topology.edges) {
    const path = edgePath(edge, current);
    const to = current.topology.nodes.find((node) => node.id === edge.to);

    if (edge.verdict === "DROPPED" || edge.verdict === "TIMEOUT") {
      push({
        ruleId: `edge-bad:${edge.id}`,
        severity: edge.verdict === "DROPPED" ? "critical" : "warning",
        title: `Unhealthy link (${edge.verdict})`,
        summary: `${edge.label} · ${edge.protocol}:${edge.port}`,
        cause:
          edge.verdict === "DROPPED"
            ? "Aggregated flows on this link show drops — validate policies and backend health."
            : "Aggregated flows on this link show timeouts — check service endpoints and pod logs.",
        path,
        namespace: to?.namespace,
        resourceKind: to?.kind,
        resourceName: to?.name,
      });
    }

    const p95 = edge.latencyP95Ms ?? edge.latencyAvgMs ?? 0;
    if (p95 >= LATENCY_CRITICAL_MS) {
      push({
        ruleId: `edge-latency:${edge.id}`,
        severity: "warning",
        title: "Slow service path",
        summary: `P95 ${p95}ms on ${edge.label}`,
        cause: "Service path latency is high — compare talkers on this edge and check downstream pods.",
        path,
        namespace: to?.namespace,
        resourceKind: to?.kind,
        resourceName: to?.name,
      });
    }

    if (previous) {
      const prevEdge = previous.topology.edges.find((item) => item.id === edge.id);
      if (prevEdge && prevEdge.flowCount >= 3 && edge.flowCount >= prevEdge.flowCount * SPIKE_FACTOR) {
        push({
          ruleId: `spike:${edge.id}`,
          severity: "warning",
          title: "Traffic spike",
          summary: `${edge.flowCount} flows on ${edge.label} (was ${prevEdge.flowCount})`,
          cause:
            "Sudden increase in flow count — investigate new clients, retry loops, or missing rate limits.",
          path,
          namespace: to?.namespace,
          resourceKind: to?.kind,
          resourceName: to?.name,
        });
      }

      if (prevEdge && prevEdge.flowCount >= 5 && edge.flowCount === 0) {
        push({
          ruleId: `silence:${edge.id}`,
          severity: "warning",
          title: "Traffic stopped",
          summary: `No recent flows on ${edge.label}`,
          cause:
            "Previously active path went silent — client may have failed over or upstream is unreachable.",
          path,
          namespace: to?.namespace,
          resourceKind: to?.kind,
          resourceName: to?.name,
        });
      }
    }
  }

  return alerts;
}

export function incidentFromFlowAlert(alert: FlowAlertCandidate): Incident {
  const now = new Date().toISOString();
  return {
    id: `incident-flow-${alert.ruleId.replace(/[^a-zA-Z0-9:_-]+/g, "-")}`,
    openedAt: now,
    updatedAt: now,
    severity: alert.severity,
    category: "network",
    title: alert.title,
    summary: alert.summary,
    namespace: alert.namespace,
    resourceKind: alert.resourceKind,
    resourceName: alert.resourceName,
    status: "open",
    eventIds: [],
    alertSource: "flow",
    ruleId: alert.ruleId,
    path: alert.path,
    cause: alert.cause,
  };
}

export function mergeFlowIncident(existing: Incident, alert: FlowAlertCandidate): Incident {
  return {
    ...existing,
    updatedAt: new Date().toISOString(),
    severity: alert.severity === "critical" ? "critical" : existing.severity,
    summary: alert.summary,
    path: alert.path ?? existing.path,
    cause: alert.cause,
  };
}
