package profile

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/kern/agent/internal/store"
)

type pathAgg struct {
	label        string
	subtitle     string
	namespace    string
	endpointKind string
	ip           string
	protocol     string
	port         uint16
	path         string
	latency      uint32
	drops        uint32
	bytes        uint64
	retransmits  uint32
	count        int
	score        float64
	sources      map[string]*srcAgg
}

type srcAgg struct {
	label        string
	subtitle     string
	namespace    string
	endpointKind string
	ip           string
	bytes        uint64
	retransmits  uint32
	latency      uint32
	count        int
	score        float64
	path         string
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

		key, aggSeed := flowAggKey(flow)
		agg, ok := paths[key]
		if !ok {
			agg = aggSeed
			agg.sources = make(map[string]*srcAgg)
			paths[key] = agg
		}
		agg.count++
		agg.score += flowScore(flow)
		agg.bytes += flowBytes(flow)
		if flow.Retransmits != nil {
			agg.retransmits += *flow.Retransmits
		}
		if flow.LatencyMs != nil && *flow.LatencyMs > agg.latency {
			agg.latency = *flow.LatencyMs
		}
		if flow.Verdict == "DROPPED" || flow.Verdict == "TIMEOUT" {
			agg.drops++
		}
		if flow.Path != "" {
			agg.path = flow.Path
		}
		accumulateSource(agg, flow)
	}

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

	profile := NetworkProfile{
		P50Ms:          percentile(latencies, 50),
		P95Ms:          percentile(latencies, 95),
		Drops:          drops,
		FlowsPerSecond: flows.FlowsPerSecond(),
		Stack:          buildStack(paths, len(snapshot)),
		Log:            buildLog(snapshot),
	}
	return profile
}

func flowBytes(flow store.Flow) uint64 {
	var total uint64
	if flow.BytesSent != nil {
		total += *flow.BytesSent
	}
	if flow.BytesReceived != nil {
		total += *flow.BytesReceived
	}
	return total
}

func flowScore(flow store.Flow) float64 {
	bytes := float64(flowBytes(flow))
	if bytes < 1 {
		bytes = 1
	}
	latency := float64(0)
	if flow.LatencyMs != nil {
		latency = float64(*flow.LatencyMs)
	}
	retransmits := float64(0)
	if flow.Retransmits != nil {
		retransmits = float64(*flow.Retransmits)
	}
	return bytes + latency*2000 + retransmits*50000
}

func flowAggKey(flow store.Flow) (string, *pathAgg) {
	protocol := flow.Protocol
	if protocol == "" || protocol == "UNKNOWN" {
		protocol = "TCP"
	}

	if flow.DstService != "" {
		ns := flow.DstServiceNamespace
		if ns == "" {
			ns = "default"
		}
		return fmt.Sprintf("svc:%s:%s:%d:%s", ns, flow.DstService, flow.Port, protocol), &pathAgg{
			label:        flow.DstService,
			subtitle:     fmt.Sprintf("Service · %s · %s/%d", ns, protocol, flow.Port),
			namespace:    ns,
			endpointKind: "Service",
			protocol:     protocol,
			port:         flow.Port,
			path:         flow.Path,
		}
	}

	if flow.DstPod != "" {
		ns := flow.DstNamespace
		if ns == "" {
			ns = "default"
		}
		return fmt.Sprintf("pod:%s:%s:%d:%s", ns, flow.DstPod, flow.Port, protocol), &pathAgg{
			label:        flow.DstPod,
			subtitle:     fmt.Sprintf("Pod · %s · %s/%d", ns, protocol, flow.Port),
			namespace:    ns,
			endpointKind: "Pod",
			protocol:     protocol,
			port:         flow.Port,
			path:         flow.Path,
		}
	}

	label := flow.DstIP
	if flow.Path != "" {
		parts := strings.Split(flow.Path, "→")
		if len(parts) > 0 {
			last := strings.TrimSpace(parts[len(parts)-1])
			if last != "" {
				label = last
			}
		}
	}
	return fmt.Sprintf("ext:%s:%d:%s", flow.DstIP, flow.Port, protocol), &pathAgg{
		label:        label,
		subtitle:     fmt.Sprintf("External · %s/%d", protocol, flow.Port),
		endpointKind: "External",
		ip:           flow.DstIP,
		protocol:     protocol,
		port:         flow.Port,
		path:         flow.Path,
	}
}

