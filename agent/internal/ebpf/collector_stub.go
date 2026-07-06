//go:build !linux

package ebpf

import (
	"context"
	"fmt"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

const ProgramCount = 0

type Collector struct{}

func NewCollector() (*Collector, error) {
	return nil, fmt.Errorf("eBPF flow collector requires Linux")
}

func (c *Collector) Close() {}

func (c *Collector) FlowsPerSecond() int { return 0 }

func (c *Collector) Run(_ context.Context, _ *k8s.Resolver, _ *store.FlowStore) error {
	return fmt.Errorf("eBPF flow collector requires Linux")
}
