//go:build !linux

package profile

import (
	"os"
	"runtime"
	"time"

	"github.com/kern/agent/internal/store"
)

type platformCollector struct{}

func newPlatformCollector() Collector {
	return &platformCollector{}
}

func (c *platformCollector) Snapshot(flows *store.FlowStore) Snapshot {
	nodeName := envOr("NODE_NAME", "local")
	hostname, _ := os.Hostname()
	if nodeName == "local" && hostname != "" {
		nodeName = hostname
	}

	cores := runtime.NumCPU()
	network := buildNetworkProfile(flows)
	cpuPercent := float64(network.FlowsPerSecond%100) * 0.4

	return Snapshot{
		NodeName:       nodeName,
		Hostname:       hostname,
		CPUCores:       cores,
		CPUPercent:     cpuPercent,
		Load1:          0.2,
		MemoryUsedMB:   2048,
		MemoryTotalMB:  8192,
		Health:         deriveHealth(network, cpuPercent, 0.2, cores),
		FlowsPerSecond: flows.FlowsPerSecond(),
		Network:        network,
		SampledAt:      time.Now().UTC(),
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
