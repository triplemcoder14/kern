package profile

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxNodeFlameProcesses = 10
const maxStackDepthShown = 12

// buildCPUStack builds a node-wide performance flame:
// all → pod → process → kernel/user frames (siblings sized by CPU share).
func buildCPUStack(processes []ProcessSample, network NetworkProfile, sampler StackSampler) ([]StackFrame, string) {
	if len(processes) == 0 {
		return network.Stack, "inferred"
	}
	return buildNodePerformanceFlame(processes, sampler)
}

func buildNodePerformanceFlame(processes []ProcessSample, sampler StackSampler) ([]StackFrame, string) {
	ranked := rankProcessesForFlame(processes)
	if len(ranked) == 0 {
		return nil, "inferred"
	}

	totalCPU := 0.0
	for _, proc := range ranked {
		totalCPU += max(proc.CPUPercent, 0.01)
	}

	source := "inferred"
	if sampler != nil && sampler.Available() {
		source = "ebpf"
	}

	frames := []StackFrame{{
		ID:       "node-all",
		Label:    "all",
		Depth:    0,
		Width:    1,
		Offset:   0,
		Heat:     0.1,
		SharePct: 100,
		Samples:  estimateSamples(totalCPU),
		Kind:     "cpu",
		Subtitle: "node",
	}}

	type podBucket struct {
		key       string
		label     string
		namespace string
		cpu       float64
		procs     []ProcessSample
	}
	pods := map[string]*podBucket{}
	podOrder := []string{}
	for _, proc := range ranked {
		key, label, ns := podKey(proc)
		bucket, ok := pods[key]
		if !ok {
			bucket = &podBucket{key: key, label: label, namespace: ns}
			pods[key] = bucket
			podOrder = append(podOrder, key)
		}
		bucket.cpu += max(proc.CPUPercent, 0.01)
		bucket.procs = append(bucket.procs, proc)
	}
	sort.SliceStable(podOrder, func(i, j int) bool {
		return pods[podOrder[i]].cpu > pods[podOrder[j]].cpu
	})

	podOffset := 0.0
	usedEbpf := false
	usedProc := false

	for _, key := range podOrder {
		bucket := pods[key]
		podWidth := bucket.cpu / totalCPU
		podShare := int(podWidth*100 + 0.5)
		podID := "pod-" + key
		frames = append(frames, StackFrame{
			ID:        podID,
			Label:     "pod: " + bucket.label,
			Subtitle:  bucket.namespace,
			Namespace: bucket.namespace,
			Depth:     1,
			Width:     podWidth,
			Offset:    podOffset,
			Heat:      0.22 + min(0.35, podWidth),
			SharePct:  max(1, podShare),
			Samples:   estimateSamples(bucket.cpu),
			Kind:      "cpu",
		})

		procOffset := podOffset
		for _, proc := range bucket.procs {
			procWeight := max(proc.CPUPercent, 0.01) / totalCPU
			procShare := int(procWeight*100 + 0.5)
			procLabel := fmt.Sprintf("pid: %s (%d)", proc.Name, proc.PID)
			procID := fmt.Sprintf("proc-%d", proc.PID)
			frames = append(frames, StackFrame{
				ID:        procID,
				Label:     procLabel,
				Subtitle:  bucket.label,
				Namespace: bucket.namespace,
				Depth:     2,
				Width:     procWeight,
				Offset:    procOffset,
				Heat:      0.4 + min(0.35, procWeight),
				SharePct:  max(1, procShare),
				Samples:   estimateSamples(proc.CPUPercent),
				Kind:      "cpu",
			})

			stackFrames, stackSource := processStackFrames(proc, sampler, procOffset, procWeight)
			if stackSource == "ebpf" {
				usedEbpf = true
			} else if stackSource == "proc" {
				usedProc = true
			}
			frames = append(frames, stackFrames...)
			procOffset += procWeight
		}
		podOffset += podWidth
	}

	if usedEbpf {
		source = "ebpf"
	} else if usedProc {
		source = "proc"
	}
	return frames, source
}

func processStackFrames(proc ProcessSample, sampler StackSampler, offset, width float64) ([]StackFrame, string) {
	var kernel []string
	source := "inferred"

	if sampler != nil && sampler.Available() {
		if flame := sampler.FlameFrames(proc.PID); len(flame) > 0 {
			out := make([]StackFrame, 0, len(flame))
			for _, frame := range flame {
				if frame.Label == "all" || frame.Depth == 0 {
					continue
				}
				shifted := frame
				shifted.Depth = 2 + max(1, frame.Depth)
				if shifted.Depth > 2+maxStackDepthShown {
					continue
				}
				shifted.Offset = offset + frame.Offset*width
				shifted.Width = max(0.02, frame.Width*width)
				shifted.Kind = "cpu"
				if shifted.ID == "" {
					shifted.ID = fmt.Sprintf("stack-%d-%d-%s", proc.PID, shifted.Depth, shifted.Label)
				}
				if shifted.Samples == 0 && shifted.SharePct > 0 {
					shifted.Samples = max(1, int(float64(shifted.SharePct)/100*float64(estimateSamples(proc.CPUPercent))))
				}
				out = append(out, shifted)
			}
			if len(out) > 0 {
				return out, "ebpf"
			}
		}
		if sampled := sampler.SampleTopProcess(proc.PID); len(sampled) > 0 {
			kernel = sampled
			source = "ebpf"
		}
	}

	if len(kernel) == 0 {
		kernel = readProcessKernelStack(proc.PID, maxStackDepthShown)
		if len(kernel) > 0 {
			source = "proc"
		}
	}
	if len(kernel) == 0 {
		return nil, "inferred"
	}

	out := make([]StackFrame, 0, len(kernel))
	n := len(kernel)
	for index, label := range kernel {
		// Linear shrink within the process lane (icicle under process).
		frac := 1.0 - float64(index)*0.08
		if frac < 0.25 {
			frac = 0.25
		}
		frameWidth := width * frac
		share := int((frameWidth/width)*100 + 0.5)
		if width <= 0 {
			share = max(1, 100/n)
		}
		out = append(out, StackFrame{
			ID:       fmt.Sprintf("k-%d-%d", proc.PID, index),
			Label:    label,
			Depth:    3 + index,
			Width:    frameWidth,
			Offset:   offset,
			Heat:     min(1, 0.55+float64(index)*0.04),
			SharePct: max(1, share),
			Samples:  max(1, estimateSamples(proc.CPUPercent)*(n-index)/n),
			Kind:     "cpu",
			Path:     strings.Join(kernel[:index+1], " → "),
		})
	}
	return out, source
}

