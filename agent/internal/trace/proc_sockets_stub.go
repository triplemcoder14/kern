//go:build !linux

package trace

import (
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

func readProcSockets(_ string, _ string, _ bool, _ *k8s.Resolver, _ *store.FlowStore) (int, error) {
	return 0, nil
}
