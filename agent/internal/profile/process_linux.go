//go:build linux

package profile

import (
	"bufio"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const userHZ = 100.0

var kubeletPodsDir = "/var/lib/kubelet/pods"

func init() {
	if dir := os.Getenv("KUBELET_PODS_DIR"); dir != "" {
		kubeletPodsDir = dir
	}
}

type procSample struct {
	pid         int
	name        string
	namespace   string
	pod         string
	cpuTicks    uint64
	rssKB       uint64
	cgroup      cgroupMemStats
}

func (c *platformCollector) collectProcessSamples(limit int) ([]ProcessSample, []procSample) {
	now := time.Now()
	current := c.scanProcesses()
	if len(current) == 0 {
		return nil, nil
	}

	if c.prevProcSample.IsZero() {
		c.prevProcTicks = ticksByPID(current)
		c.prevProcSample = now
		time.Sleep(200 * time.Millisecond)
		return c.collectProcessSamples(limit)
	}

	elapsed := now.Sub(c.prevProcSample).Seconds()
	if elapsed <= 0 {
		elapsed = 0.2
	}

	type ranked struct {
		sample procSample
		delta  uint64
		cpu    float64
	}

	rankedList := make([]ranked, 0, len(current))
	for _, sample := range current {
		prevTicks := c.prevProcTicks[sample.pid]
		delta := uint64(0)
		if sample.cpuTicks >= prevTicks {
			delta = sample.cpuTicks - prevTicks
		}
		cpu := 100 * float64(delta) / userHZ / elapsed
		rankedList = append(rankedList, ranked{sample: sample, delta: delta, cpu: cpu})
	}

	c.prevProcTicks = ticksByPID(current)
	c.prevProcSample = now

	sort.Slice(rankedList, func(i, j int) bool {
		if rankedList[i].delta == rankedList[j].delta {
			return rankedList[i].sample.rssKB > rankedList[j].sample.rssKB
		}
		return rankedList[i].delta > rankedList[j].delta
	})

	if len(rankedList) > limit {
		rankedList = rankedList[:limit]
	}

	out := make([]ProcessSample, 0, len(rankedList))
	enrichedByPID := make(map[int]procSample, len(rankedList))
	for _, item := range rankedList {
		sample := item.sample
		ns, pod := c.resolvePodFromPID(sample.pid)
		cgroup := readProcessCgroupMem(sample.pid)
		rssKB := readVmRSSKB(sample.pid)
		if rssKB == 0 {
			rssKB = sample.rssKB
		}
		enriched := procSample{
			pid:       sample.pid,
			name:      sample.name,
			namespace: ns,
			pod:       pod,
			cpuTicks:  sample.cpuTicks,
			rssKB:     rssKB,
			cgroup:    cgroup,
		}
		enrichedByPID[sample.pid] = enriched
		out = append(out, ProcessSample{
			PID:        enriched.pid,
			Name:       enriched.name,
			Namespace:  enriched.namespace,
			Pod:        enriched.pod,
			CPUPercent: item.cpu,
			RSSMB:      enriched.rssKB / 1024,
		})
	}
	for i := range current {
		if enriched, ok := enrichedByPID[current[i].pid]; ok {
			current[i] = enriched
		}
	}
	return out, current
}

func (c *platformCollector) scanProcesses() []procSample {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}

	pageKB := pageSizeKB()
	samples := make([]procSample, 0, 256)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 {
			continue
		}
		stat, ok := readProcStat(pid)
		if !ok {
			continue
		}
		if stat.name == "kern-agent" {
			continue
		}
		// Light scan: /proc/<pid>/stat only. Pod/cgroup/status enrich happens for top-N.
		samples = append(samples, procSample{
			pid:      pid,
			name:     stat.name,
			cpuTicks: stat.utime + stat.stime,
			rssKB:    stat.rssPages * pageKB,
		})
	}
	return samples
}

func ticksByPID(samples []procSample) map[int]uint64 {
	ticks := make(map[int]uint64, len(samples))
	for _, sample := range samples {
		ticks[sample.pid] = sample.cpuTicks
	}
	return ticks
}

type procStatData struct {
	name     string
	utime    uint64
	stime    uint64
	rssPages uint64
}

func pageSizeKB() uint64 {
	page := os.Getpagesize()
	if page <= 0 {
		return 4
	}
	return uint64(page / 1024)
}

func readVmRSSKB(pid int) uint64 {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "status"))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
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
	return 0
}

func readProcStat(pid int) (procStatData, bool) {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return procStatData{}, false
	}
	fields := strings.Fields(string(data))
	if len(fields) < 24 {
		return procStatData{}, false
	}
	name := strings.Trim(fields[1], "()")
	utime, _ := strconv.ParseUint(fields[13], 10, 64)
	stime, _ := strconv.ParseUint(fields[14], 10, 64)
	rssPages, _ := strconv.ParseUint(fields[23], 10, 64)
	return procStatData{name: name, utime: utime, stime: stime, rssPages: rssPages}, true
}

func (c *platformCollector) resolvePodFromPID(pid int) (namespace, pod string) {
	file, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return "", ""
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		for _, podUID := range podUIDCandidates(line) {
			if nsName, podName, ok := readKubeletPodMeta(podUID); ok {
				return nsName, podName
			}
			if c.podLookup != nil {
				if nsName, podName, ok := c.podLookup.LookupPodByUID(podUID); ok {
					return nsName, podName
				}
			}
		}
	}
	return "", ""
}

