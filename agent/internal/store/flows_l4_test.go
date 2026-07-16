package store

import "testing"

func TestUpsertKeepsMeasuredLatency(t *testing.T) {
	s := NewFlowStore()
	rtt := uint32(12)
	s.Upsert(Flow{
		SrcIP:     "10.0.0.1",
		DstIP:     "10.0.0.2",
		Protocol:  "TCP",
		Port:      80,
		Verdict:   "OK",
		LatencyMs: &rtt,
		TcpState:  "ESTABLISHED",
		TcpEvent:  "established",
	})

	retrans := uint32(3)
	s.Upsert(Flow{
		SrcIP:       "10.0.0.1",
		DstIP:       "10.0.0.2",
		Protocol:    "TCP",
		Port:        80,
		Verdict:     "RETRY",
		Retransmits: &retrans,
		TcpEvent:    "retransmit",
	})

	got := s.Snapshot(1)[0]
	if got.LatencyMs == nil || *got.LatencyMs != 12 {
		t.Fatalf("expected measured latency preserved, got %v", got.LatencyMs)
	}
	if got.Verdict != "OK" {
		t.Fatalf("retransmit should not overwrite OK verdict, got %q", got.Verdict)
	}
	if got.Retransmits == nil || *got.Retransmits != 3 {
		t.Fatalf("expected retransmits=3, got %v", got.Retransmits)
	}
}
