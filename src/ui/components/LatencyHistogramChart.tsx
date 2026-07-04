import type { LatencyHistogram } from "../../core/network/latency";

interface LatencyHistogramChartProps {
  histogram: LatencyHistogram | null;
  width?: number;
  height?: number;
  compact?: boolean;
}

export function LatencyHistogramChart({
  histogram,
  width = 280,
  height = 96,
  compact = false,
}: LatencyHistogramChartProps) {
  if (!histogram || histogram.stats.sampleCount === 0) {
    return (
      <div className={`latency-chart empty ${compact ? "compact" : ""}`}>
        No latency samples yet
      </div>
    );
  }

  const maxCount = Math.max(...histogram.buckets.map((bucket) => bucket.count), 1);
  const barWidth = width / histogram.buckets.length - 4;
  const chartHeight = compact ? height - 8 : height - 24;

  return (
    <div className={`latency-chart ${compact ? "compact" : ""}`}>
      {!compact ? (
        <div className="latency-chart-stats">
          <span>p50 {histogram.stats.p50Ms}ms</span>
          <span>p95 {histogram.stats.p95Ms}ms</span>
          <span>p99 {histogram.stats.p99Ms}ms</span>
        </div>
      ) : null}
      <svg width={width} height={height} role="img" aria-label="Latency histogram">
        {histogram.buckets.map((bucket, index) => {
          const barHeight = (bucket.count / maxCount) * chartHeight;
          const x = index * (barWidth + 4) + 2;
          const y = height - barHeight - (compact ? 4 : 20);
          return (
            <g key={bucket.label}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, bucket.count > 0 ? 2 : 0)}
                className="latency-bar"
              />
              {!compact && bucket.count > 0 ? (
                <text x={x + barWidth / 2} y={height - 4} className="latency-bar-label">
                  {bucket.count}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface TrafficSparklineProps {
  series: number[];
  width?: number;
  height?: number;
  compact?: boolean;
}

export function TrafficSparkline({
  series,
  width = 280,
  height = 48,
  compact = false,
}: TrafficSparklineProps) {
  const max = Math.max(...series, 1);
  const step = width / Math.max(series.length - 1, 1);
  const points = series
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / max) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className={`traffic-sparkline ${compact ? "compact" : ""}`}>
      {!compact ? <div className="flow-detail-heading">TRAFFIC · LAST 15M</div> : null}
      <svg width={width} height={height} role="img" aria-label="Traffic over time">
        <polyline points={points} className="sparkline-line" fill="none" />
        {series.map((value, index) => {
          const x = index * step;
          const y = height - (value / max) * (height - 8) - 4;
          return value > 0 ? <circle key={index} cx={x} cy={y} r="2" className="sparkline-dot" /> : null;
        })}
      </svg>
    </div>
  );
}
