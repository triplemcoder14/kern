package profile

import (
	"time"

	"github.com/kern/agent/internal/store"
)

type StackFrame struct {
	Label  string  `json:"label"`
	Depth  int     `json:"depth"`
	Width  float64 `json:"width"`
	Offset float64 `json:"offset"`
	Heat   float64 `json:"heat"`
}

type LogLine struct {
	Time      string `json:"time"`
	Severity  string `json:"severity"`
	Event     string `json:"event"`
	Value     string `json:"value"`
	Tone      string `json:"tone"`
	Timestamp string `json:"timestamp,omitempty"`
}

type NetworkProfile struct {
	P50Ms          uint32       `json:"p50_ms"`
	P95Ms          uint32       `json:"p95_ms"`
	Drops          uint32       `json:"drops"`
	FlowsPerSecond int          `json:"flows_per_second"`
	Stack          []StackFrame `json:"stack"`
	Log            []LogLine    `json:"log"`
}

type Snapshot struct {
	NodeName       string         `json:"node_name"`
	Hostname       string         `json:"hostname"`
	Zone           string         `json:"zone,omitempty"`
	CPUCores       int            `json:"cpu_cores"`
	CPUPercent     float64        `json:"cpu_percent"`
	Load1          float64        `json:"load_1"`
	MemoryUsedMB   uint64         `json:"memory_used_mb"`
	MemoryTotalMB  uint64         `json:"memory_total_mb"`
	Health         string         `json:"health"`
	FlowsPerSecond int            `json:"flows_per_second"`
	Network        NetworkProfile `json:"network"`
	SampledAt      time.Time      `json:"sampled_at"`
}

type Collector interface {
	Snapshot(flows *store.FlowStore) Snapshot
}

func NewCollector() Collector {
	return newPlatformCollector()
}
