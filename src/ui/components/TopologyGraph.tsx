import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import {
  GRAPH_LOD_ORDER,
  lodFromZoom,
  lodLabel,
  truncateNodeName,
  type GraphEdgeHealth,
  type GraphEdgeLayout,
  type GraphLayout,
  type GraphLod,
  type GraphNodeLayout,
} from "../../core/network/graph-model";
import { protocolStroke } from "../../core/network/protocol-class";
import type { NavId, NavPage } from "./AppShell";
import {
  INVESTIGATE_ACTIONS,
  type InvestigationFocus,
  type StartInvestigation,
} from "../investigation/types";

interface TopologyGraphProps {
  layout: GraphLayout;
  connected: boolean;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
  lod?: GraphLod;
  onLodChange?: (lod: GraphLod) => void;
  showLegend?: boolean;
  showInspectPanel?: boolean;
  // onNavigate?: (nav: NavId, page: NavPage) => void;
  /** Navigate without investigation context (legacy). */
  onNavigate?: (nav: NavId, page: NavPage) => void;
  /** Start a persistent investigation and jump to a surface. */
  onStartInvestigation?: StartInvestigation;
  startedFrom?: string;
}

const HEALTH_STROKE: Record<GraphEdgeHealth, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  bad: "#f87171",
};

function edgeStroke(edge: GraphEdgeLayout): string {
  if (edge.health === "bad" || edge.health === "warn") {
    return HEALTH_STROKE[edge.health];
  }
  return protocolStroke(edge.appClass);
}

function edgeClass(
  edge: GraphEdgeLayout,
  selected: boolean,
  hovered: boolean,
  dimmed: boolean,
): string {
  const classes = [
    "graph-edge",
    `health-${edge.health}`,
    `proto-${edge.appClass}`,
  ];
  if (selected) {
    classes.push("selected");
  }
  if (hovered) {
    classes.push("hovered");
  }
  if (dimmed) {
    classes.push("dimmed");
  }
  if (edge.bundledCount > 1) {
    classes.push("bundled");
  }
  if (edge.source === "ebpf") {
    classes.push("edge-ebpf");
  } else if (edge.source === "kubernetes") {
    classes.push("edge-k8s");
  } else if (edge.source === "topology") {
    classes.push("edge-route");
  }
  return classes.join(" ");
}

function statusLabel(status: GraphNodeLayout["status"]): string {
  if (status === "healthy") {
    return "Healthy";
  }
  if (status === "degraded") {
    return "Degraded";
  }
  return "Unknown";
}

function detailLevel(zoom: number, lod: GraphLod): "minimal" | "compact" | "full" {
  if (lod === "cluster" || lod === "namespace" || zoom < 0.55) {
    return "minimal";
  }
  if (lod === "service" || zoom < 0.9) {
    return "compact";
  }
  return "full";
}

/** Compact hop label: protocol · throughput · latency (and health hint). */
function hopHealthHint(edge: Pick<GraphEdgeLayout, "health" | "drops" | "retransmits" | "latencyP95Ms">): string | null {
  if (edge.health === "bad") {
    return edge.drops > 0 ? "drops" : "error";
  }
  if (edge.health !== "warn") {
    return null;
  }
  // Retransmits / retries are not the same as high latency — don't call 1ms "slow".
  if (edge.retransmits > 0) {
    return "retrans";
  }
  return "slow";
}

function hopEdgeLabel(edge: GraphEdgeLayout, full: boolean): string {
  const bits: string[] = [edge.appClassLabel];
  if (edge.requestsPerSec > 0) {
    bits.push(`${edge.requestsPerSec}/s`);
  } else if (edge.flowCount > 0) {
    bits.push(`${edge.flowCount} flows`);
  }
  if (edge.latencyP95Ms !== undefined) {
    bits.push(`p95 ${Math.round(edge.latencyP95Ms)}ms`);
  } else if (full && edge.flowCount > 0) {
    bits.push("live");
  }
  const hint = hopHealthHint(edge);
  if (hint) {
    bits.push(hint);
  }
  if (full && edge.bundledCount > 1) {
    bits.push(`${edge.bundledCount} routes`);
  }
  return bits.join(" · ");
}

