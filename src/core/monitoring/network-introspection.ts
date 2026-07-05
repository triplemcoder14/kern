import type { MonitorEvent, MonitorSeverity, NetworkTalkKind, NetworkTalkMeta } from "../types/monitoring";
import type { FlowVerdict, NetworkFlow, NetworkSnapshot } from "../types/network";

interface TalkState {
  verdict: FlowVerdict;
  latencyMs?: number;
  lastSeen: string;
}

function endpointLabel(kind: string, name: string, namespace?: string): string {
  return `${kind}/${namespace ?? "default"}/${name}`;
}

export function talkKey(flow: NetworkFlow): string {
  return [
    endpointLabel(flow.src.kind, flow.src.name, flow.src.namespace),
    endpointLabel(flow.dst.kind, flow.dst.name, flow.dst.namespace),
    flow.protocol,
    flow.port,
  ].join("->");
}

export function flowPath(flow: NetworkFlow): string {
  return (
    flow.path ??
    `${flow.src.kind}/${flow.src.name} → ${flow.dst.kind}/${flow.dst.name}`
  );
}

function verdictRank(verdict: FlowVerdict): number {
  if (verdict === "OK") {
    return 0;
  }
  if (verdict === "UNKNOWN" || verdict === "RETRY") {
    return 1;
  }
  if (verdict === "TIMEOUT") {
    return 2;
  }
  return 3;
}

function severityForKind(kind: NetworkTalkKind, verdict: FlowVerdict): MonitorSeverity {
  if (kind === "degraded") {
    return verdict === "DROPPED" ? "critical" : "warning";
  }
  return "info";
}

function titleForKind(kind: NetworkTalkKind): string {
  switch (kind) {
    case "started":
      return "Talk started";
    case "degraded":
      return "Talk degraded";
    case "ended":
      return "Talk ended";
  }
}

function messageForTalk(flow: NetworkFlow, kind: NetworkTalkKind): string {
  const path = flowPath(flow);
  const detail = `${flow.protocol}:${flow.port}${flow.latencyMs !== undefined ? ` · ${flow.latencyMs}ms` : ""} · ${flow.verdict}`;

  switch (kind) {
    case "started":
      return `${path} — ${detail}`;
    case "degraded":
      return `${path} — condition worsened (${detail})`;
    case "ended":
      return `${path} — no longer observed`;
  }
}

function toTalkMeta(flow: NetworkFlow, kind: NetworkTalkKind): NetworkTalkMeta {
  return {
    kind,
    talkKey: talkKey(flow),
    path: flowPath(flow),
    protocol: flow.protocol,
    port: flow.port,
    verdict: flow.verdict,
    latencyMs: flow.latencyMs,
    srcKind: flow.src.kind,
    srcName: flow.src.name,
    srcNamespace: flow.src.namespace,
    dstKind: flow.dst.kind,
    dstName: flow.dst.name,
    dstNamespace: flow.dst.namespace,
  };
}

export function networkTalkEvent(flow: NetworkFlow, kind: NetworkTalkKind): MonitorEvent {
  const key = talkKey(flow);
  const timestamp = flow.lastSeen ?? flow.timestamp;

  return {
    id: `talk-${kind}-${key}-${timestamp}`,
    timestamp,
    severity: severityForKind(kind, flow.verdict),
    category: "network",
    title: titleForKind(kind),
    message: messageForTalk(flow, kind),
    namespace: flow.dst.namespace ?? flow.src.namespace,
    resourceKind: flow.dst.kind,
    resourceName: flow.dst.name,
    source: "network-introspection",
    networkTalk: toTalkMeta(flow, kind),
  };
}

export class NetworkIntrospectionEngine {
  private talks = new Map<string, TalkState>();

  reset(): void {
    this.talks.clear();
  }

  observe(snapshot: NetworkSnapshot, previous: NetworkSnapshot | null): MonitorEvent[] {
    const events: MonitorEvent[] = [];
    const seen = new Set<string>();

    for (const flow of snapshot.flows) {
      if (flow.src.kind === "External" && flow.dst.kind === "External") {
        continue;
      }

      const key = talkKey(flow);
      seen.add(key);
      const prior = this.talks.get(key);
      const nextState: TalkState = {
        verdict: flow.verdict,
        latencyMs: flow.latencyMs,
        lastSeen: flow.lastSeen ?? flow.timestamp,
      };

      if (!prior) {
        events.push(networkTalkEvent(flow, "started"));
      } else if (verdictRank(flow.verdict) > verdictRank(prior.verdict)) {
        events.push(networkTalkEvent(flow, "degraded"));
      } else if (
        prior.latencyMs !== undefined &&
        flow.latencyMs !== undefined &&
        flow.latencyMs >= prior.latencyMs * 2 &&
        flow.latencyMs >= 120
      ) {
        events.push(networkTalkEvent(flow, "degraded"));
      }

      this.talks.set(key, nextState);
    }

    if (previous) {
      for (const flow of previous.flows) {
        const key = talkKey(flow);
        if (!seen.has(key) && this.talks.has(key)) {
          events.push(networkTalkEvent(flow, "ended"));
          this.talks.delete(key);
        }
      }
    }

    return events;
  }
}
