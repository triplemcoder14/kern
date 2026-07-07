package profile

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/kern/agent/internal/store"
)

type pathAgg struct {
	label   string
	latency uint32
	drops   uint32
	count   int
}

func buildNetworkProfile(flows *store.FlowStore) NetworkProfile {
	snapshot := flows.Snapshot(500)
	latencies := make([]uint32, 0, len(snapshot))
	var drops uint32

	paths := make(map[string]*pathAgg)
	for _, flow := range snapshot {
		if flow.LatencyMs != nil {
			latencies = append(latencies, *flow.LatencyMs)
		}
		if flow.Verdict == "DROPPED" || flow.Verdict == "TIMEOUT" {
			drops++
		}

		label := flowLabel(flow)
		agg, ok := paths[label]
		if !ok {
			agg = &pathAgg{label: label}
			paths[label] = agg
		}
		agg.count++
		if flow.LatencyMs != nil && *flow.LatencyMs > agg.latency {
			agg.latency = *flow.LatencyMs
		}
		if flow.Verdict == "DROPPED" || flow.Verdict == "TIMEOUT" {
			agg.drops++
		}
	}

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

	profile := NetworkProfile{
		P50Ms:          percentile(latencies, 50),
		P95Ms:          percentile(latencies, 95),
		Drops:          drops,
		FlowsPerSecond: flows.FlowsPerSecond(),
		Stack:          buildStack(paths),
		Log:            buildLog(snapshot),
	}
	return profile
}

func flowLabel(flow store.Flow) string {
	if flow.Path != "" {
		parts := strings.Split(flow.Path, "→")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	if flow.DstService != "" {
		ns := flow.DstServiceNamespace
		if ns == "" {
			ns = "default"
		}
		return fmt.Sprintf("%s.%s:%d", flow.DstService, ns, flow.Port)
	}
	return fmt.Sprintf("%s:%d/%s", flow.DstIP, flow.Port, flow.Protocol)
}

func percentile(values []uint32, pct int) uint32 {
	if len(values) == 0 {
		return 0
	}
	idx := (pct * len(values)) / 100
	if idx >= len(values) {
		idx = len(values) - 1
	}
	return values[idx]
}

func buildStack(paths map[string]*pathAgg) []StackFrame {
	items := make([]*pathAgg, 0, len(paths))
	for _, agg := range paths {
		items = append(items, agg)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].latency == items[j].latency {
			return items[i].count > items[j].count
		}
		return items[i].latency > items[j].latency
	})
	if len(items) > 6 {
		items = items[:6]
	}

	maxLatency := uint32(1)
	for _, item := range items {
		if item.latency > maxLatency {
			maxLatency = item.latency
		}
	}

	stack := []StackFrame{
		{Label: "network stack", Depth: 0, Width: 1, Offset: 0, Heat: 0.15},
	}

	rowWidth := 1.0
	offset := 0.0
	for index, item := range items {
		width := 0.35 + (float64(item.latency)/float64(maxLatency))*0.55
		if width > rowWidth {
			width = rowWidth
		}
		heat := float64(item.latency) / float64(maxLatency)
		if item.drops > 0 {
			heat = min(1, heat+0.25)
		}
		stack = append(stack, StackFrame{
			Label:  item.label,
			Depth:  1 + (index % 2),
			Width:  width,
			Offset: offset,
			Heat:   heat,
		})
		offset += width * 0.55
		rowWidth -= width * 0.45
		if rowWidth < 0.15 {
			rowWidth = 0.15
			offset = 0
		}
	}

	return stack
}

func buildLog(snapshot []store.Flow) []LogLine {
	lines := make([]LogLine, 0, 8)
	for _, flow := range snapshot {
		if len(lines) >= 8 {
			break
		}
		if flow.Verdict != "DROPPED" && flow.Verdict != "TIMEOUT" && (flow.LatencyMs == nil || *flow.LatencyMs < 80) {
			continue
		}

		tone := "ok"
		severity := "INFO"
		value := "stable"
		if flow.LatencyMs != nil {
			value = fmt.Sprintf("%dms", *flow.LatencyMs)
		}
		if flow.Verdict == "DROPPED" {
			tone = "bad"
			severity = "CRIT"
			value = "drop"
		} else if flow.Verdict == "TIMEOUT" {
			tone = "warn"
			severity = "WARN"
			value = "timeout"
		} else if flow.LatencyMs != nil && *flow.LatencyMs >= 80 {
			tone = "warn"
			severity = "WARN"
		}

		lines = append(lines, LogLine{
			Time:      flow.LastSeen.Local().Format("15:04:05"),
			Severity:  severity,
			Event:     flowLabel(flow),
			Value:     value,
			Tone:      tone,
			Timestamp: flow.LastSeen.UTC().Format(time.RFC3339Nano),
		})
	}
	return lines
}

func deriveHealth(network NetworkProfile, cpuPercent float64, load1 float64, cores int) string {
	return deriveHealthWithPSI(network, cpuPercent, load1, cores, PSISnapshot{}, MemoryDetail{})
}

func deriveHealthWithPSI(
	network NetworkProfile,
	cpuPercent float64,
	load1 float64,
	cores int,
	psi PSISnapshot,
	memDetail MemoryDetail,
) string {
	if network.Drops > 0 || network.P95Ms >= 150 {
		return "warn"
	}
	if psi.CPULevel == PSICritical || psi.MemoryLevel == PSICritical {
		return "warn"
	}
	if cpuPercent >= 85 || (cores > 0 && load1/float64(cores) >= 0.9) {
		return "warn"
	}
	if memDetail.ReclaimActivity == "High" || psi.CPULevel == PSIWarn || psi.MemoryLevel == PSIWarn {
		return "warn"
	}
	if network.P95Ms == 0 && network.FlowsPerSecond == 0 && cpuPercent == 0 {
		return "unknown"
	}
	return "ok"
}
