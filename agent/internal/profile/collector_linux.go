//go:build linux

package profile

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/kern/agent/internal/store"
)

type platformCollector struct {
	prevIdle         uint64
	prevTotal        uint64
	prevProcTicks    map[int]uint64
	prevProcSample   time.Time
	podLookup        PodLookup
	kernelEvents     *kernelEventTracker
}

func newPlatformCollector(lookup PodLookup) Collector {
	return &platformCollector{
		podLookup:    lookup,
		kernelEvents: newKernelEventTracker(),
	}
}

func (c *platformCollector) Snapshot(flows *store.FlowStore) Snapshot {
	nodeName := envOr("NODE_NAME", "")
	hostname, _ := os.Hostname()
	if nodeName == "" {
		nodeName = hostname
	}

	cores := runtime.NumCPU()
	cpuPercent := c.readCPUPercent()
	load1 := readLoad1()
	memUsed, memTotal := readMemory()
	network := buildNetworkProfile(flows)
	psi := readPSI()
	memDetail := readMemoryDetail()
	processes := c.collectProcessSamples(15)
	topPods := aggregateTopPods(processes, 8)
	kernelMem := readKernelMemory(memDetail, memUsed, memTotal)
	cpuStack, stackSource := buildCPUStack(processes, network)
	kernelFrames := kernelFrameLabels(cpuStack, stackSource)
	hotspots := buildKernelHotspots(processes, network, kernelFrames, stackSource)
	oomDelta := c.kernelEvents.observeOOMKill()
	timeline := mergeTimelineEvents(readKernelEvents(oomDelta), buildTimeline(psi, memDetail, cpuPercent, processes))

	return Snapshot{
		NodeName:       nodeName,
		Hostname:       hostname,
		Zone:           envOr("NODE_ZONE", ""),
		CPUCores:       cores,
		CPUPercent:     cpuPercent,
		Load1:          load1,
		MemoryUsedMB:   memUsed,
		MemoryTotalMB:  memTotal,
		Health:         deriveHealthWithPSI(network, cpuPercent, load1, cores, psi, memDetail),
		FlowsPerSecond: flows.FlowsPerSecond(),
		Network:        network,
		PSI:            psi,
		Memory:         memDetail,
		KernelMemory:   kernelMem,
		TopPods:        topPods,
		TopProcesses:   processes,
		KernelHotspots: hotspots,
		CPUStack:       cpuStack,
		StackSource:    stackSource,
		Timeline:       timeline,
		SampledAt:      time.Now().UTC(),
	}
}

func (c *platformCollector) readCPUPercent() float64 {
	if c.prevTotal == 0 {
		_ = c.sampleCPU()
		time.Sleep(200 * time.Millisecond)
	}
	return c.sampleCPU()
}

func (c *platformCollector) sampleCPU() float64 {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return 0
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}

	idle, _ := strconv.ParseUint(fields[4], 10, 64)
	total := uint64(0)
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err == nil {
			total += value
		}
	}

	if c.prevTotal == 0 {
		c.prevIdle = idle
		c.prevTotal = total
		cores := runtime.NumCPU()
		if cores > 0 {
			return min(100, (readLoad1()/float64(cores))*100)
		}
		return 0
	}

	idleDelta := float64(idle - c.prevIdle)
	totalDelta := float64(total - c.prevTotal)
	c.prevIdle = idle
	c.prevTotal = total
	if totalDelta <= 0 {
		return 0
	}
	return max(0, min(100, (1-idleDelta/totalDelta)*100))
}

func readLoad1() float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	value, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return value
}

func readMemory() (usedMB uint64, totalMB uint64) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer file.Close()

	var totalKB, availableKB uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			totalKB = parseMeminfoKB(line)
		case strings.HasPrefix(line, "MemAvailable:"):
			availableKB = parseMeminfoKB(line)
		}
	}
	if totalKB == 0 {
		return 0, 0
	}
	if availableKB == 0 {
		availableKB = totalKB / 2
	}
	totalMB = totalKB / 1024
	usedMB = (totalKB - availableKB) / 1024
	return usedMB, totalMB
}

func parseMeminfoKB(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	value, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func kernelFrameLabels(stack []StackFrame, stackSource string) []string {
	if stackSource != "proc" && stackSource != "ebpf" {
		return nil
	}
	labels := make([]string, 0, len(stack))
	for _, frame := range stack {
		if frame.Depth >= 3 {
			labels = append(labels, frame.Label)
		}
	}
	return labels
}

func mergeTimelineEvents(kernel, base []TimelineEvent) []TimelineEvent {
	if len(kernel) == 0 {
		return base
	}
	merged := append([]TimelineEvent(nil), kernel...)
	seen := map[string]struct{}{}
	for _, event := range kernel {
		seen[event.Title+"|"+event.Detail] = struct{}{}
	}
	for _, event := range base {
		key := event.Title + "|" + event.Detail
		if _, ok := seen[key]; ok {
			continue
		}
		merged = append(merged, event)
	}
	if len(merged) > 20 {
		merged = merged[:20]
	}
	return merged
}
