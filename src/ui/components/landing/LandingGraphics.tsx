/** Landing page visuals — color reserved for charts and status inside mockups */

import { KernWordmark } from "../KernWordmark";

function Sparkline({
  points,
  className,
  live,
}: {
  points: string;
  className?: string;
  live?: boolean;
}) {
  return (
    <svg
      className={`landing-sparkline${live ? " landing-sparkline-live" : ""} ${className ?? ""}`}
      viewBox="0 0 80 24"
      aria-hidden
    >
      <polyline points={points} className="landing-sparkline-line" />
    </svg>
  );
}

export function HeroIsometric() {
  return (
    <svg className="landing-isometric" viewBox="0 0 420 360" aria-hidden>
      <defs>
        <pattern id="kern-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="1" fill="rgba(255,255,255,0.12)" />
        </pattern>
      </defs>

      <g className="landing-iso-layer landing-iso-layer-4">
        <path d="M60 250 L210 170 L360 250 L210 330 Z" fill="url(#kern-grid)" stroke="rgba(255,255,255,0.08)" />
      </g>
      <g className="landing-iso-layer landing-iso-layer-3">
        <path d="M80 210 L230 130 L380 210 L230 290 Z" fill="url(#kern-grid)" stroke="rgba(255,255,255,0.1)" />
      </g>
      <g className="landing-iso-layer landing-iso-layer-2">
        <path d="M100 170 L250 90 L400 170 L250 250 Z" fill="url(#kern-grid)" stroke="rgba(255,255,255,0.12)" />
      </g>
      <g className="landing-iso-layer landing-iso-layer-1">
        <path d="M120 130 L270 50 L420 130 L270 210 Z" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.16)" />
        <text x="270" y="138" textAnchor="middle" className="landing-iso-k">
          K
        </text>
      </g>

      <line x1="150" y1="190" x2="150" y2="250" className="landing-iso-beam" />
      <line x1="210" y1="160" x2="210" y2="220" className="landing-iso-beam" />
      <line x1="270" y1="120" x2="270" y2="180" className="landing-iso-beam landing-iso-beam-bright" />
      <line x1="330" y1="150" x2="330" y2="210" className="landing-iso-beam" />

      <circle cx="150" cy="190" r="3" className="landing-iso-dot" />
      <circle cx="210" cy="160" r="3" className="landing-iso-dot" />
      <circle cx="270" cy="120" r="4" className="landing-iso-dot landing-iso-dot-bright" />
      <circle cx="330" cy="150" r="3" className="landing-iso-dot" />
    </svg>
  );
}

const NAV = [
  { label: "Overview", active: false },
  { label: "Topology", active: true },
  { label: "Flows", active: false },
  { label: "Alerts", active: false },
  { label: "Workloads", active: false },
  { label: "Events", active: false },
  { label: "Profiling", active: false },
  { label: "Settings", active: false },
] as const;

const TOPO_NODES = [
  { id: "frontend", x: 48, y: 88, pods: "3 pods" },
  { id: "mobile-api", x: 48, y: 168, pods: "2 pods" },
  { id: "api-gateway", x: 168, y: 128, pods: "4 pods" },
  { id: "user-service", x: 288, y: 72, pods: "3 pods" },
  { id: "orders-service", x: 288, y: 152, pods: "2 pods" },
  { id: "payment-service", x: 408, y: 112, pods: "2 pods" },
  { id: "postgres", x: 528, y: 152, pods: "1 pod" },
] as const;

const TOPO_EDGES = [
  ["frontend", "api-gateway"],
  ["mobile-api", "api-gateway"],
  ["api-gateway", "user-service"],
  ["api-gateway", "orders-service"],
  ["orders-service", "payment-service"],
  ["payment-service", "postgres"],
] as const;

function nodeCenter(id: string) {
  const node = TOPO_NODES.find((n) => n.id === id);
  if (!node) return { x: 0, y: 0 };
  return { x: node.x + 52, y: node.y + 22 };
}

