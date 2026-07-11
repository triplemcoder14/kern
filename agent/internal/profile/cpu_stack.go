package profile

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

func buildCPUStack(processes []ProcessSample, network NetworkProfile) ([]StackFrame, string) {
	if len(processes) == 0 {
		return network.Stack, "inferred"
	}

	top := processes[0]
	if kernelFrames := readProcessKernelStack(top.PID, 10); len(kernelFrames) > 0 {
		return buildCPUStackFromKernel(top, kernelFrames), "proc"
	}

	return buildInferredCPUStack(processes, network), "inferred"
}

func buildCPUStackFromKernel(top ProcessSample, kernelFrames []string) []StackFrame {
	frames := []StackFrame{
		{Label: "node", Depth: 0, Width: 1, Offset: 0, Heat: 0.12},
	}

	podLabel := top.Pod
	if podLabel == "" {
		podLabel = top.Name
	} else if top.Namespace != "" {
		podLabel = top.Namespace + "/" + top.Pod
	}

	frames = append(frames,
		StackFrame{Label: podLabel, Depth: 1, Width: 0.85, Offset: 0.02, Heat: 0.35},
		StackFrame{Label: top.Name + " pid " + strconvItoa(top.PID), Depth: 2, Width: 0.75, Offset: 0.04, Heat: 0.55},
	)

	for index, label := range kernelFrames {
		width := max(0.25, 0.7-float64(index)*0.05)
		frames = append(frames, StackFrame{
			Label:  label,
			Depth:  3 + index,
			Width:  width,
			Offset: 0.02,
			Heat:   min(1, 0.5+float64(index)*0.05),
		})
	}
	return frames
}

func buildInferredCPUStack(processes []ProcessSample, network NetworkProfile) []StackFrame {
	top := processes[0]
	kernelPath := inferKernelPath(top.Name, network)
	frames := []StackFrame{
		{Label: "node", Depth: 0, Width: 1, Offset: 0, Heat: 0.12},
	}

	podLabel := top.Pod
	if podLabel == "" {
		podLabel = top.Name
	} else if top.Namespace != "" {
		podLabel = top.Namespace + "/" + top.Pod
	}

	frames = append(frames,
		StackFrame{Label: podLabel, Depth: 1, Width: 0.85, Offset: 0.02, Heat: 0.35},
		StackFrame{Label: top.Name, Depth: 2, Width: 0.7, Offset: 0.08, Heat: 0.55},
	)

	parts := strings.Split(kernelPath, " → ")
	offset := 0.12
	for index, part := range parts {
		width := 0.65 - float64(index)*0.08
		if width < 0.25 {
			width = 0.25
		}
		frames = append(frames, StackFrame{
			Label:  part,
			Depth:  3 + index,
			Width:  width,
			Offset: offset,
			Heat:   min(1, 0.45+float64(index)*0.12),
		})
		offset += width * 0.35
	}

	return frames
}

func inferKernelPath(processName string, network NetworkProfile) string {
	if network.FlowsPerSecond > 100 || network.P95Ms > 80 {
		switch {
		case strings.Contains(processName, "nginx"):
			return "sendfile → tcp_sendmsg → ip_queue_xmit → dev_queue_xmit"
		case strings.Contains(processName, "node") || strings.Contains(processName, "java"):
			return "epoll_wait → entry_SYSCALL_64 → do_epoll_wait → tcp_sendmsg"
		default:
			return "entry_SYSCALL_64 → tcp_sendmsg → ip_queue_xmit → dev_queue_xmit"
		}
	}
	return "entry_SYSCALL_64 → schedule → run_queue"
}