func accumulateSource(agg *pathAgg, flow store.Flow) {
	var key, label, subtitle, ns, kind, ip string
	if flow.SrcPod != "" {
		ns = flow.SrcNamespace
		if ns == "" {
			ns = "default"
		}
		key = fmt.Sprintf("pod:%s:%s", ns, flow.SrcPod)
		label = flow.SrcPod
		subtitle = fmt.Sprintf("Pod · %s", ns)
		kind = "Pod"
	} else if flow.SrcService != "" {
		ns = flow.SrcServiceNamespace
		if ns == "" {
			ns = "default"
		}
		key = fmt.Sprintf("svc:%s:%s", ns, flow.SrcService)
		label = flow.SrcService
		subtitle = fmt.Sprintf("Service · %s", ns)
		kind = "Service"
	} else {
		return
	}

	src, ok := agg.sources[key]
	if !ok {
		src = &srcAgg{
			label:        label,
			subtitle:     subtitle,
			namespace:    ns,
			endpointKind: kind,
			ip:           ip,
		}
		agg.sources[key] = src
	}
	src.count++
	src.score += flowScore(flow)
	src.bytes += flowBytes(flow)
	if flow.Retransmits != nil {
		src.retransmits += *flow.Retransmits
	}
	if flow.LatencyMs != nil && *flow.LatencyMs > src.latency {
		src.latency = *flow.LatencyMs
	}
	if flow.Path != "" {
		src.path = flow.Path
	}
}

