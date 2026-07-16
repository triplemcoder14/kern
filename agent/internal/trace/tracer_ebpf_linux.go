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
<<<<<<< Updated upstream
	collector  *ebpf.Collector
	dnsSampler *ebpf.DnsSampler
=======
	// collector *ebpf.Collector
	collector   *ebpf.Collector
	httpSampler *ebpf.HttpSampler
	// dnsSampler *ebpf.DnsSampler // phase 3 (DNS) — merge when rebasing fix/dns-decode-and-multi-agent
>>>>>>> Stashed changes
}

func newEbpfTracer() (Tracer, error) {
	collector, err := ebpf.NewCollector()
	if err != nil {
		return nil, err
	}
<<<<<<< Updated upstream
	dnsSampler, dnsErr := ebpf.NewDnsSampler()
	if dnsErr != nil {
		log.Printf("eBPF DNS sampler unavailable: %v", dnsErr)
	}
	return &ebpfTracer{collector: collector, dnsSampler: dnsSampler}, nil
=======
	// return &ebpfTracer{collector: collector}, nil
	httpSampler, httpErr := ebpf.NewHttpSampler()
	if httpErr != nil {
		log.Printf("eBPF HTTP sampler unavailable: %v", httpErr)
	}
	return &ebpfTracer{collector: collector, httpSampler: httpSampler}, nil
>>>>>>> Stashed changes
}

func (t *ebpfTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	// defer t.collector.Close()
	// return t.collector.Run(ctx, resolver, flows)
	defer t.collector.Close()
<<<<<<< Updated upstream
	if t.dnsSampler != nil {
		defer t.dnsSampler.Close()
=======
	if t.httpSampler != nil {
		defer t.httpSampler.Close()
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
	if t.dnsSampler != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := t.dnsSampler.Run(ctx, resolver, flows); err != nil && ctx.Err() == nil {
				log.Printf("dns sampler stopped: %v", err)
=======
	if t.httpSampler != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := t.httpSampler.Run(ctx, resolver, flows); err != nil && ctx.Err() == nil {
				log.Printf("http sampler stopped: %v", err)
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
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
// 		Programs:       ebpf.ProgramCount,
// 		FlowsPerSecond: t.collector.FlowsPerSecond(),
		Programs:       programs,
		FlowsPerSecond: fps,
		Message:        msg,
=======
	// return Status{
	// 	Mode:           "ebpf",
	// 	Programs:       ebpf.ProgramCount,
	// 	FlowsPerSecond: t.collector.FlowsPerSecond(),
	// 	Message:        "eBPF TCP L4 (state/RTT/bytes/retransmit)",
	// }
	programs := ebpf.ProgramCount
	fps := t.collector.FlowsPerSecond()
	msg := "eBPF TCP L4"
	if t.httpSampler != nil {
		programs += t.httpSampler.ProgramCount()
		fps += t.httpSampler.FlowsPerSecond()
		msg += " + HTTP/1.x plaintext decode"
	} else {
		msg += " (HTTP sampler offline)"
	}
	return Status{
		Mode: "ebpf",
		// Programs:       ebpf.ProgramCount,
		Programs: programs,
		// FlowsPerSecond: t.collector.FlowsPerSecond(),
		FlowsPerSecond: fps,
		// Message:        "eBPF TCP L4 (state/RTT/bytes/retransmit)",
		Message: msg,
>>>>>>> Stashed changes
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
