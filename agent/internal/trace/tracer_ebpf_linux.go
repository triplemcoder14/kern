//go:build linux

package trace

import (
	"context"
	"log"
	"sync"

	"github.com/kern/agent/internal/ebpf"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type ebpfTracer struct {
	// collector *ebpf.Collector
	collector   *ebpf.Collector
	dnsSampler  *ebpf.DnsSampler
	httpSampler *ebpf.HttpSampler
	grpcSampler *ebpf.GrpcSampler
}

func newEbpfTracer() (Tracer, error) {
	collector, err := ebpf.NewCollector()
	if err != nil {
		return nil, err
	}
	// return &ebpfTracer{collector: collector}, nil
	dnsSampler, dnsErr := ebpf.NewDnsSampler()
	if dnsErr != nil {
		log.Printf("eBPF DNS sampler unavailable: %v", dnsErr)
	}
	httpSampler, httpErr := ebpf.NewHttpSampler()
	if httpErr != nil {
		log.Printf("eBPF HTTP sampler unavailable: %v", httpErr)
	}
	grpcSampler, grpcErr := ebpf.NewGrpcSampler()
	if grpcErr != nil {
		log.Printf("eBPF gRPC sampler unavailable: %v", grpcErr)
	}
	return &ebpfTracer{
		collector:   collector,
		dnsSampler:  dnsSampler,
		httpSampler: httpSampler,
		grpcSampler: grpcSampler,
	}, nil
}

func (t *ebpfTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	// defer t.collector.Close()
	// return t.collector.Run(ctx, resolver, flows)
	defer t.collector.Close()
	if t.dnsSampler != nil {
		defer t.dnsSampler.Close()
	}
	if t.httpSampler != nil {
		defer t.httpSampler.Close()
	}
	if t.grpcSampler != nil {
		defer t.grpcSampler.Close()
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 4)

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := t.collector.Run(ctx, resolver, flows); err != nil && ctx.Err() == nil {
			errCh <- err
		}
	}()

	if t.dnsSampler != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := t.dnsSampler.Run(ctx, resolver, flows); err != nil && ctx.Err() == nil {
				log.Printf("dns sampler stopped: %v", err)
			}
		}()
	}

	if t.httpSampler != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := t.httpSampler.Run(ctx, resolver, flows); err != nil && ctx.Err() == nil {
				log.Printf("http sampler stopped: %v", err)
			}
		}()
	}

	if t.grpcSampler != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := t.grpcSampler.Run(ctx, resolver, flows); err != nil && ctx.Err() == nil {
				log.Printf("grpc sampler stopped: %v", err)
			}
		}()
	}

	select {
	case <-ctx.Done():
		wg.Wait()
		return ctx.Err()
	case err := <-errCh:
		wg.Wait()
		return err
	}
}

func (t *ebpfTracer) Status() Status {
	if t.collector == nil {
		return Status{Mode: "ebpf", Message: "eBPF collector not initialized"}
	}
	// return Status{
	// 	Mode:           "ebpf",
	// 	Programs:       ebpf.ProgramCount,
	// 	FlowsPerSecond: t.collector.FlowsPerSecond(),
	// 	Message:        "eBPF TCP L4 (state/RTT/bytes/retransmit)",
	// }
	programs := ebpf.ProgramCount
	fps := t.collector.FlowsPerSecond()
	parts := []string{"eBPF TCP L4"}
	if t.dnsSampler != nil {
		programs += t.dnsSampler.ProgramCount()
		fps += t.dnsSampler.FlowsPerSecond()
		parts = append(parts, "DNS decode")
	} else {
		parts = append(parts, "DNS offline")
	}
	if t.httpSampler != nil {
		programs += t.httpSampler.ProgramCount()
		fps += t.httpSampler.FlowsPerSecond()
		parts = append(parts, "HTTP/1.x decode")
	} else {
		parts = append(parts, "HTTP offline")
	}
	if t.grpcSampler != nil {
		programs += t.grpcSampler.ProgramCount()
		fps += t.grpcSampler.FlowsPerSecond()
		parts = append(parts, "gRPC decode")
	} else {
		parts = append(parts, "gRPC offline")
	}
	msg := parts[0]
	for i := 1; i < len(parts); i++ {
		msg += " + " + parts[i]
	}
	return Status{
		Mode: "ebpf",
		// Programs:       ebpf.ProgramCount,
		Programs: programs,
		// FlowsPerSecond: t.collector.FlowsPerSecond(),
		FlowsPerSecond: fps,
		// Message:        "eBPF TCP L4 (state/RTT/bytes/retransmit)",
		Message: msg,
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
