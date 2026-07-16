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
	collector  *ebpf.Collector
	dnsSampler *ebpf.DnsSampler
}

func newEbpfTracer() (Tracer, error) {
	collector, err := ebpf.NewCollector()
	if err != nil {
		return nil, err
	}
	dnsSampler, dnsErr := ebpf.NewDnsSampler()
	if dnsErr != nil {
		log.Printf("eBPF DNS sampler unavailable: %v", dnsErr)
	}
	return &ebpfTracer{collector: collector, dnsSampler: dnsSampler}, nil
}

func (t *ebpfTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	defer t.collector.Close()
	if t.dnsSampler != nil {
		defer t.dnsSampler.Close()
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 2)

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
	programs := ebpf.ProgramCount
	fps := t.collector.FlowsPerSecond()
	msg := "eBPF TCP established + "
	if t.dnsSampler != nil {
		programs += t.dnsSampler.ProgramCount()
		fps += t.dnsSampler.FlowsPerSecond()
		msg += "DNS UDP payload decode"
	} else {
		msg += "DNS sampler offline"
	}
	return Status{
		Mode:           "ebpf",
		Programs:       programs,
		FlowsPerSecond: fps,
		Message:        msg,
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
