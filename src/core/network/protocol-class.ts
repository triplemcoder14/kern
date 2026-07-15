/** Port-heuristic app class — inferred only, not protocol inspection. */
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

export function protocolClassLabel(value: ProtocolClass): string {
  switch (value) {
    case "dns":
      return "DNS";
    case "http":
      return "HTTP*";
    case "grpc":
      return "gRPC*";
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