func buildKernelHotspots(processes []ProcessSample, network NetworkProfile, kernelFrames []string, stackSource string) []KernelHotspot {
	if stackSource == "proc" && len(kernelFrames) > 0 {
		share := 1.0 / float64(len(kernelFrames))
		hotspots := make([]KernelHotspot, 0, len(kernelFrames))
		for _, label := range kernelFrames {
			hotspots = append(hotspots, KernelHotspot{
				Function: label,
				Share:    share,
				Meaning:  "Kernel stack frame from /proc/PID/stack",
			})
		}
		sort.Slice(hotspots, func(i, j int) bool {
			return hotspots[i].Share > hotspots[j].Share
		})
		if len(hotspots) > 5 {
			hotspots = hotspots[:5]
		}
		return hotspots
	}

	hotspots := []KernelHotspot{}
	path := inferKernelPath("", network)
	for index, part := range strings.Split(path, " → ") {
		share := max(0.15, 0.45-float64(index)*0.08)
		hotspots = append(hotspots, KernelHotspot{
			Function: part,
			Share:    share,
			Meaning:  kernelMeaning(part, network),
		})
	}

	if len(processes) > 0 && processes[0].Pod != "" {
		hotspots = append([]KernelHotspot{{
			Function: processes[0].Pod,
			Share:    0.2,
			Meaning:  "Top CPU pod on this node",
		}}, hotspots...)
	}

	sort.Slice(hotspots, func(i, j int) bool {
		return hotspots[i].Share > hotspots[j].Share
	})
	if len(hotspots) > 5 {
		hotspots = hotspots[:5]
	}
	return hotspots
}

func kernelMeaning(function string, network NetworkProfile) string {
	switch function {
	case "tcp_sendmsg", "ip_queue_xmit", "dev_queue_xmit":
		return "High network send path CPU"
	case "do_epoll_wait", "epoll_wait":
		return "Event loop waiting with active syscalls"
	case "schedule", "run_queue":
		return "Scheduler pressure on runnable threads"
	case "copy_user":
		return "User/kernel memory copies"
	case "ext4_write":
		return "Filesystem write path in kernel"
	default:
		if network.Drops > 0 {
			return "Network drops detected on this node"
		}
		return "Kernel hotspot from live sampling"
	}
}

func buildTimeline(psi PSISnapshot, detail MemoryDetail, cpuPercent float64, processes []ProcessSample) []TimelineEvent {
	now := timeNowRFC3339()
	events := []TimelineEvent{}

	if psi.CPULevel != PSINormal {
		events = append(events, TimelineEvent{
			Timestamp: now,
			Title:     "CPU pressure elevated",
			Detail:    "PSI CPU " + psiLabel(psi.CPULevel) + " — avg10 " + formatFloat(psi.CPUAvg10),
			Severity:  severityFromPSI(psi.CPULevel),
		})
	}
	if psi.MemoryLevel != PSINormal {
		events = append(events, TimelineEvent{
			Timestamp: now,
			Title:     "Memory pressure increased",
			Detail:    "PSI memory " + psiLabel(psi.MemoryLevel),
			Severity:  severityFromPSI(psi.MemoryLevel),
		})
	}
	if cpuPercent >= 85 {
		events = append(events, TimelineEvent{
			Timestamp: now,
			Title:     "Node CPU above 85%",
			Detail:    "Host CPU saturation may delay pod scheduling",
			Severity:  "warn",
		})
	}
	if detail.ReclaimActivity == "High" {
		events = append(events, TimelineEvent{
			Timestamp: now,
			Title:     "Page reclaim active",
			Detail:    "Kernel reclaiming cache/slab pages",
			Severity:  "warn",
		})
	}
	if len(processes) > 0 && processes[0].Pod != "" {
		events = append(events, TimelineEvent{
			Timestamp: now,
			Title:     processes[0].Pod + " is top CPU consumer",
			Detail:    processes[0].Name + " pid " + strconvItoa(processes[0].PID),
			Severity:  "info",
		})
	}
	return events
}

func severityFromPSI(level PSILevel) string {
	if level == PSICritical {
		return "crit"
	}
	if level == PSIWarn {
		return "warn"
	}
	return "info"
}

func formatFloat(value float64) string {
	return strings.TrimRight(strings.TrimRight(strconvFormat(value, 1), "0"), ".")
}

func strconvItoa(value int) string {
	return strconvFormat(float64(value), 0)
}

func strconvFormat(value float64, precision int) string {
	return strings.TrimSpace(strings.TrimRight(strings.TrimRight(
		strconv.FormatFloat(value, 'f', precision, 64), "0"), "."))
}

func timeNowRFC3339() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05Z")
}
