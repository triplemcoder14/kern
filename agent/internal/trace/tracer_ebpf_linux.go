//go:build linux

package trace

import (
	"context"
	"log"

	"github.com/kern/agent/internal/ebpf"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type ebpfTracer struct {
	collector *ebpf.Collector
}

func newEbpfTracer() (Tracer, error) {
	collector, err := ebpf.NewCollector()
	if err != nil {
		return nil, err
	}
	return &ebpfTracer{collector: collector}, nil
}

func (t *ebpfTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	defer t.collector.Close()
	return t.collector.Run(ctx, resolver, flows)
}

func (t *ebpfTracer) Status() Status {
	if t.collector == nil {
		return Status{Mode: "ebpf", Message: "eBPF collector not initialized"}
	}
	return Status{
		Mode:           "ebpf",
		Programs:       ebpf.ProgramCount,
		FlowsPerSecond: t.collector.FlowsPerSecond(),
		Message:        "eBPF TCP L4 (state/RTT/bytes/retransmit)",
	}
}

func tryEbpfTracer() Tracer {
	tracer, err := newEbpfTracer()
	if err != nil {
		log.Printf("eBPF tracer unavailable: %v", err)
		return nil
	}
	return tracer
}