export function TopologyGraph({
  layout,
  connected,
  selectedEdgeId,
  onSelectEdge,
  selectedNodeId = null,
  onSelectNode,
  lod: controlledLod,
  onLodChange,
  showLegend = false,
  showInspectPanel = true,
  onNavigate,
  onStartInvestigation,
  startedFrom = "Service Map",
}: TopologyGraphProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const hoverClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHoverClear = useCallback(() => {
    if (hoverClearRef.current) {
      clearTimeout(hoverClearRef.current);
      hoverClearRef.current = null;
    }
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelHoverClear();
    hoverClearRef.current = setTimeout(() => {
      setHoveredEdgeId(null);
      setHoverPoint(null);
      hoverClearRef.current = null;
    }, 80);
  }, [cancelHoverClear]);

  const showEdgeHover = useCallback(
    (edgeId: string, clientX: number, clientY: number) => {
      cancelHoverClear();
      setHoveredEdgeId(edgeId);
      const viewport = viewportRef.current?.getBoundingClientRect();
      if (viewport) {
        setHoverPoint({
          x: clientX - viewport.left,
          y: clientY - viewport.top,
        });
      }
    },
    [cancelHoverClear],
  );

  useEffect(() => {
    return () => {
      if (hoverClearRef.current) {
        clearTimeout(hoverClearRef.current);
      }
    };
  }, []);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [internalLod, setInternalLod] = useState<GraphLod>(layout.lod ?? "service");
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const autoLodRef = useRef(true);
  const lastAutoLodRef = useRef<GraphLod>(layout.lod ?? "service");

  const lod = controlledLod ?? internalLod;
  const setLod = (next: GraphLod, fromUser = false) => {
    if (fromUser) {
      autoLodRef.current = false;
    }
    setInternalLod(next);
    onLodChange?.(next);
  };

  useEffect(() => {
    setInternalLod(layout.lod ?? "service");
  }, [layout.lod]);

  const labelLod = detailLevel(zoom, lod);
  const focusNodeId = selectedNodeId;
  const focusEdgeId = hoveredEdgeId ?? selectedEdgeId;

  const linkedNodeIds = useMemo(() => {
    if (focusNodeId) {
      const linked = new Set<string>([focusNodeId]);
      for (const edge of layout.edges) {
        if (edge.from === focusNodeId || edge.to === focusNodeId) {
          linked.add(edge.from);
          linked.add(edge.to);
        }
      }
      return linked;
    }
    if (!focusEdgeId) {
      return null;
    }
    const edge = layout.edges.find((item) => item.id === focusEdgeId);
    if (!edge) {
      return null;
    }
    return new Set([edge.from, edge.to]);
  }, [focusEdgeId, focusNodeId, layout.edges]);

  const linkedEdgeIds = useMemo(() => {
    if (!focusNodeId) {
      return null;
    }
    return new Set(
      layout.edges
        .filter((edge) => edge.from === focusNodeId || edge.to === focusNodeId)
        .map((edge) => edge.id),
    );
  }, [focusNodeId, layout.edges]);

  const selectedNode = useMemo(
    () => layout.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [layout.nodes, selectedNodeId],
  );

  const hoveredEdge = useMemo(
    () => layout.edges.find((edge) => edge.id === hoveredEdgeId) ?? null,
    [layout.edges, hoveredEdgeId],
  );

  // Hop metrics card is hover-only — clears when the pointer leaves the edge/card.
  const focusEdge = hoveredEdge;
  const focusEdgePoint = hoverPoint;

  const nodeDependencies = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    const names = new Set<string>();
    for (const edge of layout.edges) {
      if (edge.from === selectedNode.id) {
        const target = layout.nodes.find((node) => node.id === edge.to);
        if (target) {
          names.add(target.name);
        }
      }
      if (edge.to === selectedNode.id) {
        const source = layout.nodes.find((node) => node.id === edge.from);
        if (source) {
          names.add(source.name);
        }
      }
    }
    return [...names];
  }, [layout.edges, layout.nodes, selectedNode]);

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || layout.width <= 0 || layout.height <= 0) {
      return;
    }
    // Use selectedNodeId (stable) — not selectedNode object identity, which changes every live layout rebuild.
    const panelReserve = selectedNodeId && showInspectPanel ? 300 : 0;
    const pad = 36;
    const scale = Math.min(
      (viewport.clientWidth - pad - panelReserve) / layout.width,
      (viewport.clientHeight - pad) / layout.height,
      2.2,
    );
    const nextZoom = Math.max(0.35, scale);
    setZoom(nextZoom);
    setPan({
      x: (viewport.clientWidth - panelReserve - layout.width * nextZoom) / 2,
      y: (viewport.clientHeight - layout.height * nextZoom) / 2,
    });
  }, [layout.width, layout.height, selectedNodeId, showInspectPanel]);

  useEffect(() => {
    fitToView();
  }, [fitToView, layout.lod]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }
    const observer = new ResizeObserver(() => fitToView());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitToView]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    // Inspect / chrome scroll must not zoom or pan the map underneath.
    if (
      target?.closest(".graph-inspect") ||
      target?.closest(".graph-edge-card") ||
      target?.closest(".graph-lod-bar") ||
      target?.closest(".graph-controls")
    ) {
      return;
    }
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom((current) => {
      const next = Math.min(3, Math.max(0.25, current * factor));
      setPan((currentPan) => ({
        x: cursorX - ((cursorX - currentPan.x) / current) * next,
        y: cursorY - ((cursorY - currentPan.y) / current) * next,
      }));
      if (autoLodRef.current && onLodChange) {
        const suggested = lodFromZoom(next);
        if (suggested !== lastAutoLodRef.current) {
          lastAutoLodRef.current = suggested;
          onLodChange(suggested);
        }
      }
      return next;
    });
  };

  const startPan = (clientX: number, clientY: number) => {
    dragRef.current = { x: clientX, y: clientY, panX: pan.x, panY: pan.y };
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current) {
        return;
      }
      setPan({
        x: dragRef.current.panX + (event.clientX - dragRef.current.x),
        y: dragRef.current.panY + (event.clientY - dragRef.current.y),
      });
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [pan.x, pan.y]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (layout.nodes.length === 0) {
    return (
      <div className="graph-empty">
        {connected ? "Waiting for services and flows…" : "Connect to visualize service traffic"}
      </div>
    );
  }

  const investigating = focusNodeId !== null;

  return (
    <div
      ref={viewportRef}
      className={`graph-viewport ${linkedNodeIds ? "has-focus" : ""} ${investigating ? "investigating" : ""}`}
      onWheel={handleWheel}
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const target = event.target as HTMLElement;
        if (
          target.closest(".graph-node") ||
          target.closest(".graph-edge") ||
          target.closest(".graph-inspect") ||
          target.closest(".graph-edge-card") ||
          target.closest(".graph-lod-bar")
        ) {
          return;
        }
        startPan(event.clientX, event.clientY);
        onSelectNode?.(null);
      }}
    >
      <div className="graph-lod-bar" role="toolbar" aria-label="Map detail level">
        {GRAPH_LOD_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            className={`graph-lod-btn${lod === level ? " active" : ""}`}
            onClick={() => {
              autoLodRef.current = false;
              setLod(level, true);
            }}
          >
            {lodLabel(level)}
          </button>
        ))}
        <button
          type="button"
          className="graph-lod-btn graph-lod-auto"
          title="Sync detail level with zoom"
          onClick={() => {
            autoLodRef.current = true;
            const suggested = lodFromZoom(zoom);
            lastAutoLodRef.current = suggested;
            setLod(suggested, false);
          }}
        >
          Auto
        </button>
      </div>

      <div className="graph-controls">
        <button type="button" className="graph-control-btn" onClick={fitToView} title="Fit to view">
          Fit
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={() => setZoom((value) => Math.min(3, value * 1.15))}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="graph-control-btn"
          onClick={() => setZoom((value) => Math.max(0.25, value / 1.15))}
          title="Zoom out"
        >
          −
        </button>
      </div>

      {showLegend ? (
        <div className="graph-legend-float">
          <GraphLegend />
        </div>
      ) : null}

      {focusEdge && focusEdgePoint ? (
        <div
          className={`graph-edge-card is-interactive health-${focusEdge.health} proto-${focusEdge.appClass}`}
          style={{ left: focusEdgePoint.x + 16, top: focusEdgePoint.y + 12 }}
          onMouseEnter={cancelHoverClear}
          onMouseLeave={scheduleHoverClear}
        >
          <div className="graph-edge-card-route">{focusEdge.routeName}</div>
          <div className="graph-edge-card-hop">
            hop · {focusEdge.requestsPerSec}/s ·{" "}
            {focusEdge.latencyP95Ms !== undefined
              ? `p95 ${focusEdge.latencyP95Ms}ms`
              : "p95 —"}
            {(() => {
              // Previous: any warn showed "slow" — mislabeled 1ms hops that only had retransmits.
              // {focusEdge.health === "bad" ? " · error" : focusEdge.health === "warn" ? " · slow" : ""}
              const hint = hopHealthHint(focusEdge);
              return hint ? ` · ${hint}` : "";
            })()}
          </div>
          <dl className="graph-edge-card-grid">
            <div>
              <dt>Protocol</dt>
              <dd>{focusEdge.appClassLabel}</dd>
            </div>
            <div>
              <dt>Port</dt>
              <dd>
                {focusEdge.ports.length > 1
                  ? focusEdge.ports.join(", ")
                  : `${focusEdge.protocol}:${focusEdge.port}`}
              </dd>
            </div>
            <div>
              <dt>P50</dt>
              <dd>{focusEdge.latencyP50Ms !== undefined ? `${focusEdge.latencyP50Ms}ms` : "—"}</dd>
            </div>
            <div>
              <dt>P95</dt>
              <dd>{focusEdge.latencyP95Ms !== undefined ? `${focusEdge.latencyP95Ms}ms` : "—"}</dd>
            </div>
            <div>
              <dt>P99</dt>
              <dd>{focusEdge.latencyP99Ms !== undefined ? `${focusEdge.latencyP99Ms}ms` : "—"}</dd>
            </div>
            <div>
              <dt>Flows/s</dt>
              <dd>{focusEdge.requestsPerSec}</dd>
            </div>
            <div>
              <dt>Retransmits</dt>
              <dd>{focusEdge.retransmits}</dd>
            </div>
            <div>
              <dt>Drops</dt>
              <dd>{focusEdge.drops}</dd>
            </div>
            {focusEdge.bundledCount > 1 ? (
              <div>
                <dt>Bundled</dt>
                <dd>{focusEdge.bundledCount} routes</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {selectedNode && showInspectPanel ? (
        <aside
          className="graph-inspect"
          onWheel={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="graph-inspect-head">
            <div>
              <div className="graph-inspect-kind">{selectedNode.kind}</div>
              <div className="graph-inspect-title">{selectedNode.name}</div>
            </div>
            <button
              type="button"
              className="graph-inspect-close"
              onClick={() => onSelectNode?.(null)}
              aria-label="Close inspect panel"
            >
              ×
            </button>
          </div>
          <dl className="graph-inspect-stats">
            <div>
              <dt>Health</dt>
              <dd className={`status-${selectedNode.status}`}>{statusLabel(selectedNode.status)}</dd>
            </div>
            <div>
              <dt>Pods</dt>
              <dd>{selectedNode.podCount}</dd>
            </div>
            <div>
              <dt>Flows/s</dt>
              <dd>{selectedNode.requestsPerSec}</dd>
            </div>
            <div>
              <dt>P95</dt>
              <dd>
                {selectedNode.latencyP95Ms !== undefined
                  ? `${Math.round(selectedNode.latencyP95Ms)}ms`
                  : "—"}
              </dd>
            </div>
          </dl>
          {nodeDependencies.length > 0 ? (
            <div className="graph-inspect-section">
              <div className="graph-inspect-label">Dependencies</div>
              <div className="graph-inspect-chips">
                {nodeDependencies.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="graph-inspect-section">
            <div className="graph-inspect-label">
              Pods
              <button
                type="button"
                className="graph-inspect-link"
                onClick={() => {
                  toggleExpand(selectedNode.id);
                  if (lod !== "pod" && lod !== "flow") {
                    setLod("pod", true);
                  }
                }}
              >
                {expandedNodeIds.has(selectedNode.id) || lod === "pod" ? "Expanded" : "Expand"}
              </button>
            </div>
            {expandedNodeIds.has(selectedNode.id) || lod === "pod" || lod === "flow" ? (
              <ul className="graph-inspect-pods">
                {selectedNode.memberPods.length === 0 ? (
                  <li className="muted">No member pods indexed</li>
                ) : (
                  selectedNode.memberPods.map((pod) => (
                    <li key={pod.id}>
                      <span className={`graph-pod-dot status-${pod.status}`} />
                      {pod.name}
                    </li>
                  ))
                )}
              </ul>
            ) : (
              <p className="graph-inspect-hint">
                {selectedNode.podCount} pod{selectedNode.podCount === 1 ? "" : "s"} collapsed · expand or
                zoom to Pod level
              </p>
            )}
          </div>
          {onStartInvestigation || onNavigate ? (
            <div className="graph-inspect-section">
              <div className="graph-inspect-label">Investigate</div>
              <div className="graph-inspect-actions">
                {/* Previous: jumped pages without carrying service context.
                <button type="button" onClick={() => onNavigate("profiling", "profiling")}>
                  Open Profile
                </button>
                <button type="button" onClick={() => onNavigate("network", "network-dns")}>
                  Open DNS
                </button>
                <button type="button" onClick={() => onNavigate("network", "network-tcp")}>
                  Open TCP
                </button>
                <button type="button" onClick={() => onNavigate("events", "events")}>
                  Open Timeline
                </button>
                <button type="button" onClick={() => onNavigate("network", "network-map")}>
                  Open Map
                </button>
                */}
                {INVESTIGATE_ACTIONS.map((action) => (
                  <button
                    key={action.page}
                    type="button"
                    onClick={() => {
                      const focus: Omit<InvestigationFocus, "startedAt" | "clusterName"> = {
                        kind:
                          selectedNode.kind === "Pod" ||
                          selectedNode.kind === "Service" ||
                          selectedNode.kind === "Workload" ||
                          selectedNode.kind === "Namespace"
                            ? selectedNode.kind
                            : "Service",
                        name: selectedNode.name,
                        namespace: selectedNode.namespace,
                        memberPods: selectedNode.memberPods.map((pod) => pod.name),
                        startedFrom,
                      };
                      if (onStartInvestigation) {
                        onStartInvestigation(focus, { nav: action.nav, page: action.page });
                        return;
                      }
                      // Fallback if only legacy navigate is wired.
                      onNavigate?.(action.nav, action.page);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}

      <div
        className="graph-transform-layer"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <svg
          className="graph-canvas"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="Service topology graph"
        >
          <defs>
            {(["ok", "warn", "bad"] as const).map((health) => (
              <marker
                key={health}
                id={`arrow-${health}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={HEALTH_STROKE[health]} />
              </marker>
            ))}
          </defs>

          <rect className="graph-bg-hit" x={0} y={0} width={layout.width} height={layout.height} />

          {layout.namespaces.map((box) => (
            <g key={box.name} className="graph-ns graph-ns-lane">
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx="4"
                className="graph-ns-box"
              />
              <line
                x1={box.x + 12}
                y1={box.y + 22}
                x2={box.x + box.width - 12}
                y2={box.y + 22}
                className="graph-ns-rule"
              />
              <text x={box.x + 14} y={box.y + 18} className="graph-ns-label">
                {box.name}
              </text>
            </g>
          ))}

          {layout.edges.map((edge) => {
            const selected = selectedEdgeId === edge.id;
            const hovered = hoveredEdgeId === edge.id;
            const dimmed =
              linkedNodeIds !== null &&
              (focusNodeId
                ? !(linkedEdgeIds?.has(edge.id) ?? false)
                : focusEdgeId !== edge.id);
            const stroke = edgeStroke(edge);
            const strokeWidth =
              (edge.flowCount > 0 ? 1.8 + Math.min(edge.requestsPerSec / 40, 2.2) : selected || hovered ? 2 : 1.2) +
              (edge.bundledCount > 1 ? Math.min(edge.bundledCount * 0.35, 2) : 0);
            const particleCount = Math.min(5, Math.max(1, Math.round(edge.requestsPerSec / 30)));
            return (
              <g
                key={edge.id}
                className={edgeClass(edge, selected, hovered, dimmed)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge(edge.id);
                  onSelectNode?.(null);
                }}
                onMouseEnter={(event) => {
                  showEdgeHover(edge.id, event.clientX, event.clientY);
                }}
                onMouseMove={(event) => {
                  showEdgeHover(edge.id, event.clientX, event.clientY);
                }}
                onMouseLeave={() => {
                  scheduleHoverClear();
                }}
              >
                <path
                  d={edge.path}
                  className="graph-edge-hit"
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
                />
                <path
                  d={edge.path}
                  className="graph-edge-path"
                  markerEnd={`url(#arrow-${edge.health})`}
                  style={{
                    stroke,
                    strokeWidth,
                    opacity: dimmed ? 0.12 : 0.92,
                  }}
                />
                {edge.flowCount > 0 && !dimmed
                  ? Array.from({ length: particleCount }, (_, index) => (
                      <circle
                        key={`${edge.id}-p-${index}`}
                        r={2.2}
                        fill={stroke}
                        className="graph-edge-particle"
                        style={{ animationDelay: `${index * 0.35}s` }}
                      >
                        <animateMotion
                          dur={`${1.6 + (index % 3) * 0.35}s`}
                          repeatCount="indefinite"
                          path={edge.path}
                        />
                      </circle>
                    ))
                  : null}
                {labelLod !== "minimal" ? (
                  <text
                    x={edge.labelX}
                    y={edge.labelY}
                    className={`graph-edge-label is-hoverable${edge.health !== "ok" ? ` health-${edge.health}` : ""}`}
                    fill={stroke}
                    opacity={dimmed ? 0.15 : 0.9}
                    onMouseEnter={(event) => {
                      showEdgeHover(edge.id, event.clientX, event.clientY);
                    }}
                  >
                    {hopEdgeLabel(edge, labelLod === "full")}
                  </text>
                ) : null}
              </g>
            );
          })}

          {layout.nodes.map((node) => {
            const linked = linkedNodeIds?.has(node.id) ?? false;
            const dimmed = linkedNodeIds !== null && !linked;
            const selected = selectedNodeId === node.id;
            const expanded = expandedNodeIds.has(node.id);
            const displayName = truncateNodeName(node.name, labelLod === "minimal" ? 16 : 22);
            const isPod = node.kind === "Pod";
            return (
              <g
                key={node.id}
                className={`graph-node graph-service-node kind-${node.kind.toLowerCase()} status-${node.status} ${linked ? "linked" : ""} ${dimmed ? "dimmed" : ""} ${selected ? "selected" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode?.(node.id);
                  if (node.kind === "Namespace" && onLodChange) {
                    setLod("namespace", true);
                  }
                  const match = layout.edges.find(
                    (edge) => edge.from === node.id || edge.to === node.id,
                  );
                  if (match) {
                    onSelectEdge(match.id);
                  }
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  toggleExpand(node.id);
                  if (!isPod) {
                    setLod("pod", true);
                  } else {
                    setLod("flow", true);
                  }
                }}
              >
                <title>
                  {node.kind}/{node.namespace}/{node.name}
                </title>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={isPod ? 4 : 8}
                  className="graph-node-box"
                />
                <circle
                  cx={node.x + 16}
                  cy={node.y + (isPod ? node.height / 2 : 18)}
                  r="4"
                  className={`graph-node-status status-${node.status}`}
                />
                <text
                  x={node.x + 28}
                  y={node.y + (isPod ? node.height / 2 + 4 : 22)}
                  className="graph-node-name"
                >
                  {displayName}
                </text>
                {!isPod && labelLod !== "minimal" ? (
                  <>
                    <text x={node.x + 16} y={node.y + 44} className="graph-node-meta">
                      {statusLabel(node.status)} · {node.podCount} Pod
                      {node.podCount === 1 ? "" : "s"}
                    </text>
                    {labelLod === "full" ? (
                      <text x={node.x + 16} y={node.y + 64} className="graph-node-metrics">
                        {node.requestsPerSec > 0 ? `${node.requestsPerSec} req/s` : "idle"}
                        {node.latencyP95Ms !== undefined
                          ? ` · P95 ${Math.round(node.latencyP95Ms)}ms`
                          : ""}
                      </text>
                    ) : null}
                  </>
                ) : null}
                {!isPod && labelLod === "minimal" ? (
                  <text x={node.x + 16} y={node.y + 44} className="graph-node-meta">
                    {node.kind === "Namespace"
                      ? `${node.podCount} pods`
                      : `${node.podCount} pods`}
                  </text>
                ) : null}
                {expanded && node.memberPods.length > 0 && lod === "service" ? (
                  <text x={node.x + 16} y={node.y + node.height - 12} className="graph-node-expand">
                    {node.memberPods
                      .slice(0, 2)
                      .map((pod) => truncateNodeName(pod.name, 18))
                      .join(" · ")}
                    {node.memberPods.length > 2 ? ` +${node.memberPods.length - 2}` : ""}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function GraphLegend() {
  return (
    <div className="graph-legend graph-legend-inline">
      <span className="legend-item legend-health ok">Healthy</span>
      <span className="legend-item legend-health warn">Latency</span>
      <span className="legend-item legend-health bad">Drops</span>
      <span className="legend-item legend-proto dns">DNS</span>
      <span className="legend-item legend-proto grpc">gRPC</span>
      <span className="legend-item legend-proto kafka">Kafka</span>
    </div>
  );
}
