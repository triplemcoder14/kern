import type {
  K8sEndpointsObject,
  K8sPodObject,
  K8sServiceObject,
} from "../k8s-api/client";
import type {
  FlowVerdict,
  NetworkEdge,
  NetworkFlow,
  NetworkNode,
  NetworkTopology,
} from "../types/network";
import { computeLatencyStats, edgeLatencyVerdict } from "./latency";

function nodeId(kind: string, namespace: string, name: string): string {
  return `${kind}/${namespace}/${name}`;
}

function podStatus(pod: K8sPodObject): NetworkNode["status"] {
  const phase = pod.status?.phase;
  if (phase === "Running") {
    return "healthy";
  }
  if (phase === "Failed" || phase === "Pending") {
    return "degraded";
  }
  return "unknown";
}

function servicePorts(service: K8sServiceObject): number[] {
  return (service.spec?.ports ?? []).map((port) => port.port);
}

export function buildTopology(
  pods: K8sPodObject[],
  services: K8sServiceObject[],
  endpoints: K8sEndpointsObject[],
): NetworkTopology {
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  const podByIp = new Map<string, K8sPodObject>();

  for (const pod of pods) {
    const namespace = pod.metadata.namespace ?? "default";
    const ip = pod.status?.podIP;
    if (!ip) {
      continue;
    }
    podByIp.set(ip, pod);
    nodes.push({
      id: nodeId("Pod", namespace, pod.metadata.name),
      kind: "Pod",
      name: pod.metadata.name,
      namespace,
      ip,
      status: podStatus(pod),
      ports: (pod.spec?.containers ?? [])
        .flatMap((container) => container.ports ?? [])
        .map((port) => port.containerPort),
    });
  }

  const serviceByIp = new Map<string, K8sServiceObject>();
  for (const service of services) {
    const namespace = service.metadata.namespace ?? "default";
    const clusterIP = service.spec?.clusterIP;
    if (!clusterIP || clusterIP === "None") {
      continue;
    }
    serviceByIp.set(clusterIP, service);
    nodes.push({
      id: nodeId("Service", namespace, service.metadata.name),
      kind: "Service",
      name: service.metadata.name,
      namespace,
      ip: clusterIP,
      status: "healthy",
      ports: servicePorts(service),
    });
  }

  for (const endpoint of endpoints) {
    const namespace = endpoint.metadata.namespace ?? "default";
    const serviceName = endpoint.metadata.name;
    const serviceId = nodeId("Service", namespace, serviceName);
    const subsets = endpoint.subsets ?? [];

    for (const subset of subsets) {
      const addresses = subset.addresses ?? [];
      const ports = subset.ports ?? [];

      for (const address of addresses) {
        const targetIp = address.ip;
        const targetPod = targetIp ? podByIp.get(targetIp) : undefined;
        if (!targetPod) {
          continue;
        }
        const podNamespace = targetPod.metadata.namespace ?? "default";
        const podId = nodeId("Pod", podNamespace, targetPod.metadata.name);

        for (const port of ports) {
          edges.push({
            id: `${serviceId}->${podId}:${port.port}`,
            from: serviceId,
            to: podId,
            label: `${serviceName} → ${targetPod.metadata.name}`,
            protocol: port.protocol ?? "TCP",
            port: port.port ?? 0,
            verdict: podStatus(targetPod) === "healthy" ? "OK" : "DROPPED",
            flowCount: 0,
          });
        }
      }
    }
  }

  return {
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
  };
}

export function flowFromNetworkEvent(input: {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
}): NetworkFlow | null {
  const text = `${input.title} ${input.message}`.toLowerCase();
  const isNetwork =
    text.includes("network") ||
    text.includes("connection") ||
    text.includes("timeout") ||
    text.includes("dns") ||
    text.includes("probe") ||
    text.includes("endpoint") ||
    input.resourceKind === "Service";

  if (!isNetwork) {
    return null;
  }

  let verdict: FlowVerdict = "UNKNOWN";
  if (text.includes("timeout") || text.includes("failed")) {
    verdict = "TIMEOUT";
  } else if (text.includes("back-off") || text.includes("unhealthy")) {
    verdict = "DROPPED";
  } else if (text.includes("started") || text.includes("ready")) {
    verdict = "OK";
  }

  return {
    id: `k8s-flow-${input.id}`,
    timestamp: input.timestamp,
    source: "kubernetes",
    src: {
      kind: (input.resourceKind as NetworkFlow["src"]["kind"]) ?? "External",
      name: input.resourceName ?? "unknown",
      namespace: input.namespace,
    },
    dst: { kind: "Service", name: "cluster", namespace: input.namespace },
    protocol: "TCP",
    port: 0,
    verdict,
  };
}

export function aggregateEdgeMetrics(
  topology: NetworkTopology,
  flows: NetworkFlow[],
): NetworkTopology {
  const latencyByEdge = new Map<string, number[]>();
  const flowCountByEdge = new Map<string, number>();

  for (const edge of topology.edges) {
    flowCountByEdge.set(edge.id, 0);
  }

  for (const flow of flows) {
    const srcId = endpointNodeId(flow.src);
    const dstId = endpointNodeId(flow.dst);
    if (!srcId || !dstId) {
      continue;
    }

    for (const edge of topology.edges) {
      const matchesEndpoint =
        (flow.src.name && (edge.from.includes(flow.src.name) || edge.to.includes(flow.src.name))) ||
        (flow.dst.name && (edge.from.includes(flow.dst.name) || edge.to.includes(flow.dst.name)));
      const matchesRoute =
        (edge.from === srcId && edge.to === dstId) ||
        (edge.from === dstId && edge.to === srcId) ||
        matchesEndpoint;

      if (!matchesRoute) {
        continue;
      }

      flowCountByEdge.set(edge.id, (flowCountByEdge.get(edge.id) ?? 0) + 1);

      if (flow.latencyMs !== undefined) {
        const samples = latencyByEdge.get(edge.id) ?? [];
        samples.push(flow.latencyMs);
        latencyByEdge.set(edge.id, samples);
      }
    }
  }

  const edges = topology.edges.map((edge) => {
    const samples = latencyByEdge.get(edge.id) ?? [];
    const flowCount = flowCountByEdge.get(edge.id) ?? 0;
    const stats = computeLatencyStats(samples);

    if (!stats) {
      return { ...edge, flowCount };
    }

    return {
      ...edge,
      flowCount,
      latencyP50Ms: stats.p50Ms,
      latencyP95Ms: stats.p95Ms,
      latencyP99Ms: stats.p99Ms,
      latencyAvgMs: stats.avgMs,
      latencySampleCount: stats.sampleCount,
      verdict: edgeLatencyVerdict(stats.p99Ms) === "TIMEOUT" ? ("TIMEOUT" as FlowVerdict) : edge.verdict,
    };
  });

  return { ...topology, edges, updatedAt: new Date().toISOString() };
}

function endpointNodeId(endpoint: NetworkFlow["src"]): string | null {
  if (endpoint.kind !== "Pod" && endpoint.kind !== "Service") {
    return null;
  }
  if (!endpoint.name || endpoint.name === "unknown" || endpoint.name === "cluster") {
    return null;
  }
  return nodeId(endpoint.kind, endpoint.namespace ?? "default", endpoint.name);
}

export function resolveEndpoint(
  ip: string,
  topology: NetworkTopology,
): NetworkFlow["src"] {
  const node = topology.nodes.find((item) => item.ip === ip);
  if (!node) {
    return { kind: "External", name: ip, ip };
  }
  return {
    kind: node.kind,
    name: node.name,
    namespace: node.namespace,
    ip,
  };
}
