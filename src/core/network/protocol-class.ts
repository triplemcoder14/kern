/** Port-heuristic app class — overridden when payload decode is present. */
export type ProtocolClass =
  | "dns"
  | "http"
  | "grpc"
  | "postgres"
  | "mysql"
  | "redis"
  | "kafka"
  | "tcp"
  | "udp"
  | "other";

const PORT_CLASS: Record<number, ProtocolClass> = {
  53: "dns",
  80: "http",
  443: "http",
  8080: "http",
  8443: "http",
  50051: "grpc",
  5432: "postgres",
  3306: "mysql",
  6379: "redis",
  9092: "kafka",
};

export function inferProtocolClass(
  port: number,
  protocol: string,
): ProtocolClass {
  if (PORT_CLASS[port]) {
    return PORT_CLASS[port];
  }
  const proto = protocol.toUpperCase();
  if (proto === "UDP") {
    return "udp";
  }
  if (proto === "TCP") {
    return "tcp";
  }
  return "other";
}

/** Prefer decoded payload signals over port heuristics. */
export function resolveProtocolClass(flow: {
  port: number;
  protocol: string;
  dnsQuery?: string;
  httpMethod?: string;
  httpPath?: string;
  httpStatus?: number;
  grpcMethod?: string;
  grpcStatus?: number;
}): ProtocolClass {
  if (flow.grpcMethod || flow.grpcStatus !== undefined) {
    return "grpc";
  }
  if (flow.httpMethod || flow.httpPath || flow.httpStatus !== undefined) {
    return "http";
  }
  if (flow.dnsQuery) {
    return "dns";
  }
  return inferProtocolClass(flow.port, flow.protocol);
}

export function protocolClassLabel(value: ProtocolClass, decoded = false): string {
  switch (value) {
    case "dns":
      return "DNS";
    case "http":
      return decoded ? "HTTP" : "HTTP*";
    case "grpc":
      return decoded ? "gRPC" : "gRPC*";
    case "postgres":
      return "Postgres*";
    case "mysql":
      return "MySQL*";
    case "redis":
      return "Redis*";
    case "kafka":
      return "Kafka*";
    case "tcp":
      return "TCP";
    case "udp":
      return "UDP";
    default:
      return "Other";
  }
}
