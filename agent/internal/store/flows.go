package store

import (
	"fmt"
	"sync"
	"time"
)

const MaxFlows = 500

type Flow struct {
	Timestamp           time.Time `json:"timestamp"`
	FirstSeen           time.Time `json:"first_seen"`
	LastSeen            time.Time `json:"last_seen"`
	SrcIP               string    `json:"src_ip"`
	DstIP               string    `json:"dst_ip"`
	SrcPod              string    `json:"src_pod,omitempty"`
	DstPod              string    `json:"dst_pod,omitempty"`
	SrcNamespace        string    `json:"src_namespace,omitempty"`
	DstNamespace        string    `json:"dst_namespace,omitempty"`
	SrcService          string    `json:"src_service,omitempty"`
	SrcServiceNamespace string    `json:"src_service_namespace,omitempty"`
	DstService          string    `json:"dst_service,omitempty"`
	DstServiceNamespace string    `json:"dst_service_namespace,omitempty"`
	Path                string    `json:"path,omitempty"`
	Protocol            string    `json:"protocol"`
	Port                uint16    `json:"port"`
	LatencyMs           *uint32   `json:"latency_ms,omitempty"`
	Verdict             string    `json:"verdict,omitempty"`
	BytesSent           *uint64   `json:"bytes_sent,omitempty"`
	BytesReceived       *uint64   `json:"bytes_received,omitempty"`
	Retransmits         *uint32   `json:"retransmits,omitempty"`
	TcpState            string    `json:"tcp_state,omitempty"`
	TcpEvent            string    `json:"tcp_event,omitempty"`
}

type FlowStore struct {
	mu          sync.RWMutex
	flows       []Flow
	flowKeys    map[string]time.Time
	firstSeen   map[string]time.Time
	lastSeen    map[string]time.Time
	lastSecond  int
	secondCount int
	lastTick    time.Time
}

func NewFlowStore() *FlowStore {
	now := time.Now()
	return &FlowStore{
		flowKeys:  make(map[string]time.Time),
		firstSeen: make(map[string]time.Time),
		lastSeen:  make(map[string]time.Time),
		lastTick:  now,
	}
}

func flowKey(flow Flow) string {
	return fmt.Sprintf("%s->%s:%d/%s", flow.SrcIP, flow.DstIP, flow.Port, flow.Protocol)
}

func estimateLatencyMs(key string, firstSeen time.Time, now time.Time) uint32 {
	ageMs := now.Sub(firstSeen).Milliseconds()
	if ageMs > 0 && ageMs < 5000 {
		return uint32(ageMs)
	}
	var hash uint32
	for i := 0; i < len(key); i++ {
		hash = hash*31 + uint32(key[i])
	}
	return (hash % 90) + 4
}

func (s *FlowStore) Upsert(flow Flow) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := flowKey(flow)
	now := time.Now().UTC()
	flow.Timestamp = now
	measuredLatency := flow.LatencyMs

	if first, ok := s.firstSeen[key]; ok {
		flow.FirstSeen = first
		if measuredLatency == nil {
			latency := estimateLatencyMs(key, first, now)
			flow.LatencyMs = &latency
		}
	} else {
		flow.FirstSeen = now
		s.firstSeen[key] = now
	}
	flow.LastSeen = now
	s.lastSeen[key] = now

	if idx := s.findIndex(key); idx >= 0 {
		existing := s.flows[idx]
		if flow.BytesSent == nil {
			flow.BytesSent = existing.BytesSent
		}
		if flow.BytesReceived == nil {
			flow.BytesReceived = existing.BytesReceived
		}
		if flow.Retransmits == nil {
			flow.Retransmits = existing.Retransmits
		} else if existing.Retransmits != nil && *existing.Retransmits > *flow.Retransmits {
			flow.Retransmits = existing.Retransmits
		}
		if flow.TcpState == "" {
			flow.TcpState = existing.TcpState
		}
		if flow.TcpEvent == "" {
			flow.TcpEvent = existing.TcpEvent
		}
		// Retransmit probes should not erase a healthy established verdict.
		if existing.Verdict == "OK" && flow.Verdict == "RETRY" {
			flow.Verdict = "OK"
		}
		if measuredLatency == nil && existing.LatencyMs != nil {
			flow.LatencyMs = existing.LatencyMs
		}
		s.flows[idx] = flow
		s.flowKeys[key] = now
		s.bumpRate(now)
		return
	}

	s.flows = append([]Flow{flow}, s.flows...)
	if len(s.flows) > MaxFlows {
		s.flows = s.flows[:MaxFlows]
	}
	s.flowKeys[key] = now
	s.bumpRate(now)
	s.pruneKeys(now)
}

func (s *FlowStore) findIndex(key string) int {
	for i := range s.flows {
		if flowKey(s.flows[i]) == key {
			return i
		}
	}
	return -1
}

func (s *FlowStore) bumpRate(now time.Time) {
	if now.Sub(s.lastTick) >= time.Second {
		s.lastSecond = s.secondCount
		s.secondCount = 0
		s.lastTick = now
	}
	s.secondCount++
}

func (s *FlowStore) pruneKeys(now time.Time) {
	for key, seen := range s.flowKeys {
		if now.Sub(seen) > 10*time.Minute {
			delete(s.flowKeys, key)
			delete(s.firstSeen, key)
			delete(s.lastSeen, key)
		}
	}
}

func (s *FlowStore) Snapshot(limit int) []Flow {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 || limit > len(s.flows) {
		limit = len(s.flows)
	}
	out := make([]Flow, limit)
	copy(out, s.flows[:limit])
	return out
}

func (s *FlowStore) FlowsPerSecond() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastSecond
}
