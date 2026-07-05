//go:build !hubble

package trace

import (
	"context"
	"log"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

func newHubbleTracer(relayAddr string) Tracer {
	log.Printf("hubble mode requested but this image was built without Hubble support — using proc")
	return newPlatformTracer("proc")
}

type autoTracer struct {
	active Tracer
}

func newAutoTracer(_ string) Tracer {
	return &autoTracer{active: newPlatformTracer("proc")}
}

func (t *autoTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	return t.active.Start(ctx, resolver, flows)
}

func (t *autoTracer) Status() Status {
	status := t.active.Status()
	status.Mode = "auto:" + status.Mode
	return status
}
