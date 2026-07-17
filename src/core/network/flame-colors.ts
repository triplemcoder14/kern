/** Green (calm) → amber (pressure) → red (hot / error). */
const FLAME_STOPS: Array<[number, string]> = [
  [0, "#1f6b45"],
  [0.18, "#2f9e62"],
  [0.36, "#7cbc4a"],
  [0.5, "#d4a017"],
  [0.66, "#e07a1a"],
  [0.82, "#d94a2a"],
  [1, "#b42318"],
];

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function interpolateChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

/** Map normalized heat 0–1 to green → amber → red. */
export function flameColor(heat: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(1, heat));
  let lower = FLAME_STOPS[0];
  let upper = FLAME_STOPS[FLAME_STOPS.length - 1];

  for (let index = 0; index < FLAME_STOPS.length - 1; index += 1) {
    const next = FLAME_STOPS[index + 1];
    if (clamped >= FLAME_STOPS[index][0] && clamped <= next[0]) {
      lower = FLAME_STOPS[index];
      upper = next;
      break;
    }
  }

  const span = upper[0] - lower[0] || 1;
  const t = (clamped - lower[0]) / span;
  const [r1, g1, b1] = parseHex(lower[1]);
  const [r2, g2, b2] = parseHex(upper[1]);
  const r = interpolateChannel(r1, r2, t);
  const g = interpolateChannel(g1, g2, t);
  const b = interpolateChannel(b1, b2, t);

  if (alpha >= 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Readable label color on top of a heat fill. */
export function flameLabelColor(heat: number): string {
  return heat >= 0.48 ? "#fff8f0" : "#0f1a12";
}

/** Tone class from share of node CPU for selected-frame chips / legend. */
export function flameShareTone(sharePct?: number): "good" | "warn" | "hot" {
  if (sharePct === undefined) {
    return "good";
  }
  // if (sharePct >= 35) {
  //   return "hot";
  // }
  // if (sharePct >= 15) {
  //   return "warn";
  // }
  if (sharePct >= 20) {
    return "hot";
  }
  if (sharePct >= 10) {
    return "warn";
  }
  return "good";
}

export function edgeHeat(
  flowCount: number,
  latencyP99Ms: number | undefined,
  maxFlows: number,
  maxLatency: number,
): number {
  const flowHeat = flowCount / Math.max(maxFlows, 1);
  const latHeat = (latencyP99Ms ?? 0) / Math.max(maxLatency, 1);
  return Math.min(1, flowHeat * 0.55 + latHeat * 0.45);
}

export function valueHeat(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.min(1, value / max);
}

export function bucketHeat(index: number, total: number): number {
  if (total <= 1) {
    return 0;
  }
  return index / (total - 1);
}

export const FLAME_GRADIENT_CSS =
  "linear-gradient(90deg, #1f6b45 0%, #2f9e62 18%, #7cbc4a 36%, #d4a017 50%, #e07a1a 66%, #d94a2a 82%, #b42318 100%)";
