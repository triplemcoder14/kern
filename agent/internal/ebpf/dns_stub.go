//go:build !linux || !ebpf

package ebpf

import (
	"context"
	"fmt"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type DnsSampler struct{}

func NewDnsSampler() (*DnsSampler, error) {
	return nil, fmt.Errorf("dns sampler requires linux + ebpf build")
}

func (s *DnsSampler) Close() {}

func (s *DnsSampler) FlowsPerSecond() int { return 0 }

func (s *DnsSampler) ProgramCount() int { return 0 }

func (s *DnsSampler) Run(context.Context, *k8s.Resolver, *store.FlowStore) error {
	return fmt.Errorf("dns sampler not compiled in")
}