func rankProcessesForFlame(processes []ProcessSample) []ProcessSample {
	ranked := append([]ProcessSample(nil), processes...)
	sort.SliceStable(ranked, func(i, j int) bool {
		return ranked[i].CPUPercent > ranked[j].CPUPercent
	})
	if len(ranked) > maxNodeFlameProcesses {
		ranked = ranked[:maxNodeFlameProcesses]
	}
	return ranked
}

func podKey(proc ProcessSample) (key, label, namespace string) {
	if proc.Pod != "" {
		namespace = proc.Namespace
		if namespace != "" {
			label = namespace + "/" + proc.Pod
		} else {
			label = proc.Pod
		}
		return label, label, namespace
	}
	label = proc.Name
	if label == "" {
		label = fmt.Sprintf("pid-%d", proc.PID)
	}
	return "host/" + label, label, ""
}

func estimateSamples(cpuPercent float64) int {
	// Approximate sample weight from CPU% for tooltip parity with sample-based flames.
	samples := int(cpuPercent * 10)
	if samples < 1 {
		return 1
	}
	return samples
}

func decorateCPUFlame(top ProcessSample, flame []StackFrame) []StackFrame {
	frames, _ := buildNodePerformanceFlame([]ProcessSample{top}, nil)
	_ = flame
	return frames
}

func buildCPUStackFromKernel(top ProcessSample, kernelFrames []string) []StackFrame {
	frames, _ := buildNodePerformanceFlame([]ProcessSample{top}, nil)
	if len(kernelFrames) == 0 {
		return frames
	}
	extra, _ := processStackFrames(top, nil, 0.02, 0.85)
	_ = extra
	out := []StackFrame{
		{ID: "node-all", Label: "all", Depth: 0, Width: 1, Offset: 0, Heat: 0.1, SharePct: 100, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
	}
	key, label, ns := podKey(top)
	out = append(out,
		StackFrame{ID: "pod-" + key, Label: "pod: " + label, Namespace: ns, Depth: 1, Width: 0.92, Offset: 0.04, Heat: 0.28, SharePct: 92, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
		StackFrame{ID: fmt.Sprintf("proc-%d", top.PID), Label: fmt.Sprintf("pid: %s (%d)", top.Name, top.PID), Depth: 2, Width: 0.85, Offset: 0.06, Heat: 0.45, SharePct: 85, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
	)
	n := len(kernelFrames)
	for index, name := range kernelFrames {
		width := max(0.25, 0.8-float64(index)*0.05)
		out = append(out, StackFrame{
			ID:       "k-" + strconvItoa(index),
			Label:    name,
			Depth:    3 + index,
			Width:    width,
			Offset:   0.06,
			Heat:     min(1, 0.5+float64(index)*0.05),
			SharePct: max(5, 80-index*5),
			Samples:  max(1, estimateSamples(top.CPUPercent)*(n-index)/max(n, 1)),
			Kind:     "cpu",
			Path:     strings.Join(kernelFrames[:index+1], " → "),
		})
	}
	return out
}

func buildInferredCPUStack(processes []ProcessSample, network NetworkProfile) []StackFrame {
	frames, _ := buildNodePerformanceFlame(processes, nil)
	if len(frames) > 0 {
		return frames
	}
	top := processes[0]
	kernelPath := inferKernelPath(top.Name, network)
	parts := strings.Split(kernelPath, " → ")
	out := []StackFrame{
		{Label: "all", Depth: 0, Width: 1, Offset: 0, Heat: 0.12, SharePct: 100, Kind: "cpu"},
	}
	_, label, ns := podKey(top)
	out = append(out,
		StackFrame{Label: "pod: " + label, Namespace: ns, Depth: 1, Width: 0.85, Offset: 0.02, Heat: 0.35, SharePct: 85, Kind: "cpu"},
		StackFrame{Label: fmt.Sprintf("pid: %s (%d)", top.Name, top.PID), Depth: 2, Width: 0.7, Offset: 0.08, Heat: 0.55, SharePct: 70, Kind: "cpu"},
	)
	offset := 0.12
	for index, part := range parts {
		width := 0.65 - float64(index)*0.08
		if width < 0.25 {
			width = 0.25
		}
		out = append(out, StackFrame{
			Label:  part,
			Depth:  3 + index,
			Width:  width,
			Offset: offset,
			Heat:   min(1, 0.45+float64(index)*0.12),
			Kind:   "cpu",
		})
		offset += width * 0.35
	}
	return out
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
	if (stackSource == "proc" || stackSource == "ebpf") && len(kernelFrames) > 0 {
		share := 1.0 / float64(len(kernelFrames))
		hotspots := make([]KernelHotspot, 0, len(kernelFrames))
		for _, label := range kernelFrames {
			hotspots = append(hotspots, KernelHotspot{
				Function: label,
				Share:    share,
				Meaning:  "Stack frame from node performance sampling",
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