func flowLabel(flow store.Flow) string {
	_, seed := flowAggKey(flow)
	return seed.label
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

func buildStack(paths map[string]*pathAgg, flowCount int) []StackFrame {
	items := make([]*pathAgg, 0, len(paths))
	var totalScore float64
	var totalBytes uint64
	for _, agg := range paths {
		items = append(items, agg)
		totalScore += agg.score
		totalBytes += agg.bytes
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].latency > items[j].latency
		}
		return items[i].score > items[j].score
	})
	if len(items) > 8 {
		items = items[:8]
	}
	if totalScore < 1 {
		totalScore = 1
	}

	maxLatency := uint32(1)
	for _, item := range items {
		if item.latency > maxLatency {
			maxLatency = item.latency
		}
	}

	// Group by protocol for a Network → Protocol → Endpoint → Workload flame.
	byProtocol := map[string][]*pathAgg{}
	protocolOrder := make([]string, 0)
	for _, item := range items {
		proto := item.protocol
		if proto == "" {
			proto = "TCP"
		}
		if _, ok := byProtocol[proto]; !ok {
			protocolOrder = append(protocolOrder, proto)
		}
		byProtocol[proto] = append(byProtocol[proto], item)
	}

	stack := []StackFrame{
		{
			ID:        "root",
			Label:     "network stack",
			Subtitle:  fmt.Sprintf("%d flows", flowCount),
			Depth:     0,
			Width:     1,
			Offset:    0,
			Heat:      0.12,
			Kind:      "root",
			SharePct:  100,
			FlowCount: flowCount,
			Bytes:     totalBytes,
		},
	}

	protoOffset := 0.0
	for _, proto := range protocolOrder {
		group := byProtocol[proto]
		var protoScore float64
		var protoBytes uint64
		var protoRetransmits uint32
		var protoFlows int
		var protoLatency uint32
		for _, item := range group {
			protoScore += item.score
			protoBytes += item.bytes
			protoRetransmits += item.retransmits
			protoFlows += item.count
			if item.latency > protoLatency {
				protoLatency = item.latency
			}
		}
		protoWidth := protoScore / totalScore
		if protoWidth < 0.12 {
			protoWidth = 0.12
		}
		protoShare := int((protoScore / totalScore) * 100)
		stack = append(stack, StackFrame{
			ID:          fmt.Sprintf("proto-%s", proto),
			Label:       proto,
			Subtitle:    fmt.Sprintf("%d destinations · %d%%", len(group), protoShare),
			Depth:       1,
			Width:       protoWidth,
			Offset:      protoOffset,
			Heat:        0.2 + float64(protoShare)/200,
			Kind:        "protocol",
			Protocol:    proto,
			SharePct:    protoShare,
			Bytes:       protoBytes,
			Retransmits: protoRetransmits,
			LatencyMs:   protoLatency,
			FlowCount:   protoFlows,
		})

		endpointScore := protoScore
		if endpointScore < 1 {
			endpointScore = 1
		}
		endpointOffset := protoOffset
		for _, item := range group {
			width := (item.score / endpointScore) * protoWidth
			if width < 0.08 {
				width = 0.08
			}
			share := int((item.score / totalScore) * 100)
			heat := float64(item.latency) / float64(maxLatency)
			if item.drops > 0 {
				heat = min(1, heat+0.25)
			}
			kind := "endpoint"
			if item.endpointKind == "Service" {
				kind = "service"
			}
			endpointID := fmt.Sprintf("dst-%s-%s-%d", proto, item.label, item.port)
			stack = append(stack, StackFrame{
				ID:           endpointID,
				Label:        item.label,
				Subtitle:     item.subtitle,
				Depth:        2,
				Width:        width,
				Offset:       endpointOffset,
				Heat:         heat,
				Kind:         kind,
				Protocol:     item.protocol,
				Port:         item.port,
				Namespace:    item.namespace,
				EndpointKind: item.endpointKind,
				IP:           item.ip,
				Bytes:        item.bytes,
				Retransmits:  item.retransmits,
				LatencyMs:    item.latency,
				SharePct:     share,
				Path:         item.path,
				FlowCount:    item.count,
			})

			sources := make([]*srcAgg, 0, len(item.sources))
			var sourceTotal float64
			for _, src := range item.sources {
				sources = append(sources, src)
				sourceTotal += src.score
			}
			sort.Slice(sources, func(i, j int) bool { return sources[i].score > sources[j].score })
			if len(sources) > 3 {
				sources = sources[:3]
			}
			if sourceTotal < 1 {
				sourceTotal = 1
			}
			sourceOffset := endpointOffset
			for _, src := range sources {
				sourceWidth := (src.score / sourceTotal) * width
				if sourceWidth < 0.06 {
					sourceWidth = 0.06
				}
				stack = append(stack, StackFrame{
					ID:           fmt.Sprintf("%s-src-%s", endpointID, src.label),
					Label:        src.label,
					Subtitle:     src.subtitle,
					Depth:        3,
					Width:        sourceWidth,
					Offset:       sourceOffset,
					Heat:         min(1, heat*0.85+float64(src.latency)/float64(maxLatency)*0.2),
					Kind:         "workload",
					Protocol:     item.protocol,
					Port:         item.port,
					Namespace:    src.namespace,
					EndpointKind: src.endpointKind,
					IP:           src.ip,
					Bytes:        src.bytes,
					Retransmits:  src.retransmits,
					LatencyMs:    src.latency,
					SharePct:     int((src.score / totalScore) * 100),
					Path:         firstNonEmpty(src.path, item.path),
					FlowCount:    src.count,
				})
				sourceOffset += sourceWidth * 0.92
			}

			endpointOffset += width * 0.92
		}
		protoOffset += protoWidth * 0.95
	}

	return stack
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
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
