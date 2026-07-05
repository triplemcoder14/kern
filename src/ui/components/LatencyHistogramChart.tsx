import { bucketHeat, flameColor, valueHeat } from "../../core/network/flame-colors";
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
          <span style={{ color: flameColor(0.88) }} className="latency-hot">
            p99 {histogram.stats.p99Ms}ms
          </span>
        </div>
      ) : null}
      <svg width={width} height={height} role="img" aria-label="Latency histogram">
        {histogram.buckets.map((bucket, index) => {
          const barHeight = (bucket.count / maxCount) * chartHeight;
          const x = index * (barWidth + 4) + 2;
          const y = height - barHeight - (compact ? 4 : 20);
          const heat = bucketHeat(index, histogram.buckets.length);
          const intensity = bucket.count > 0 ? 0.55 + (bucket.count / maxCount) * 0.45 : 0.2;
          return (
            <g key={bucket.label}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, bucket.count > 0 ? 2 : 0)}
                className="latency-bar"
                fill={flameColor(heat, intensity)}
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

function FlameSparkline({
  series,
  width,
  height,
  dotRadius = 2,
}: {
  series: number[];
  width: number;
  height: number;
  dotRadius?: number;
}) {
  const max = Math.max(...series, 1);
  const step = width / Math.max(series.length - 1, 1);
  const points = series.map((value, index) => ({
    x: index * step,
    y: height - (value / max) * (height - 8) - 4,
    value,
  }));

  return (
    <>
      {points.slice(0, -1).map((point, index) => {
        const next = points[index + 1];
        const heat = valueHeat(Math.max(point.value, next.value), max);
        return (
          <line
            key={index}
            x1={point.x}
            y1={point.y}
            x2={next.x}
            y2={next.y}
            className="sparkline-segment"
            stroke={flameColor(heat, 0.95)}
            strokeWidth={1.5}
          />
        );
      })}
      {points.map((point, index) =>
        point.value > 0 ? (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={dotRadius}
            className="sparkline-dot"
            fill={flameColor(valueHeat(point.value, max), 0.95)}
          />
        ) : null,
      )}
    </>
  );
}

export function TrafficSparkline({
  series,
  width = 280,
  height = 48,
  compact = false,
}: TrafficSparklineProps) {
  return (
    <div className={`traffic-sparkline ${compact ? "compact" : ""}`}>
      {!compact ? <div className="flow-detail-heading">TRAFFIC · LAST 15M</div> : null}
      <svg width={width} height={height} role="img" aria-label="Traffic over time">
        <FlameSparkline series={series} width={width} height={height} />
      </svg>
    </div>
  );
}

interface MiniSparklineProps {
  series: number[];
  width?: number;
  height?: number;
}

export function MiniSparkline({ series, width = 140, height = 28 }: MiniSparklineProps) {
  return (
    <svg width={width} height={height} aria-hidden className="mini-sparkline">
      <FlameSparkline series={series} width={width} height={height} dotRadius={1.5} />
    </svg>
  );
}

export function talkerBarColor(count: number, max: number): string {
  return flameColor(valueHeat(count, max), 0.92);
}
