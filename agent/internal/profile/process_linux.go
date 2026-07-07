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
	pid           int
	name          string
	namespace     string
	pod           string
	cpuTicks      uint64
	rssKB         uint64
	cgroupCacheKB uint64
	majorFaults   uint64
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
	for _, item := range rankedList {
		out = append(out, ProcessSample{
			PID:        item.sample.pid,
			Name:       item.sample.name,
			Namespace:  item.sample.namespace,
			Pod:        item.sample.pod,
			CPUPercent: item.cpu,
			RSSMB:      item.sample.rssKB / 1024,
		})
	}
	return out, current
}

func (c *platformCollector) scanProcesses() []procSample {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}

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
		ns, pod := c.resolvePodFromPID(pid)
		cacheKB, majorFaults := readProcessCgroupStats(pid)
		samples = append(samples, procSample{
			pid:           pid,
			name:          stat.name,
			namespace:     ns,
			pod:           pod,
			cpuTicks:      stat.utime + stat.stime,
			rssKB:         stat.rss,
			cgroupCacheKB: cacheKB,
			majorFaults:   majorFaults,
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
	name  string
	utime uint64
	stime uint64
	rss   uint64
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
	rss, _ := strconv.ParseUint(fields[23], 10, 64)
	return procStatData{name: name, utime: utime, stime: stime, rss: rss}, true
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
	idx := strings.Index(line, "pod")
	if idx < 0 {
		return nil
	}
	rest := line[idx+3:]
	rest = strings.TrimPrefix(rest, "-")
	rest = strings.TrimPrefix(rest, "/")

	var token strings.Builder
	for _, ch := range rest {
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') || ch == '-' {
			token.WriteRune(ch)
			continue
		}
		break
	}

	raw := strings.Trim(token.String(), "-")
	if len(raw) < 32 {
		return nil
	}
	if len(raw) > 36 {
		raw = raw[:36]
	}

	candidates := []string{raw}
	if !strings.Contains(raw, "-") && len(raw) == 32 {
		candidates = append(candidates, formatPodUID(raw))
	}
	return candidates
}

func formatPodUID(raw string) string {
	raw = strings.ReplaceAll(raw, "-", "")
	if len(raw) != 32 {
		return raw
	}
	return raw[0:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:32]
}

func readKubeletPodMeta(podUID string) (namespace, pod string, ok bool) {
	base := filepath.Join(kubeletPodsDir, podUID, "metadata")
	podName, err := os.ReadFile(filepath.Join(base, "name"))
	if err != nil {
		return "", "", false
	}
	nsName, err := os.ReadFile(filepath.Join(base, "namespace"))
	if err != nil {
		return "", "", false
	}
	return strings.TrimSpace(string(nsName)), strings.TrimSpace(string(podName)), true
}

func aggregateTopPods(processes []ProcessSample, samples []procSample, limit int) []PodConsumer {
	type key struct {
		namespace string
		pod       string
	}
	buckets := map[key]*PodConsumer{}

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
		current.RSSMB += sample.rssKB / 1024
		if cacheMB := sample.cgroupCacheKB / 1024; cacheMB > current.CacheMB {
			current.CacheMB = cacheMB
		}
		if sample.majorFaults > current.PageFaults {
			current.PageFaults = sample.majorFaults
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
