package profile

import (
	"time"

	"github.com/kern/agent/internal/store"
)

type StackFrame struct {
	ID           string  `json:"id,omitempty"`
	Label        string  `json:"label"`
	Subtitle     string  `json:"subtitle,omitempty"`
	Depth        int     `json:"depth"`
	Width        float64 `json:"width"`
	Offset       float64 `json:"offset"`
	Heat         float64 `json:"heat"`
	Kind         string  `json:"kind,omitempty"`
	Protocol     string  `json:"protocol,omitempty"`
	Port         uint16  `json:"port,omitempty"`
	Namespace    string  `json:"namespace,omitempty"`
	EndpointKind string  `json:"endpointKind,omitempty"`
	IP           string  `json:"ip,omitempty"`
	Bytes        uint64  `json:"bytes,omitempty"`
	Retransmits  uint32  `json:"retransmits,omitempty"`
	LatencyMs    uint32  `json:"latencyMs,omitempty"`
	SharePct     int     `json:"sharePct,omitempty"`
	Samples      int     `json:"samples,omitempty"`
	Path         string  `json:"path,omitempty"`
	FlowCount    int     `json:"flowCount,omitempty"`
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

type PSILevel string

const (
	PSINormal   PSILevel = "normal"
	PSIWarn     PSILevel = "warn"
	PSICritical PSILevel = "critical"
)

type PSISnapshot struct {
	CPULevel    PSILevel `json:"cpu_level"`
	MemoryLevel PSILevel `json:"memory_level"`
	CPUAvg10    float64  `json:"cpu_avg10,omitempty"`
	MemoryAvg10 float64  `json:"memory_avg10,omitempty"`
}

type MemoryDetail struct {
	CacheMB          uint64 `json:"cache_mb,omitempty"`
	SlabMB           uint64 `json:"slab_mb,omitempty"`
	BuffersMB        uint64 `json:"buffers_mb,omitempty"`
	SwapUsedMB       uint64 `json:"swap_used_mb,omitempty"`
	ReclaimActivity  string `json:"reclaim_activity,omitempty"`
	MajorFaultsPerMin uint64 `json:"major_faults_per_min,omitempty"`
	OOMEvents        uint32 `json:"oom_events,omitempty"`
}

type KernelMemory struct {
	SlabGrowth   string `json:"slab_growth,omitempty"`
	DentryCache  string `json:"dentry_cache,omitempty"`
	TCPBuffers   string `json:"tcp_buffers,omitempty"`
	PageReclaim  string `json:"page_reclaim,omitempty"`
}

type PodConsumer struct {
	Namespace     string  `json:"namespace"`
	Pod           string  `json:"pod"`
	CPUPercent    float64 `json:"cpu_percent,omitempty"`
	RSSMB         uint64  `json:"rss_mb,omitempty"`
	WorkingSetMB  uint64  `json:"working_set_mb,omitempty"`
	AnonymousMB   uint64  `json:"anonymous_mb,omitempty"`
	CacheMB       uint64  `json:"cache_mb,omitempty"`
	PageFaults    uint64  `json:"page_faults_per_min,omitempty"`
	MajorFaults   uint64  `json:"major_faults,omitempty"`
	MinorFaults   uint64  `json:"minor_faults,omitempty"`
	MemoryLimitMB uint64  `json:"memory_limit_mb,omitempty"`
}

type ProcessSample struct {
	PID        int     `json:"pid"`
	Name       string  `json:"name"`
	Namespace  string  `json:"namespace,omitempty"`
	Pod        string  `json:"pod,omitempty"`
	CPUPercent float64 `json:"cpu_percent,omitempty"`
	RSSMB      uint64  `json:"rss_mb,omitempty"`
}

type cgroupMemStats struct {
	path        string
	currentKB   uint64
	anonKB      uint64
	fileKB      uint64
	majorFaults uint64
	minorFaults uint64
	limitKB     uint64 // 0 means unlimited / unknown
}

type KernelHotspot struct {
	Function string  `json:"function"`
	Share    float64 `json:"share"`
	Meaning  string  `json:"meaning,omitempty"`
	Category string  `json:"category,omitempty"`
}

type TimelineEvent struct {
	Timestamp string `json:"timestamp"`
	Title     string `json:"title"`
	Detail    string `json:"detail,omitempty"`
	Severity  string `json:"severity"`
}

type Snapshot struct {
	NodeName       string           `json:"node_name"`
	Hostname       string           `json:"hostname"`
	Zone           string           `json:"zone,omitempty"`
	CPUCores       int              `json:"cpu_cores"`
	CPUPercent     float64          `json:"cpu_percent"`
	Load1          float64          `json:"load_1"`
	MemoryUsedMB   uint64           `json:"memory_used_mb"`
	MemoryTotalMB  uint64           `json:"memory_total_mb"`
	Health         string           `json:"health"`
	FlowsPerSecond int              `json:"flows_per_second"`
	Network        NetworkProfile   `json:"network"`
	PSI            PSISnapshot      `json:"psi"`
	Memory         MemoryDetail     `json:"memory_detail"`
	KernelMemory   KernelMemory     `json:"kernel_memory"`
	TopPods        []PodConsumer    `json:"top_pods"`
	TopProcesses   []ProcessSample  `json:"top_processes"`
	KernelHotspots []KernelHotspot  `json:"kernel_hotspots"`
	CPUStack       []StackFrame     `json:"cpu_stack"`
	StackSource    string           `json:"stack_source,omitempty"`
	Timeline       []TimelineEvent  `json:"timeline"`
	SampledAt      time.Time        `json:"sampled_at"`
}

type Collector interface {
	Snapshot(flows *store.FlowStore) Snapshot
}

// PodLookup resolves pod identity from a Kubernetes pod UID when kubelet metadata is unavailable.
type PodLookup interface {
	LookupPodByUID(uid string) (namespace, name string, ok bool)
}

func NewCollector(lookup PodLookup) Collector {
	return newPlatformCollector(lookup)
}
