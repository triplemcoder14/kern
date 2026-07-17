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
	// Prefer a merged eBPF pyramid (identical frames coalesce across processes).
	// Fallback: CPU Samples → pod → process → stack lanes when only /proc stacks are available.
	// all - pod - process  kernel/user frames (siblings sized by CPU share).
	// Node CPU  pod  process  kernel/user frames (siblings sized by CPU share).
func buildCPUStack(processes []ProcessSample, network NetworkProfile, sampler StackSampler, nodeName string) ([]StackFrame, string) {
	if len(processes) == 0 {
		return network.Stack, "inferred"
	}
	return buildNodePerformanceFlame(processes, sampler, nodeName)
}

func buildNodePerformanceFlame(processes []ProcessSample, sampler StackSampler, nodeName string) ([]StackFrame, string) {
	ranked := rankProcessesForFlame(processes)
	if len(ranked) == 0 {
		return nil, "inferred"
	}

	// Classic flamegraph: merge all sampled stacks into one pyramid (no per-pod towers).
	if sampler != nil && sampler.Available() {
		if flame := sampler.FlameFrames(0); len(flame) > 1 {
			for i := range flame {
				if flame[i].Depth == 0 || flame[i].Kind == "root" {
					// flame[i].Label = "CPU Samples"
					flame[i].Label = "Node CPU"
					flame[i].Kind = "root"
					if strings.TrimSpace(nodeName) != "" {
						flame[i].Subtitle = nodeName
					} else {
						flame[i].Subtitle = "100%"
					}
					flame[i].SharePct = 100
					flame[i].Width = 1
					flame[i].Offset = 0
				}
			}
			return flame, "ebpf"
		}
	}

	totalCPU := 0.0
	for _, proc := range ranked {
		totalCPU += max(proc.CPUPercent, 0.01)
	}

	source := "inferred"

	// rootSubtitle := "100%"
	// if strings.TrimSpace(nodeName) != "" {
	// 	rootSubtitle = nodeName
	// }

	frames := []StackFrame{{
		ID: "node-all",
		// Label:    "all",
		// Label: "CPU Samples",
		Label: "Node CPU",
		Depth:  0,
		Width:  1,
		Offset: 0,
		Heat:   0.1,
		SharePct: 100,
		Samples:  estimateSamples(totalCPU),
		Kind:     "root",
		// Subtitle: "node",
		Subtitle: "100%",
		// Subtitle: rootSubtitle,
	}}
	if strings.TrimSpace(nodeName) != "" {
		frames[0].Subtitle = nodeName
	}

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
			ID: podID,
			// Label:     "pod: " + bucket.label,
			Label:     bucket.label,
			Subtitle:  bucket.namespace,
			Namespace: bucket.namespace,
			Depth:     1,
			Width:     podWidth,
			Offset:    podOffset,
			Heat:      0.22 + min(0.35, podWidth),
			SharePct:  max(1, podShare),
			Samples:   estimateSamples(bucket.cpu),
			Kind:      "cpu",
			Path:      bucket.namespace + "/" + bucket.label,
		})

		procOffset := podOffset
		for _, proc := range bucket.procs {
			procWeight := max(proc.CPUPercent, 0.01) / totalCPU
			procShare := int(procWeight*100 + 0.5)
			// procLabel := fmt.Sprintf("pid: %s (%d)", proc.Name, proc.PID)
			procID := fmt.Sprintf("proc-%d", proc.PID)
			frames = append(frames, StackFrame{
				ID: procID,
				// Label:     procLabel,
				// Subtitle:  bucket.label,
				Label:     proc.Name,
				Subtitle:  strconv.Itoa(proc.PID),
				Namespace: bucket.namespace,
				Depth:     2,
				Width:     procWeight,
				Offset:    procOffset,
				Heat:      0.4 + min(0.35, procWeight),
				SharePct:  max(1, procShare),
				Samples:   estimateSamples(proc.CPUPercent),
				Kind:      "cpu",
				Path:      bucket.namespace + "/" + bucket.label,
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
				if frame.Label == "all" || frame.Label == "Node CPU" || frame.Label == "CPU Samples" || frame.Depth == 0 {
					continue
				}
				shifted := frame
				shifted.Depth = 2 + max(1, frame.Depth)
				if shifted.Depth > 2+maxStackDepthShown {
					continue
				}
				shifted.Offset = offset + frame.Offset*width
				// shifted.Width = max(0.02, frame.Width*width)
				shifted.Width = frame.Width * width
				// Preserve user/kernel kind from the sampler when present.
				// shifted.Kind = "cpu"
				if shifted.Kind == "" {
					shifted.Kind = "cpu"
				}
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
		// Single /proc stack: each depth spans the full process lane (solid icicle column).
		// // Linear shrink within the process lane (icicle under process).
		// frac := 1.0 - float64(index)*0.08
		// if frac < 0.25 {
		// 	frac = 0.25
		// }
		// frameWidth := width * frac
		frameWidth := width
		share := int((frameWidth)*100 + 0.5)
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
			Kind:     "kernel",
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
	frames, _ := buildNodePerformanceFlame([]ProcessSample{top}, nil, "")
	_ = flame
	return frames
}

func buildCPUStackFromKernel(top ProcessSample, kernelFrames []string) []StackFrame {
	frames, _ := buildNodePerformanceFlame([]ProcessSample{top}, nil, "")
	if len(kernelFrames) == 0 {
		return frames
	}
	extra, _ := processStackFrames(top, nil, 0.02, 0.85)
	_ = extra
	out := []StackFrame{
		// {ID: "node-all", Label: "all", Depth: 0, Width: 1, Offset: 0, Heat: 0.1, SharePct: 100, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
		// {ID: "node-all", Label: "Node CPU", Depth: 0, Width: 1, Offset: 0, Heat: 0.1, SharePct: 100, Samples: estimateSamples(top.CPUPercent), Kind: "cpu", Subtitle: "100%"},
		// {ID: "node-all", Label: "CPU Samples", Depth: 0, Width: 1, Offset: 0, Heat: 0.1, SharePct: 100, Samples: estimateSamples(top.CPUPercent), Kind: "root", Subtitle: "100%"},
		{ID: "node-all", Label: "Node CPU", Depth: 0, Width: 1, Offset: 0, Heat: 0.1, SharePct: 100, Samples: estimateSamples(top.CPUPercent), Kind: "root", Subtitle: "100%"},
	}
	key, label, ns := podKey(top)
	out = append(out,
		// StackFrame{ID: "pod-" + key, Label: "pod: " + label, Namespace: ns, Depth: 1, Width: 0.92, Offset: 0.04, Heat: 0.28, SharePct: 92, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
		// StackFrame{ID: fmt.Sprintf("proc-%d", top.PID), Label: fmt.Sprintf("pid: %s (%d)", top.Name, top.PID), Depth: 2, Width: 0.85, Offset: 0.06, Heat: 0.45, SharePct: 85, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
		StackFrame{ID: "pod-" + key, Label: label, Namespace: ns, Subtitle: ns, Depth: 1, Width: 0.92, Offset: 0.04, Heat: 0.28, SharePct: 92, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
		StackFrame{ID: fmt.Sprintf("proc-%d", top.PID), Label: top.Name, Subtitle: strconv.Itoa(top.PID), Depth: 2, Width: 0.85, Offset: 0.06, Heat: 0.45, SharePct: 85, Samples: estimateSamples(top.CPUPercent), Kind: "cpu"},
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
	frames, _ := buildNodePerformanceFlame(processes, nil, "")
	if len(frames) > 0 {
		return frames
	}
	top := processes[0]
	kernelPath := inferKernelPath(top.Name, network)
	parts := strings.Split(kernelPath, " → ")
	out := []StackFrame{
		// {Label: "all", Depth: 0, Width: 1, Offset: 0, Heat: 0.12, SharePct: 100, Kind: "cpu"},
		// {Label: "Node CPU", Depth: 0, Width: 1, Offset: 0, Heat: 0.12, SharePct: 100, Kind: "cpu", Subtitle: "100%"},
		// {Label: "CPU Samples", Depth: 0, Width: 1, Offset: 0, Heat: 0.12, SharePct: 100, Kind: "root", Subtitle: "100%"},
		{Label: "Node CPU", Depth: 0, Width: 1, Offset: 0, Heat: 0.12, SharePct: 100, Kind: "root", Subtitle: "100%"},
	}
	_, label, ns := podKey(top)
	out = append(out,
		// StackFrame{Label: "pod: " + label, Namespace: ns, Depth: 1, Width: 0.85, Offset: 0.02, Heat: 0.35, SharePct: 85, Kind: "cpu"},
		// StackFrame{Label: fmt.Sprintf("pid: %s (%d)", top.Name, top.PID), Depth: 2, Width: 0.7, Offset: 0.08, Heat: 0.55, SharePct: 70, Kind: "cpu"},
		StackFrame{Label: label, Namespace: ns, Subtitle: ns, Depth: 1, Width: 0.85, Offset: 0.02, Heat: 0.35, SharePct: 85, Kind: "cpu"},
		StackFrame{Label: top.Name, Subtitle: strconv.Itoa(top.PID), Depth: 2, Width: 0.7, Offset: 0.08, Heat: 0.55, SharePct: 70, Kind: "cpu"},
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

func isSyscallEntryStub(label string) bool {
	name := strings.ToLower(strings.TrimSpace(label))
	stubs := []string{
		"el0t_64_sync",
		"el0t_64_sync_handler",
		"el0_svc",
		"do_el0_svc",
		"el0_svc_common",
		"invoke_syscall",
		"entry_syscall_64",
		"do_syscall_64",
		"syscall_exit_to_user_mode",
		"syscall_return_via_sysret",
		"ret_from_fork",
		"entry_SYSCALL_64",
	}
	for _, stub := range stubs {
		if name == strings.ToLower(stub) || strings.HasPrefix(name, strings.ToLower(stub)+".") {
			return true
		}
	}
	return strings.HasPrefix(name, "el0_") && (strings.Contains(name, "sync") || strings.Contains(name, "svc"))
}

func kernelCategory(function string) string {
	name := strings.ToLower(function)
	switch {
	case strings.Contains(name, "futex"),
		strings.Contains(name, "mutex"),
		strings.Contains(name, "rwsem"),
		strings.Contains(name, "spinlock"),
		strings.Contains(name, "spin_lock"),
		strings.Contains(name, "down_write"),
		strings.Contains(name, "down_read"),
		strings.Contains(name, "up_write"),
		strings.Contains(name, "up_read"):
		return "Synchronization"
	case strings.Contains(name, "tcp_"),
		strings.Contains(name, "udp_"),
		strings.Contains(name, "sock"),
		strings.Contains(name, "net_"),
		strings.Contains(name, "ip_"),
		strings.Contains(name, "sk_"),
		strings.Contains(name, "napi"):
		return "Networking"
	case strings.Contains(name, "ext4"),
		strings.Contains(name, "xfs"),
		strings.Contains(name, "vfs_"),
		strings.Contains(name, "file_"),
		strings.Contains(name, "iov_"),
		strings.Contains(name, "iomap"),
		strings.Contains(name, "read_iter"),
		strings.Contains(name, "write_iter"):
		return "Filesystem"
	case strings.Contains(name, "schedule"),
		strings.Contains(name, "pick_next"),
		strings.Contains(name, "finish_task"),
		strings.Contains(name, "try_to_wake"),
		strings.Contains(name, "run_queue"):
		return "Scheduler"
	case strings.Contains(name, "copy_to_user"),
		strings.Contains(name, "copy_from_user"),
		strings.Contains(name, "page_fault"),
		strings.Contains(name, "handle_mm"),
		strings.Contains(name, "reclaim"),
		strings.Contains(name, "alloc_pages"),
		strings.Contains(name, "kmem"):
		return "Memory"
	default:
		return "Other"
	}
}

func isImplausibleClusterKernelSymbol(label string) bool {
	name := strings.ToLower(strings.TrimSpace(label))
	noise := []string{
		"mipi_", "drm_", "amdgpu", "i915_", "nouveau", "radeon",
		"snd_", "sound/", "hdmi", "v4l2", "videobuf",
		"usb_hcd", "hid_", "input_event", "evdev",
		"bluetooth", "rfkill", "nfc_",
	}
	for _, prefix := range noise {
		if strings.Contains(name, prefix) {
			return true
		}
	}
	return false
}

func buildKernelHotspots(processes []ProcessSample, network NetworkProfile, cpuStack []StackFrame, kernelFrames []string, stackSource string) []KernelHotspot {
	type agg struct {
		samples int
		depth   int
	}
	counts := map[string]*agg{}
	total := 0

	if (stackSource == "proc" || stackSource == "ebpf") && len(cpuStack) > 0 {
		for _, frame := range cpuStack {
			// Only real kernel frames — user/library frames used to leak into this list.
			// if frame.Depth < 3 || isSyscallEntryStub(frame.Label) {
			if frame.Kind != "kernel" || isSyscallEntryStub(frame.Label) || isImplausibleClusterKernelSymbol(frame.Label) {
				continue
			}
			if strings.HasPrefix(frame.Label, "0x") {
				continue
			}
			weight := frame.Samples
			if weight <= 0 {
				weight = max(1, frame.SharePct)
			}
			item := counts[frame.Label]
			if item == nil {
				item = &agg{}
				counts[frame.Label] = item
			}
			item.samples += weight
			if frame.Depth > item.depth {
				item.depth = frame.Depth
			}
			total += weight
		}
	}

	// Fallback: flat label list from kernel frames (still filter stubs).
	if total == 0 && len(kernelFrames) > 0 {
		for _, label := range kernelFrames {
			// if isSyscallEntryStub(label) {
			if isSyscallEntryStub(label) || isImplausibleClusterKernelSymbol(label) || strings.HasPrefix(label, "0x") {
				continue
			}
			item := counts[label]
			if item == nil {
				item = &agg{samples: 1, depth: 3}
				counts[label] = item
			} else {
				item.samples++
			}
			total++
		}
	}

	if total > 0 {
		hotspots := make([]KernelHotspot, 0, len(counts))
		for label, item := range counts {
			share := float64(item.samples) / float64(total)
			hotspots = append(hotspots, KernelHotspot{
				Function: label,
				Share:    share,
				// Meaning:  "Stack frame from node performance sampling",
				Meaning:  kernelMeaning(label, network),
				Category: kernelCategory(label),
			})
		}
		sort.Slice(hotspots, func(i, j int) bool {
			if hotspots[i].Share == hotspots[j].Share {
				return hotspots[i].Function < hotspots[j].Function
			}
			return hotspots[i].Share > hotspots[j].Share
		})
		if len(hotspots) > 8 {
			hotspots = hotspots[:8]
		}
		return hotspots
	}

	// Inferred fallback — prefer meaningful paths over syscall stubs.
	hotspots := []KernelHotspot{}
	path := inferKernelPath("", network)
	for index, part := range strings.Split(path, " → ") {
		if isSyscallEntryStub(part) {
			continue
		}
		share := max(0.15, 0.45-float64(index)*0.08)
		hotspots = append(hotspots, KernelHotspot{
			Function: part,
			Share:    share,
			Meaning:  kernelMeaning(part, network),
			Category: kernelCategory(part),
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

func kernelMeaning(function string, network NetworkProfile) string {
	switch {
	case strings.Contains(function, "futex"):
		return "Thread synchronization / wait path"
	case strings.Contains(function, "tcp_sendmsg"), strings.Contains(function, "ip_queue_xmit"), strings.Contains(function, "dev_queue_xmit"):
		return "High network send path CPU"
	case strings.Contains(function, "tcp_recvmsg"), strings.Contains(function, "udp_recv"):
		return "Network receive path CPU"
	case strings.Contains(function, "do_epoll_wait"), strings.Contains(function, "epoll_wait"):
		return "Event loop waiting with active syscalls"
	case strings.Contains(function, "schedule"), strings.Contains(function, "run_queue"):
		return "Scheduler pressure on runnable / sleeping threads"
	case strings.Contains(function, "copy_to_user"), strings.Contains(function, "copy_from_user"), strings.Contains(function, "copy_user"):
		return "User/kernel memory copies"
	case strings.Contains(function, "ext4"), strings.Contains(function, "vfs_"), strings.Contains(function, "file_read"), strings.Contains(function, "file_write"):
		return "Filesystem I/O path in kernel"
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
