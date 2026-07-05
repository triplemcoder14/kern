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
	prevIdle  uint64
	prevTotal uint64
}

func newPlatformCollector() Collector {
	return &platformCollector{}
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

	return Snapshot{
		NodeName:       nodeName,
		Hostname:       hostname,
		Zone:           envOr("NODE_ZONE", ""),
		CPUCores:       cores,
		CPUPercent:     cpuPercent,
		Load1:          load1,
		MemoryUsedMB:   memUsed,
		MemoryTotalMB:  memTotal,
		Health:         deriveHealth(network, cpuPercent, load1, cores),
		FlowsPerSecond: flows.FlowsPerSecond(),
		Network:        network,
		SampledAt:      time.Now().UTC(),
	}
}

func (c *platformCollector) readCPUPercent() float64 {
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
