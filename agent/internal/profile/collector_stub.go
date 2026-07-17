//go:build !linux

package profile

import (
	"os"
	"runtime"
	"time"

	"github.com/kern/agent/internal/store"
)

type platformCollector struct{}

func newPlatformCollector(_ PodLookup) Collector {
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
	psi := PSISnapshot{CPULevel: PSINormal, MemoryLevel: PSINormal, CPUAvg10: 2.1, MemoryAvg10: 1.4}
	memDetail := MemoryDetail{
		CacheMB:           512,
		SlabMB:            128,
		BuffersMB:         64,
		ReclaimActivity:   "Low",
		MajorFaultsPerMin: 12,
	}
	processes := []ProcessSample{
		{PID: 1234, Name: "nginx", Namespace: "default", Pod: "web-abc", CPUPercent: 18, RSSMB: 256},
		{PID: 5678, Name: "node", Namespace: "default", Pod: "api-xyz", CPUPercent: 12, RSSMB: 512},
	}

	return Snapshot{
		NodeName:       nodeName,
		Hostname:       hostname,
		CPUCores:       cores,
		CPUPercent:     cpuPercent,
		Load1:          0.2,
		MemoryUsedMB:   2048,
		MemoryTotalMB:  8192,
		Health:         deriveHealthWithPSI(network, cpuPercent, 0.2, cores, psi, memDetail),
		FlowsPerSecond: flows.FlowsPerSecond(),
		Network:        network,
		PSI:            psi,
		Memory:         memDetail,
		KernelMemory: KernelMemory{
			SlabGrowth:  "Normal",
			DentryCache: "128MB",
			TCPBuffers:  "Low",
			PageReclaim: "Idle",
		},
		TopPods: []PodConsumer{
			{Namespace: "default", Pod: "web-abc", CPUPercent: 18, RSSMB: 256},
			{Namespace: "default", Pod: "api-xyz", CPUPercent: 12, RSSMB: 512},
		},
		TopProcesses:   processes,
		// KernelHotspots: buildKernelHotspots(processes, network, nil, "inferred"),
		KernelHotspots: buildKernelHotspots(processes, network, nil, nil, "inferred"),
		CPUStack:       buildInferredCPUStack(processes, network),
		StackSource:    "inferred",
		Timeline:       buildTimeline(psi, memDetail, cpuPercent, processes),
		SampledAt:      time.Now().UTC(),
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
