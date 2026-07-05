import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { edgeHeat, flameColor } from "../../core/network/flame-colors";
import { truncateNodeName, type GraphEdgeLayout, type GraphLayout } from "../../core/network/graph-model";

interface TopologyGraphProps {
  layout: GraphLayout;
  connected: boolean;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
}

function edgeClass(edge: GraphEdgeLayout, selected: boolean, hovered: boolean, dimmed: boolean): string {
  const classes = ["graph-edge"];
  if (selected) {
    classes.push("selected");
  }
  if (hovered) {
    classes.push("hovered");
  }
  if (dimmed) {
    classes.push("dimmed");
  }
  if (edge.verdict === "TIMEOUT" || edge.verdict === "DROPPED") {
    classes.push("edge-bad");
  } else if (edge.verdict === "RETRY" || edge.verdict === "UNKNOWN") {
    classes.push("edge-warn");
  } else {
    classes.push("edge-ok");
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

export function TopologyGraph({
  layout,
  connected,
  selectedEdgeId,
  onSelectEdge,
}: TopologyGraphProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const focusEdgeId = hoveredEdgeId ?? selectedEdgeId;
  const linkedNodeIds = useMemo(() => {
    if (!focusEdgeId) {
      return null;
    }
    const edge = layout.edges.find((item) => item.id === focusEdgeId);
    if (!edge) {
      return null;
    }
    return new Set([edge.from, edge.to]);
  }, [focusEdgeId, layout.edges]);

  const { maxFlows, maxLatency, nodeHeat } = useMemo(() => {
    const maxF = Math.max(...layout.edges.map((edge) => edge.flowCount), 1);
    const maxL = Math.max(...layout.edges.map((edge) => edge.latencyP99Ms ?? 0), 1);
    const heatMap = new Map<string, number>();

    for (const edge of layout.edges) {
      const heat = edgeHeat(edge.flowCount, edge.latencyP99Ms, maxF, maxL);
      for (const nodeId of [edge.from, edge.to]) {
        heatMap.set(nodeId, Math.max(heatMap.get(nodeId) ?? 0, heat));
      }
    }

    return { maxFlows: maxF, maxLatency: maxL, nodeHeat: heatMap };
  }, [layout.edges]);

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || layout.width <= 0 || layout.height <= 0) {
      return;
    }
    const pad = 36;
    const scale = Math.min(
      (viewport.clientWidth - pad) / layout.width,
      (viewport.clientHeight - pad) / layout.height,
      2.5,
    );
    const nextZoom = Math.max(0.35, scale);
    setZoom(nextZoom);
    setPan({
      x: (viewport.clientWidth - layout.width * nextZoom) / 2,
      y: (viewport.clientHeight - layout.height * nextZoom) / 2,
    });
  }, [layout.width, layout.height]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

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

  if (layout.nodes.length === 0) {
    return (
      <div className="graph-empty">
        {connected ? "Waiting for pods and flows…" : "Connect to visualize pod → pod traffic"}
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`graph-viewport ${linkedNodeIds ? "has-focus" : ""}`}
      onWheel={handleWheel}
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest(".graph-node") || target.closest(".graph-edge")) {
          return;
        }
        startPan(event.clientX, event.clientY);
      }}
    >
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
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="graph-arrowhead" />
            </marker>
          </defs>

          <rect className="graph-bg-hit" x={0} y={0} width={layout.width} height={layout.height} />

          {layout.namespaces.map((box) => (
            <g key={box.name} className="graph-ns">
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                rx="2"
                className="graph-ns-box"
              />
              <text x={box.x + 12} y={box.y + 20} className="graph-ns-label">
                {box.name}
              </text>
            </g>
          ))}

          {layout.edges.map((edge) => {
            const selected = selectedEdgeId === edge.id;
            const hovered = hoveredEdgeId === edge.id;
            const dimmed = linkedNodeIds !== null && focusEdgeId !== edge.id;
            const heat = edgeHeat(edge.flowCount, edge.latencyP99Ms, maxFlows, maxLatency);
            const stroke = flameColor(heat, edge.flowCount > 0 ? 0.95 : 0.35);
            const strokeWidth =
              edge.flowCount > 0 ? 1.5 + heat * 2.5 : selected || hovered ? 2 : 1.25;
            return (
              <g
                key={edge.id}
                className={edgeClass(edge, selected, hovered, dimmed)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
              >
                <path
                  d={edge.path}
                  className="graph-edge-path graph-edge-flame"
                  markerEnd="url(#arrow)"
                  style={{
                    stroke,
                    strokeWidth,
                    opacity: dimmed ? 0.18 : 1,
                  }}
                />
                <text
                  x={edge.labelX}
                  y={edge.labelY}
                  className="graph-edge-label"
                  fill={flameColor(heat, 0.9)}
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {layout.nodes.map((node) => {
            const linked = linkedNodeIds?.has(node.id) ?? false;
            const dimmed = linkedNodeIds !== null && !linked;
            const displayName = truncateNodeName(node.name);
            const heat = nodeHeat.get(node.id) ?? 0.06;
            const accent = flameColor(heat, 0.95);
            const fill = flameColor(heat, 0.1);
            return (
              <g
                key={node.id}
                className={`graph-node ${linked ? "linked" : ""} ${dimmed ? "dimmed" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const match = layout.edges.find(
                    (edge) => edge.from === node.id || edge.to === node.id,
                  );
                  if (match) {
                    onSelectEdge(match.id);
                  }
                }}
              >
                <title>{node.kind}/{node.name}</title>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx="2"
                  className={`graph-node-box status-${node.status}`}
                  fill={fill}
                  stroke={accent}
                  strokeWidth={linked ? 2 : 1}
                />
                <circle
                  cx={node.x + 14}
                  cy={node.y + node.height / 2}
                  r="4"
                  fill={accent}
                  stroke={accent}
                />
                <text x={node.x + 26} y={node.y + 18} className="graph-node-kind">
                  {node.kind}
                </text>
                <text x={node.x + 26} y={node.y + 34} className="graph-node-name">
                  {displayName}
                </text>
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
      <span className="legend-item legend-heat">
        <span className="legend-heat-bar" aria-hidden />
        Low → High traffic
      </span>
      <span className="legend-item edge-ebpf">Kernel</span>
      <span className="legend-item edge-k8s">Inferred</span>
    </div>
  );
}
