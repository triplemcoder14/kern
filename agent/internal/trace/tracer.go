package trace

import (
	"context"
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

func NewTracer(mode, hubbleRelay string) Tracer {
	switch mode {
	case "hubble":
		return newHubbleTracer(hubbleRelay)
	case "ebpf":
		if tracer := tryEbpfTracer(); tracer != nil {
			return tracer
		}
		log.Printf("ebpf mode requested but unavailable — falling back to proc")
		return newPlatformTracer("proc")
	case "auto":
		return newAutoTracer(hubbleRelay)
	default:
		return newPlatformTracer(mode)
	}
}
