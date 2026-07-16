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
	// TcpState / TcpEvent come from the L4 TCP collector.
	TcpState string `json:"tcp_state,omitempty"`
	TcpEvent string `json:"tcp_event,omitempty"`
	// Dns* fields are filled by the DNS UDP sampler.
	DnsQuery   string   `json:"dns_query,omitempty"`
	DnsType    string   `json:"dns_type,omitempty"`
	DnsRcode   string   `json:"dns_rcode,omitempty"`
	DnsAnswers []string `json:"dns_answers,omitempty"`
	DnsTxid    uint16   `json:"dns_txid,omitempty"`
	// HttpMethod / HttpPath / HttpStatus are filled by the plaintext HTTP sampler.
	HttpMethod string  `json:"http_method,omitempty"`
	HttpPath   string  `json:"http_path,omitempty"`
	HttpStatus *uint16 `json:"http_status,omitempty"`
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
	if flow.DnsTxid != 0 || flow.DnsQuery != "" {
		return fmt.Sprintf("dns:%d:%s:%s->%s", flow.DnsTxid, flow.DnsQuery, flow.SrcIP, flow.DstIP)
	}
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
		if flow.SrcIP == "" {
			flow.SrcIP = existing.SrcIP
		}
		if flow.SrcPod == "" {
			flow.SrcPod = existing.SrcPod
			flow.SrcNamespace = existing.SrcNamespace
		}
		if flow.SrcService == "" {
			flow.SrcService = existing.SrcService
			flow.SrcServiceNamespace = existing.SrcServiceNamespace
		}
		if flow.DstIP == "" {
			flow.DstIP = existing.DstIP
		}
		if flow.HttpMethod == "" {
			flow.HttpMethod = existing.HttpMethod
		}
		if flow.HttpPath == "" {
			flow.HttpPath = existing.HttpPath
		}
		if flow.HttpStatus == nil {
			flow.HttpStatus = existing.HttpStatus
		}
		// L4 updates must not erase a plaintext HTTP path annotation.
		if flow.HttpMethod == "" && flow.HttpPath == "" && flow.HttpStatus == nil &&
			(existing.HttpMethod != "" || existing.HttpPath != "" || existing.HttpStatus != nil) &&
			existing.Path != "" {
			flow.Path = existing.Path
		}
		// Retransmit probes should not erase a healthy established verdict.
		if existing.Verdict == "OK" && flow.Verdict == "RETRY" {
			flow.Verdict = "OK"
		}
		if measuredLatency == nil && existing.LatencyMs != nil {
			flow.LatencyMs = existing.LatencyMs
		}
		if flow.DnsQuery == "" {
			flow.DnsQuery = existing.DnsQuery
		}
		if flow.DnsType == "" {
			flow.DnsType = existing.DnsType
		}
		if flow.DnsRcode == "" {
			flow.DnsRcode = existing.DnsRcode
		}
		if len(flow.DnsAnswers) == 0 {
			flow.DnsAnswers = existing.DnsAnswers
		}
		if flow.DnsTxid == 0 {
			flow.DnsTxid = existing.DnsTxid
		}
		s.flows[idx] = flow
		s.flowKeys[key] = now
		s.bumpRate(now)
		return
	}

	// Match DNS response onto an earlier query by txid + swapped endpoints.
	if flow.DnsTxid != 0 && flow.DnsRcode != "" {
		if idx := s.findDnsQuery(flow); idx >= 0 {
			existing := s.flows[idx]
			existing.LastSeen = now
			existing.Timestamp = now
			existing.DnsRcode = flow.DnsRcode
			existing.DnsAnswers = flow.DnsAnswers
			if flow.DnsType != "" {
				existing.DnsType = flow.DnsType
			}
			if flow.DnsQuery != "" {
				existing.DnsQuery = flow.DnsQuery
			}
			if existing.DstIP == "" && flow.DstIP != "" {
				existing.DstIP = flow.DstIP
			}
			if existing.DstPod == "" && flow.DstPod != "" {
				existing.DstPod = flow.DstPod
				existing.DstNamespace = flow.DstNamespace
			}
			if existing.DstService == "" && flow.DstService != "" {
				existing.DstService = flow.DstService
				existing.DstServiceNamespace = flow.DstServiceNamespace
			}
			if existing.SrcIP == "" && flow.SrcIP != "" {
				existing.SrcIP = flow.SrcIP
			}
			if existing.SrcPod == "" && flow.SrcPod != "" {
				existing.SrcPod = flow.SrcPod
				existing.SrcNamespace = flow.SrcNamespace
			}
			if existing.SrcService == "" && flow.SrcService != "" {
				existing.SrcService = flow.SrcService
				existing.SrcServiceNamespace = flow.SrcServiceNamespace
			}
			latency := uint32(now.Sub(existing.FirstSeen).Milliseconds())
			if latency == 0 {
				latency = 1
			}
			existing.LatencyMs = &latency
			if flow.Verdict != "" {
				existing.Verdict = flow.Verdict
			}
			if flow.Path != "" {
				existing.Path = flow.Path
			}
			s.flows[idx] = existing
			s.flowKeys[flowKey(existing)] = now
			s.bumpRate(now)
			return
		}
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

func (s *FlowStore) findDnsQuery(response Flow) int {
	for i := range s.flows {
		q := s.flows[i]
		if q.DnsTxid != response.DnsTxid || q.DnsTxid == 0 {
			continue
		}
		if q.DnsRcode != "" {
			continue
		}
		// Prefer same query name when both sides decoded it.
		if response.DnsQuery != "" && q.DnsQuery != "" && q.DnsQuery != response.DnsQuery {
			continue
		}
		// Same DNS server, or server unknown on one side.
		sameServer := q.DstIP == "" || response.DstIP == "" || q.DstIP == response.DstIP
		if !sameServer {
			continue
		}
		return i
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