func podUIDCandidates(line string) []string {
	// idx := strings.Index(line, "pod")
	// if idx < 0 {
	// 	return nil
	// }
	// rest := line[idx+3:]
	// ... matched "pod" inside "kubepods"; skip that prefix instead.

	var out []string
	seen := map[string]struct{}{}
	for i := 0; i < len(line); {
		rel := strings.Index(line[i:], "pod")
		if rel < 0 {
			break
		}
		abs := i + rel
		// Skip the "pod" substring inside "kubepods".
		if abs >= 4 && strings.EqualFold(line[abs-4:abs], "kube") {
			i = abs + 3
			continue
		}
		rest := line[abs+3:]
		rest = strings.TrimPrefix(rest, "-")
		rest = strings.TrimPrefix(rest, "/")
		rest = strings.TrimPrefix(rest, "_")

		var token strings.Builder
		for _, ch := range rest {
			// containerd encodes pod UIDs with underscores instead of dashes.
			if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') || ch == '-' || ch == '_' {
				token.WriteRune(ch)
				continue
			}
			break
		}

		raw := strings.Trim(token.String(), "-_")
		raw = strings.ReplaceAll(raw, "_", "-")
		compact := strings.ReplaceAll(raw, "-", "")
		i = abs + 3
		if len(compact) < 32 {
			continue
		}
		if len(compact) > 32 {
			compact = compact[:32]
		}

		formatted := formatPodUID(compact)
		for _, candidate := range []string{formatted, compact, strings.ReplaceAll(formatted, "-", "_")} {
			if candidate == "" {
				continue
			}
			if _, ok := seen[candidate]; ok {
				continue
			}
			seen[candidate] = struct{}{}
			out = append(out, candidate)
		}
	}
	return out
}

func formatPodUID(raw string) string {
	raw = strings.ReplaceAll(raw, "-", "")
	raw = strings.ReplaceAll(raw, "_", "")
	if len(raw) != 32 {
		return raw
	}
	return raw[0:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:32]
}

func readKubeletPodMeta(podUID string) (namespace, pod string, ok bool) {
	variants := []string{podUID}
	compact := strings.ReplaceAll(strings.ReplaceAll(podUID, "-", ""), "_", "")
	if len(compact) == 32 {
		formatted := formatPodUID(compact)
		variants = append(variants, formatted, compact, strings.ReplaceAll(formatted, "-", "_"))
	}
	seen := map[string]struct{}{}
	for _, uid := range variants {
		if uid == "" {
			continue
		}
		if _, ok := seen[uid]; ok {
			continue
		}
		seen[uid] = struct{}{}
		base := filepath.Join(kubeletPodsDir, uid, "metadata")
		podName, err := os.ReadFile(filepath.Join(base, "name"))
		if err != nil {
			continue
		}
		nsName, err := os.ReadFile(filepath.Join(base, "namespace"))
		if err != nil {
			continue
		}
		return strings.TrimSpace(string(nsName)), strings.TrimSpace(string(podName)), true
	}
	return "", "", false
}

func aggregateTopPods(processes []ProcessSample, samples []procSample, limit int) []PodConsumer {
	type key struct {
		namespace string
		pod       string
	}
	buckets := map[key]*PodConsumer{}
	seenCgroup := map[string]bool{}
	procRSS := map[key]uint64{}

	for _, sample := range samples {
		if sample.pod == "" {
			continue
		}
		k := key{namespace: sample.namespace, pod: sample.pod}
		current, ok := buckets[k]
		if !ok {
			current = &PodConsumer{Namespace: sample.namespace, Pod: sample.pod}
			buckets[k] = current
		}
		procRSS[k] += sample.rssKB / 1024

		cgroupPath := sample.cgroup.path
		if cgroupPath == "" || seenCgroup[cgroupPath] {
			continue
		}
		seenCgroup[cgroupPath] = true

		if sample.cgroup.currentKB > 0 {
			current.RSSMB += sample.cgroup.currentKB / 1024
			current.WorkingSetMB += sample.cgroup.currentKB / 1024
		}
		current.AnonymousMB += sample.cgroup.anonKB / 1024
		current.CacheMB += sample.cgroup.fileKB / 1024
		if sample.cgroup.majorFaults > current.MajorFaults {
			current.MajorFaults = sample.cgroup.majorFaults
			current.PageFaults = sample.cgroup.majorFaults
		}
		if sample.cgroup.minorFaults > current.MinorFaults {
			current.MinorFaults = sample.cgroup.minorFaults
		}
		if sample.cgroup.limitKB > 0 {
			limitMB := sample.cgroup.limitKB / 1024
			current.MemoryLimitMB += limitMB
		}
	}

	// Fall back to summed process RSS when cgroup current was unavailable.
	for k, current := range buckets {
		if current.RSSMB == 0 {
			current.RSSMB = procRSS[k]
			current.WorkingSetMB = procRSS[k]
		}
	}

	for _, proc := range processes {
		if proc.Pod == "" {
			continue
		}
		k := key{namespace: proc.Namespace, pod: proc.Pod}
		current, ok := buckets[k]
		if !ok {
			current = &PodConsumer{Namespace: proc.Namespace, Pod: proc.Pod}
			buckets[k] = current
		}
		current.CPUPercent += proc.CPUPercent
	}

	items := make([]PodConsumer, 0, len(buckets))
	for _, item := range buckets {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].RSSMB == items[j].RSSMB {
			return items[i].CPUPercent > items[j].CPUPercent
		}
		return items[i].RSSMB > items[j].RSSMB
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items
}
