//go:build !linux || !ebpf

package ebpf

import (
	"context"
	"fmt"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type GrpcSampler struct{}

func NewGrpcSampler() (*GrpcSampler, error) {
	return nil, fmt.Errorf("grpc sampler requires linux + ebpf build")
}

func (s *GrpcSampler) Close() {}

func (s *GrpcSampler) FlowsPerSecond() int { return 0 }

func (s *GrpcSampler) ProgramCount() int { return 0 }

func (s *GrpcSampler) Run(context.Context, *k8s.Resolver, *store.FlowStore) error {
	return fmt.Errorf("grpc sampler not compiled in")
}