function edgePath(from: string, to: string) {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

export function ProductMockup() {
  return (
    <div className="landing-mock landing-mock-live" aria-hidden>
      <aside className="landing-mock-sidebar">
        <div className="landing-mock-sidebar-brand">
          <KernWordmark className="landing-mock-wordmark" />
        </div>
        <nav className="landing-mock-nav">
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`landing-mock-nav-item${item.active ? " landing-mock-nav-item-active" : ""}`}
            >
              <span className="landing-mock-nav-dot" />
              {item.label}
            </div>
          ))}
        </nav>
      </aside>

      <div className="landing-mock-body">
        <div className="landing-mock-toolbar">
          <span className="landing-mock-toolbar-title">Topology</span>
          <span className="landing-mock-toolbar-meta">
            <span className="landing-mock-live-dot" />
            live · 14 services
          </span>
        </div>

        <div className="landing-mock-canvas">
          <svg className="landing-mock-topo-edges" viewBox="0 0 640 240" preserveAspectRatio="xMidYMid meet">
            {TOPO_EDGES.map(([from, to], edgeIndex) => {
              const a = nodeCenter(from);
              const b = nodeCenter(to);
              const path = edgePath(from, to);
              const isWarmPath =
                from === "orders-service" ||
                (from === "api-gateway" && to === "orders-service");
              return (
                <g key={`${from}-${to}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="landing-mock-edge" />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={`landing-mock-edge-flow${isWarmPath ? " landing-mock-edge-flow-warn" : ""}`}
                    style={{ animationDelay: `${edgeIndex * 0.15}s` }}
                  />
                  <polygon
                    points={`${b.x},${b.y} ${b.x - 6},${b.y - 3} ${b.x - 6},${b.y + 3}`}
                    className="landing-mock-edge-arrow"
                  />
                  {[0, 1, 2].map((packetIndex) => (
                    <circle
                      key={packetIndex}
                      r="2.5"
                      className={`landing-mock-packet${isWarmPath ? " landing-mock-packet-warn" : ""}`}
                    >
                      <animateMotion
                        dur={`${2.4 + edgeIndex * 0.35}s`}
                        begin={`${packetIndex * 0.75 + edgeIndex * 0.18}s`}
                        repeatCount="indefinite"
                        path={path}
                      />
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>

          <div className="landing-mock-nodes">
            {TOPO_NODES.map((node, index) => (
              <div
                key={node.id}
                className={`landing-mock-node landing-mock-node-float${node.id === "api-gateway" ? " landing-mock-node-active" : ""}`}
                style={{ left: node.x, top: node.y, animationDelay: `${index * 0.55}s` }}
              >
                <span className="landing-mock-node-name">{node.id}</span>
                <span className="landing-mock-node-pods">{node.pods}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="landing-mock-detail">
        <div className="landing-mock-detail-head">
          <span className="landing-mock-detail-name">api-gateway</span>
          <span className="landing-mock-badge landing-mock-badge-ok">Healthy</span>
        </div>

        <div className="landing-mock-metrics">
          <div className="landing-mock-metric">
            <span className="landing-mock-metric-label">Requests</span>
            <span className="landing-mock-metric-value">12.4k</span>
            <Sparkline points="0,18 12,14 24,16 36,10 48,12 60,8 72,6 80,4" />
          </div>
          <div className="landing-mock-metric">
            <span className="landing-mock-metric-label">P95 latency</span>
            <span className="landing-mock-metric-value landing-mock-metric-warn">86ms</span>
            <Sparkline
              points="0,20 12,18 24,16 36,14 48,12 60,10 72,8 80,6"
              className="landing-sparkline-warn"
            />
          </div>
          <div className="landing-mock-metric">
            <span className="landing-mock-metric-label">Error rate</span>
            <span className="landing-mock-metric-value">0.21%</span>
            <Sparkline points="0,16 12,18 24,14 36,16 48,12 60,14 72,10 80,12" />
          </div>
        </div>

        <div className="landing-mock-talkers">
          <span className="landing-mock-talkers-label">Top talkers</span>
          {[
            { name: "frontend", pct: 82 },
            { name: "mobile-api", pct: 64 },
            { name: "user-service", pct: 41 },
          ].map((row) => (
            <div key={row.name} className="landing-mock-talker">
              <span>{row.name}</span>
              <span className="landing-mock-talker-bar">
                <span className="landing-mock-talker-fill landing-mock-talker-fill-live" style={{ width: `${row.pct}%` }} />
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function FeatureIcon({
  kind,
}: {
  kind: "topology" | "flows" | "alerts" | "workloads" | "profiling" | "storage";
}) {
  const icons = {
    topology: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="18" cy="18" r="3" />
        <path d="M9 12h6M15.5 7.5L12.5 10.5M15.5 16.5L12.5 13.5" />
      </svg>
    ),
    flows: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 8h11M4 16h11" />
        <path d="M15 8l4 4-4 4M15 16l4-4-4-4" />
      </svg>
    ),
    alerts: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 4a5 5 0 0 1 5 5v4l2 3H5l2-3V9a5 5 0 0 1 5-5Z" />
        <path d="M10 18a2 2 0 0 0 4 0" />
      </svg>
    ),
    workloads: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="5" width="7" height="6" rx="1.5" />
        <rect x="13" y="5" width="7" height="6" rx="1.5" />
        <rect x="4" y="13" width="7" height="6" rx="1.5" />
        <rect x="13" y="13" width="7" height="6" rx="1.5" />
      </svg>
    ),
    profiling: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="12" width="3" height="8" rx="1" />
        <rect x="10" y="8" width="3" height="12" rx="1" />
        <rect x="16" y="4" width="3" height="16" rx="1" />
      </svg>
    ),
    storage: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7Z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    ),
  };

  return <span className="landing-feature-icon">{icons[kind]}</span>;
}

function FeaturesDoodles() {
  return (
    <div className="landing-features-doodles" aria-hidden>
      <svg className="landing-doodle landing-doodle-a" viewBox="0 0 120 40">
        <path d="M6 28 C28 10 52 34 74 18 S108 8 114 22" />
      </svg>
      <svg className="landing-doodle landing-doodle-b" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="14" />
        <path d="M24 10v28M10 24h28" />
      </svg>
      <svg className="landing-doodle landing-doodle-c" viewBox="0 0 64 32">
        <path d="M4 16h44M44 10l12 6-12 6" />
      </svg>
      <svg className="landing-doodle landing-doodle-d" viewBox="0 0 80 80">
        <path d="M12 40c12-16 24-16 36 0s24 16 36 0" />
      </svg>
    </div>
  );
}

export interface LandingFeature {
  id: "topology" | "flows" | "alerts" | "workloads" | "profiling" | "storage";
  label: string;
  body: string;
  accent: "ok" | "warn" | "line" | "neutral";
}

export function FeaturesSection({ features }: { features: readonly LandingFeature[] }) {
  return (
    <div className="landing-features-stage">
      <FeaturesDoodles />
      <div className="landing-features-row">
        {features.map((feature) => (
          <article
            key={feature.id}
            id={`feature-${feature.id}`}
            className={`landing-feature-card landing-feature-card-${feature.accent}`}
          >
            <FeatureIcon kind={feature.id} />
            <div className="landing-feature-card-copy">
              <h3>{feature.label}</h3>
              <p>{feature.body}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const TALK_EVENTS = [
  {
    time: "14:02:18",
    kind: "started",
    path: "api → postgres:5432",
    detail: "path opened",
    tone: "ok",
  },
  {
    time: "14:02:14",
    kind: "degraded",
    path: "worker-2 → redis.svc:6379",
    detail: "p95 186ms · 3 drops",
    tone: "warn",
  },
  {
    time: "14:02:11",
    kind: "degraded",
    path: "ingress → api",
    detail: "timeout spike · 504",
    tone: "bad",
  },
  {
    time: "14:02:07",
    kind: "ended",
    path: "cron → postgres:5432",
    detail: "idle · path closed",
    tone: "neutral",
  },
  {
    time: "14:02:03",
    kind: "started",
    path: "api → worker-1",
    detail: "new dependency",
    tone: "ok",
  },
] as const;

function talkKindLabel(kind: (typeof TALK_EVENTS)[number]["kind"]): string {
  if (kind === "started") return "START";
  if (kind === "degraded") return "DEG";
  return "END";
}

export function TalkEventsPreview() {
  return (
    <div className="landing-events-preview landing-events-preview-live-panel" aria-hidden>
      <div className="landing-events-chrome">
        <div className="landing-events-chrome-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="landing-events-chrome-path">prod-east · Events · live</span>
      </div>

      <div className="landing-events-toolbar">
        <div className="landing-events-tabs">
          <span className="landing-events-tab landing-events-tab-active">All</span>
          <span className="landing-events-tab">Network talk</span>
          <span className="landing-events-tab landing-events-tab-accent">Degradation</span>
          <span className="landing-events-tab">Kubernetes</span>
        </div>
        <span className="landing-events-preview-live">
          <span className="landing-events-live-dot" />
          live
        </span>
      </div>

      <div className="landing-events-stats">
        <div className="landing-events-stat landing-events-stat-float">
          <span className="landing-events-stat-label">Talk paths</span>
          <span className="landing-events-stat-value">24</span>
        </div>
        <div className="landing-events-stat landing-events-stat-warn landing-events-stat-float landing-events-stat-pulse">
          <span className="landing-events-stat-label">Degraded</span>
          <span className="landing-events-stat-value">2</span>
        </div>
        <div className="landing-events-stat landing-events-stat-float">
          <span className="landing-events-stat-label">Started (5m)</span>
          <span className="landing-events-stat-value landing-events-stat-value-live">8</span>
        </div>
        <div className="landing-events-stat landing-events-stat-float">
          <span className="landing-events-stat-label">Ended (5m)</span>
          <span className="landing-events-stat-value">5</span>
        </div>
      </div>

      <div className="landing-events-stream">
        <div className="landing-events-stream-scan" aria-hidden />
        {TALK_EVENTS.map((event, index) => (
          <div
            key={`${event.time}-${event.path}`}
            className={`landing-events-row landing-events-row-${event.tone} landing-events-row-live${index === 0 ? " landing-events-row-new" : ""}`}
            style={{ animationDelay: `${index * 0.12}s` }}
          >
            <span className="landing-events-time">{event.time}</span>
            <span className={`landing-events-kind landing-events-kind-${event.kind}`}>
              {talkKindLabel(event.kind)}
            </span>
            <span className={`landing-events-path landing-events-path-${event.tone}`}>
              <span
                className="landing-events-path-packet"
                style={{ animationDelay: `${index * 0.45 + 0.2}s` }}
              />
              {event.path}
            </span>
            <span className={`landing-events-detail landing-events-detail-${event.tone}`}>{event.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PROFILE_NODES = [
  { name: "worker-2", p95: "186ms", drops: 3, health: "warn", active: true },
  { name: "worker-1", p95: "12ms", drops: 0, health: "ok", active: false },
  { name: "worker-3", p95: "8ms", drops: 0, health: "ok", active: false },
  { name: "worker-4", p95: "14ms", drops: 0, health: "ok", active: false },
] as const;

const PROFILE_METRICS = [
  { label: "P50", value: "11ms", tone: "ok", spark: "0,18 16,14 32,16 48,12 64,10 80,8" },
  { label: "P95", value: "186ms", tone: "warn", spark: "0,20 16,18 32,14 48,10 64,8 80,6" },
  { label: "Drops", value: "3", tone: "bad", spark: "0,16 20,16 40,14 60,12 80,10" },
  { label: "Flows/s", value: "1.2k", tone: "neutral", spark: "0,14 16,16 32,12 48,14 64,10 80,12" },
] as const;

const NET_LOG = [
  { time: "14:02:11", sev: "WARN", event: "TCP redis.svc:6379", val: "186ms", tone: "warn" },
  { time: "14:02:09", sev: "CRIT", event: "conntrack table pressure", val: "3 drops", tone: "bad" },
  { time: "14:02:07", sev: "INFO", event: "syscall connect latency spike", val: "+4.2ms", tone: "warn" },
  { time: "14:02:04", sev: "OK", event: "postgres:5432 path stable", val: "12ms", tone: "ok" },
  { time: "14:02:01", sev: "OK", event: "dns_lookup cache hit", val: "2ms", tone: "ok" },
] as const;

function FlamegraphSvg() {
  return (
    <svg className="landing-profile-flamegraph" viewBox="0 0 360 92" aria-hidden>
      <rect x="0" y="0" width="360" height="20" rx="3" className="landing-flame-block landing-flame-ok" />
      <text x="8" y="13" className="landing-flame-label">
        network stack
      </text>

      <rect x="0" y="24" width="228" height="20" rx="3" className="landing-flame-block landing-flame-ok" />
      <text x="8" y="37" className="landing-flame-label">
        tcp_connect
      </text>
      <rect
        x="232"
        y="24"
        width="128"
        height="20"
        rx="3"
        className="landing-flame-block landing-flame-warn landing-flame-live-hot"
      />
      <text x="240" y="37" className="landing-flame-label">
        redis.svc:6379
      </text>

      <rect x="0" y="48" width="132" height="20" rx="3" className="landing-flame-block landing-flame-ok" />
      <text x="8" y="61" className="landing-flame-label">
        sock_recv
      </text>
      <rect
        x="136"
        y="48"
        width="108"
        height="20"
        rx="3"
        className="landing-flame-block landing-flame-warn landing-flame-live-hot"
      />
      <text x="144" y="61" className="landing-flame-label">
        redis:6379
      </text>
      <rect x="248" y="48" width="112" height="20" rx="3" className="landing-flame-block landing-flame-ok" />
      <text x="256" y="61" className="landing-flame-label">
        dns_lookup
      </text>

      <rect
        x="136"
        y="72"
        width="72"
        height="20"
        rx="3"
        className="landing-flame-block landing-flame-bad landing-flame-live-bad"
      />
      <text x="144" y="85" className="landing-flame-label">
        conntrack
      </text>

      {[0, 1].map((packetIndex) => (
        <circle key={packetIndex} r="2" className="landing-flame-packet landing-flame-packet-warn">
          <animateMotion
            dur="2.4s"
            begin={`${packetIndex * 0.9}s`}
            repeatCount="indefinite"
            path="M 228 34 L 360 34"
          />
        </circle>
      ))}
      <circle r="2" className="landing-flame-packet landing-flame-packet-bad">
        <animateMotion dur="2.2s" begin="0.4s" repeatCount="indefinite" path="M 190 58 L 190 82" />
      </circle>
    </svg>
  );
}

export function ProfilingPreview() {
  return (
    <div className="landing-profile-preview landing-profile-preview-live-panel" aria-hidden>
      <div className="landing-profile-chrome">
        <div className="landing-profile-chrome-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="landing-profile-chrome-path">prod-east · Nodes · worker-2</span>
      </div>

      <div className="landing-profile-toolbar">
        <div className="landing-profile-toolbar-left">
          <span className="landing-profile-toolbar-name">worker-2</span>
          <span className="landing-profile-badge landing-profile-badge-warn">Degraded</span>
          <span className="landing-profile-toolbar-zone">pool-a · 4 vCPU</span>
        </div>
        <div className="landing-profile-toolbar-right">
          <span className="landing-profile-toolbar-sample">Sample 3s</span>
          <span className="landing-profile-preview-live">
            <span className="landing-profile-live-dot" />
            live
          </span>
        </div>
      </div>

      <div className="landing-profile-preview-body">
        <aside className="landing-profile-nodes">
          <span className="landing-profile-nodes-label">Node pool</span>
          {PROFILE_NODES.map((node, index) => (
            <div
              key={node.name}
              className={`landing-profile-node landing-profile-node-float${node.active ? " landing-profile-node-active landing-profile-node-pulse" : ""}`}
              style={{ animationDelay: `${index * 0.45}s` }}
            >
              <span className="landing-profile-node-row">
                <span
                  className={`landing-profile-health landing-profile-health-${node.health}${node.health === "warn" ? " landing-profile-health-pulse" : ""}`}
                />
                {node.name}
              </span>
              <span className={`landing-profile-node-meta landing-profile-node-meta-${node.health}`}>
                p95 {node.p95}
                {node.drops > 0 ? ` · ${node.drops} drops` : ""}
              </span>
            </div>
          ))}
        </aside>

        <div className="landing-profile-main">
          <div className="landing-profile-metrics">
            {PROFILE_METRICS.map((metric, index) => (
              <div
                key={metric.label}
                className={`landing-profile-metric landing-profile-metric-float${metric.tone === "warn" || metric.tone === "bad" ? " landing-profile-metric-hot" : ""}`}
                style={{ animationDelay: `${index * 0.55}s` }}
              >
                <span className="landing-profile-metric-label">{metric.label}</span>
                <span
                  className={`landing-profile-metric-value landing-profile-metric-${metric.tone}${metric.tone === "warn" || metric.tone === "bad" ? " landing-profile-metric-value-pulse" : ""}`}
                >
                  {metric.value}
                </span>
                <Sparkline
                  points={metric.spark}
                  live
                  className={
                    metric.tone === "warn"
                      ? "landing-sparkline-warn"
                      : metric.tone === "bad"
                        ? "landing-sparkline-bad"
                        : undefined
                  }
                />
              </div>
            ))}
          </div>

          <div className="landing-profile-tabs">
            <span className="landing-profile-tab landing-profile-tab-active">Network</span>
            <span className="landing-profile-tab">Latency</span>
            <span className="landing-profile-tab">Flows</span>
          </div>

          <div className="landing-profile-flamegraph-wrap landing-profile-flamegraph-live-wrap">
            <span className="landing-profile-panel-label">Flame stack</span>
            <div className="landing-profile-flamegraph-stage">
              <FlamegraphSvg />
              <div className="landing-profile-flame-scan" aria-hidden />
            </div>
          </div>

          <div className="landing-profile-events">
            <div className="landing-profile-events-scan" aria-hidden />
            <div className="landing-profile-events-head">
              <span>Time</span>
              <span>Sev</span>
              <span>Event</span>
              <span>Value</span>
            </div>
            {NET_LOG.map((line, index) => (
              <div
                key={`${line.time}-${line.event}`}
                className={`landing-profile-log-row landing-profile-log-row-live landing-profile-log-${line.tone}${index === 0 ? " landing-profile-log-row-new" : ""}${line.tone === "warn" || line.tone === "bad" ? " landing-profile-log-row-alert" : ""}`}
                style={{ animationDelay: `${index * 0.12}s` }}
              >
                <span className="landing-profile-log-time">{line.time}</span>
                <span className={`landing-profile-log-sev landing-profile-log-${line.tone}`}>
                  {line.sev}
                </span>
                <span className="landing-profile-log-msg">
                  {(line.tone === "warn" || line.tone === "bad") && (
                    <span
                      className="landing-profile-log-packet"
                      style={{ animationDelay: `${index * 0.4 + 0.15}s` }}
                    />
                  )}
                  {line.event}
                </span>
                <span className={`landing-profile-log-val landing-profile-log-${line.tone}`}>
                  {line.val}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConnectClusterFlow() {
  return (
    <div className="landing-arch" aria-hidden>
      <div className="landing-arch-track">
        <div className="landing-arch-cluster">
          <span className="landing-arch-cluster-label">In cluster</span>
          <div className="landing-arch-cluster-stack">
            <div className="landing-arch-chip">
              <span className="landing-arch-chip-mark">A</span>
              <span className="landing-arch-chip-body">
                <span className="landing-arch-chip-name">Agent</span>
                <span className="landing-arch-chip-meta">kernel flows · :9474</span>
              </span>
            </div>
            <div className="landing-arch-chip">
              <span className="landing-arch-chip-mark">C</span>
              <span className="landing-arch-chip-body">
                <span className="landing-arch-chip-name">Collector</span>
                <span className="landing-arch-chip-meta">trace · hubble</span>
              </span>
            </div>
          </div>
        </div>

        <div className="landing-arch-connector" aria-hidden>
          <span className="landing-arch-connector-line" />
          <span className="landing-arch-connector-dot landing-arch-connector-dot-a" />
          <span className="landing-arch-connector-dot landing-arch-connector-dot-b" />
        </div>

        <div className="landing-arch-chip landing-arch-chip-main">
          <span className="kern-logo-mark kern-logo-mark-solid landing-arch-k-mark">
            <span className="kern-logo-k">K</span>
          </span>
          <span className="landing-arch-chip-body">
            <span className="landing-arch-chip-name">API</span>
            <span className="landing-arch-chip-meta">watch · merge · stream</span>
          </span>
        </div>

        <div className="landing-arch-connector" aria-hidden>
          <span className="landing-arch-connector-line landing-arch-connector-line-bright" />
        </div>

        <div className="landing-arch-chip landing-arch-chip-console">
          <span className="landing-arch-chip-screen">
            <span className="landing-arch-chip-screen-bar" />
            <span className="landing-arch-chip-screen-grid">
              <span />
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="landing-arch-chip-body">
            <span className="landing-arch-chip-name">Console</span>
            <span className="landing-arch-chip-meta">topology · flows · alerts</span>
          </span>
        </div>
      </div>

      <p className="landing-arch-caption">
        Agent and collector in-cluster. One API. Full visibility from the kernel up — no per-pod
        sidecars.
      </p>
    </div>
  );
}

function FooterChip({ kind }: { kind: "topo" | "flow" | "kernel" }) {
  if (kind === "topo") {
    return (
      <span className="landing-footer-chip landing-footer-chip-topo" aria-hidden>
        <svg viewBox="0 0 76 46" preserveAspectRatio="xMidYMid slice">
          <circle cx="14" cy="23" r="3" className="landing-footer-chip-node" />
          <circle cx="38" cy="14" r="3" className="landing-footer-chip-node" />
          <circle cx="62" cy="23" r="3" className="landing-footer-chip-node" />
          <circle cx="38" cy="32" r="3" className="landing-footer-chip-node landing-footer-chip-node-bright" />
          <path d="M17 22 L35 15 M41 15 L59 22 M38 17 L38 29" className="landing-footer-chip-edge" />
        </svg>
      </span>
    );
  }

  if (kind === "flow") {
    return (
      <span className="landing-footer-chip landing-footer-chip-flow" aria-hidden>
        <svg viewBox="0 0 76 46" preserveAspectRatio="xMidYMid slice">
          <path d="M8 14 H68" className="landing-footer-chip-row" />
          <path d="M8 23 H52" className="landing-footer-chip-row landing-footer-chip-row-warn" />
          <path d="M8 32 H60" className="landing-footer-chip-row" />
          <circle cx="62" cy="23" r="2.5" className="landing-footer-chip-dot-warn" />
        </svg>
      </span>
    );
  }

  return (
    <span className="landing-footer-chip landing-footer-chip-kernel" aria-hidden>
      <svg viewBox="0 0 76 46" preserveAspectRatio="xMidYMid slice">
        <rect x="8" y="10" width="60" height="7" rx="1.5" className="landing-footer-chip-bar landing-footer-chip-bar-ok" />
        <rect x="8" y="20" width="44" height="7" rx="1.5" className="landing-footer-chip-bar landing-footer-chip-bar-ok" />
        <rect x="54" y="20" width="14" height="7" rx="1.5" className="landing-footer-chip-bar landing-footer-chip-bar-warn" />
        <rect x="24" y="30" width="22" height="7" rx="1.5" className="landing-footer-chip-bar landing-footer-chip-bar-bad" />
      </svg>
    </span>
  );
}

export function FooterManifesto() {
  return (
    <div className="landing-footer-manifesto">
      <p className="landing-footer-manifesto-copy">
        <span className="landing-footer-manifesto-line">
          Observability that <FooterChip kind="topo" />
        </span>
        <span className="landing-footer-manifesto-line">
          <span className="landing-footer-accent landing-footer-accent-line">maps topology,</span>{" "}
          <FooterChip kind="flow" />
          <span className="landing-footer-accent landing-footer-accent-warn"> hears talk paths,</span>
        </span>
        <span className="landing-footer-manifesto-line">
          and <span className="landing-footer-accent landing-footer-accent-ok">profiles the kernel</span>{" "}
          <FooterChip kind="kernel" />
        </span>
        <span className="landing-footer-manifesto-line">from the node up.</span>
      </p>
    </div>
  );
}
