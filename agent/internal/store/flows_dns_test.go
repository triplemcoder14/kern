package store

import (
	"testing"
	"time"
)

func TestUpsertMergesDnsResponseOntoQuery(t *testing.T) {
	s := NewFlowStore()

	s.Upsert(Flow{
		Timestamp: time.Now().UTC(),
		SrcIP:     "10.0.0.1",
		DstIP:     "10.96.0.10",
		Protocol:  "UDP",
		Port:      53,
		DnsQuery:  "kubernetes.default.svc.cluster.local",
		DnsType:   "A",
		DnsTxid:   0xabcd,
	})

	time.Sleep(2 * time.Millisecond)

	s.Upsert(Flow{
		Timestamp:  time.Now().UTC(),
		DstIP:      "10.96.0.10",
		Protocol:   "UDP",
		Port:       53,
		DnsQuery:   "kubernetes.default.svc.cluster.local",
		DnsType:    "A",
		DnsRcode:   "NOERROR",
		DnsAnswers: []string{"A 10.96.0.1"},
		DnsTxid:    0xabcd,
		Verdict:    "OK",
	})

	snap := s.Snapshot(10)
	if len(snap) != 1 {
		t.Fatalf("expected 1 merged flow, got %d", len(snap))
	}
	got := snap[0]
	if got.DnsRcode != "NOERROR" {
		t.Fatalf("rcode=%q", got.DnsRcode)
	}
	if len(got.DnsAnswers) != 1 || got.DnsAnswers[0] != "A 10.96.0.1" {
		t.Fatalf("answers=%v", got.DnsAnswers)
	}
	if got.LatencyMs == nil || *got.LatencyMs < 1 {
		t.Fatalf("expected latency from query→response, got %v", got.LatencyMs)
	}
	if got.SrcIP != "10.0.0.1" {
		t.Fatalf("src preserved=%q", got.SrcIP)
	}
}

func TestUpsertMergesNxdomain(t *testing.T) {
	s := NewFlowStore()
	s.Upsert(Flow{
		DnsQuery: "missing.invalid",
		DnsType:  "A",
		DnsTxid:  1,
		Protocol: "UDP",
		Port:     53,
		DstIP:    "10.96.0.10",
	})
	s.Upsert(Flow{
		DnsQuery: "missing.invalid",
		DnsType:  "A",
		DnsTxid:  1,
		DnsRcode: "NXDOMAIN",
		Protocol: "UDP",
		Port:     53,
		DstIP:    "10.96.0.10",
		Verdict:  "OK",
	})
	snap := s.Snapshot(5)
	if len(snap) != 1 || snap[0].DnsRcode != "NXDOMAIN" {
		t.Fatalf("got %#v", snap)
	}
}
