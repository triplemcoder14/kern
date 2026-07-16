package trace

import (
	"context"
	"fmt"
	"log"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type Status struct {
	Mode           string
	Programs       int
	FlowsPerSecond int
	Message        string
}

type Tracer interface {
	Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error
	Status() Status
}

// NewTracer creates the flow tracer. Default and "auto"/"ebpf" require a working
// eBPF build (-tags ebpf). Explicit "proc" remains available for emergency fallback.
func NewTracer(mode, hubbleRelay string) Tracer {
	switch mode {
	case "hubble":
		return newHubbleTracer(hubbleRelay)
	case "proc":
		log.Printf("WARNING: proc mode is emergency-only — kernel tracing should use eBPF")
		return newPlatformTracer("proc")
	case "ebpf", "auto", "":
		if tracer := tryEbpfTracer(); tracer != nil {
			return tracer
		}
		return &fatalTracer{
			mode: "ebpf",
			err:  fmt.Errorf("eBPF required but unavailable (rebuild with -tags ebpf and CAP_BPF/CAP_SYS_ADMIN)"),
		}
	default:
		if tracer := tryEbpfTracer(); tracer != nil {
			return tracer
		}
		return &fatalTracer{
			mode: mode,
			err:  fmt.Errorf("unknown mode %q and eBPF unavailable", mode),
		}
	}
}

type fatalTracer struct {
	mode string
	err  error
}

func (t *fatalTracer) Start(context.Context, *k8s.Resolver, *store.FlowStore) error {
	return t.err
}

func (t *fatalTracer) Status() Status {
	return Status{
		Mode:    t.mode,
		Message: t.err.Error(),
	}
}
