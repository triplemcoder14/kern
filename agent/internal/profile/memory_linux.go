//go:build linux

package profile

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

func readMemoryDetail() MemoryDetail {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return MemoryDetail{}
	}
	defer file.Close()

	detail := MemoryDetail{}
	var swapTotalKB, swapFreeKB uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "Cached:"):
			detail.CacheMB = parseMeminfoKB(line) / 1024
		case strings.HasPrefix(line, "Slab:"):
			detail.SlabMB = parseMeminfoKB(line) / 1024
		case strings.HasPrefix(line, "Buffers:"):
			detail.BuffersMB = parseMeminfoKB(line) / 1024
		case strings.HasPrefix(line, "SwapTotal:"):
			swapTotalKB = parseMeminfoKB(line)
		case strings.HasPrefix(line, "SwapFree:"):
			swapFreeKB = parseMeminfoKB(line)
		}
	}
	if swapTotalKB > swapFreeKB {
		detail.SwapUsedMB = (swapTotalKB - swapFreeKB) / 1024
	}

	if detail.SlabMB > 1024 {
		detail.ReclaimActivity = "High"
	} else if detail.SlabMB > 512 {
		detail.ReclaimActivity = "Moderate"
	} else {
		detail.ReclaimActivity = "Low"
	}

	detail.MajorFaultsPerMin = readVmStatCounter("pgmajfault") / 5
	if oomKills := readVmStatCounter("oom_kill"); oomKills <= uint64(^uint32(0)) {
		detail.OOMEvents = uint32(oomKills)
	}
	return detail
}

func readKernelMemory(detail MemoryDetail, memUsed, memTotal uint64) KernelMemory {
	slabGrowth := "Normal"
	if detail.SlabMB > 1024 {
		slabGrowth = "High"
	}
	reclaim := "Idle"
	if detail.ReclaimActivity == "High" {
		reclaim = "Active"
	}
	usagePct := float64(0)
	if memTotal > 0 {
		usagePct = float64(memUsed) / float64(memTotal) * 100
	}
	tcpBuffers := "Low"
	if usagePct > 75 {
		tcpBuffers = "Elevated"
	}
	return KernelMemory{
		SlabGrowth:  slabGrowth,
		DentryCache: formatSizeMB(detail.CacheMB / 4),
		TCPBuffers:  tcpBuffers,
		PageReclaim: reclaim,
	}
}

func readVmStatCounter(key string) uint64 {
	data, err := os.ReadFile("/proc/vmstat")
	if err != nil {
		return 0
	}
	prefix := key + " "
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, prefix) {
			value, err := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, prefix)), 10, 64)
			if err == nil {
				return value
			}
		}
	}
	return 0
}

func formatSizeMB(value uint64) string {
	if value == 0 {
		return "—"
	}
	if value >= 1024 {
		return strconv.FormatUint(value/1024, 10) + "GB"
	}
	return strconv.FormatUint(value, 10) + "MB"
}
