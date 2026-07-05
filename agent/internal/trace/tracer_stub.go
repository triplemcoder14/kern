//go:build !linux

package trace

import (
	"context"
	"log"
	"time"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type platformTracer struct {
	mode string
}

func newPlatformTracer(mode string) Tracer {
	if mode == "" {
		mode = "mock"
	}
	return &platformTracer{mode: mode}
}

func (t *platformTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("agent running in %s mode (deploy on Linux/minikube for kernel flows)", t.mode)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if t.mode != "mock" {
				continue
			}
			now := time.Now().UTC()
			flows.Upsert(store.Flow{
				Timestamp:    now,
				SrcIP:        "10.0.0.1",
				DstIP:        "10.0.0.2",
				SrcPod:       "demo-src",
				DstPod:       "demo-dst",
				SrcNamespace: "default",
				DstNamespace: "default",
				Protocol:     "TCP",
				Port:         443,
				Verdict:      "OK",
			})
		}
	}
}

func (t *platformTracer) Status() Status {
	programs := 0
	msg := "mock mode — deploy agent on minikube for kernel tracing"
	if t.mode == "mock" {
		programs = 1
	}
	return Status{
		Mode:     t.mode,
		Programs: programs,
		Message:  msg,
	}
}
