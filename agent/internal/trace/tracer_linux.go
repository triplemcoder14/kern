//go:build linux

package trace

import (
	"context"
	"log"
	"time"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type platformTracer struct {
	mode     string
	programs int
	fps      int
}

func newPlatformTracer(mode string) Tracer {
	if mode == "" {
		mode = "proc"
	}
	return &platformTracer{
		mode:     mode,
		programs: 2,
	}
}

func (t *platformTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("kernel tracer started (mode=%s)", t.mode)

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			ingested := 0
			if count, err := readProcSockets("/proc/net/tcp", "TCP", true, resolver, flows); err != nil {
				log.Printf("proc/tcp sample: %v", err)
			} else {
				ingested += count
			}
			if count, err := readProcSockets("/proc/net/udp", "UDP", false, resolver, flows); err != nil {
				log.Printf("proc/udp sample: %v", err)
			} else {
				ingested += count
			}
			if ingested > 0 {
				t.fps = ingested
			}
		}
	}
}

func (t *platformTracer) Status() Status {
	return Status{
		Mode:           t.mode,
		Programs:       t.programs,
		FlowsPerSecond: t.fps,
		Message:        "kernel /proc/net/tcp+udp tracing (host network namespace)",
	}
}
