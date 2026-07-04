export interface LatencyStats {
  sampleCount: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface HistogramBucket {
  label: string;
  fromMs: number;
  toMs: number;
  count: number;
}

export interface LatencyHistogram {
  stats: LatencyStats;
  buckets: HistogramBucket[];
}

export const HISTOGRAM_BOUNDS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, Infinity];

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

export function computeLatencyStats(samples: number[]): LatencyStats | null {
  if (samples.length === 0) {
    return null;
  }
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    sampleCount: samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    avgMs: Math.round(sum / samples.length),
    p50Ms: Math.round(percentile(samples, 0.5)),
    p95Ms: Math.round(percentile(samples, 0.95)),
    p99Ms: Math.round(percentile(samples, 0.99)),
  };
}

export function buildLatencyHistogram(samples: number[]): LatencyHistogram | null {
  const stats = computeLatencyStats(samples);
  if (!stats) {
    return null;
  }

  const bounds = HISTOGRAM_BOUNDS_MS;
  const buckets: HistogramBucket[] = [];

  for (let index = 0; index < bounds.length; index += 1) {
    const fromMs = index === 0 ? 0 : bounds[index - 1];
    const toMs = bounds[index];
    const count = samples.filter((value) => value >= fromMs && value < toMs).length;
    const label =
      toMs === Infinity ? `${fromMs}ms+` : index === 0 ? `<${toMs}ms` : `${fromMs}-${toMs}ms`;
    buckets.push({ label, fromMs, toMs, count });
  }

  return { stats, buckets };
}

export function buildTrafficSeries(
  timestamps: string[],
  windowMs = 15 * 60_000,
  bucketCount = 15,
): number[] {
  if (timestamps.length === 0) {
    return Array.from({ length: bucketCount }, () => 0);
  }

  const now = Date.now();
  const start = now - windowMs;
  const bucketSize = windowMs / bucketCount;
  const series = Array.from({ length: bucketCount }, () => 0);

  for (const timestamp of timestamps) {
    const time = new Date(timestamp).getTime();
    if (time < start || time > now) {
      continue;
    }
    const index = Math.min(bucketCount - 1, Math.floor((time - start) / bucketSize));
    series[index] += 1;
  }

  return series;
}

export function edgeLatencyVerdict(p99Ms: number): "OK" | "TIMEOUT" {
  return p99Ms > 500 ? "TIMEOUT" : "OK";
}
