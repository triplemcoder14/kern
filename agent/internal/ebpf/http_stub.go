//go:build !linux || !ebpf

package ebpf

import (
	"context"
	"fmt"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type HttpSampler struct{}

func NewHttpSampler() (*HttpSampler, error) {
	return nil, fmt.Errorf("http sampler requires linux + ebpf build")
}

func (s *HttpSampler) Close() {}

func (s *HttpSampler) FlowsPerSecond() int { return 0 }

func (s *HttpSampler) ProgramCount() int { return 0 }

func (s *HttpSampler) Run(context.Context, *k8s.Resolver, *store.FlowStore) error {
	return fmt.Errorf("http sampler not compiled in")
}
