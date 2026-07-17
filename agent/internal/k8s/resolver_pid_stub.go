//go:build !linux

package k8s

import "github.com/kern/agent/internal/store"

func (r *Resolver) EnrichClientFromPID(flow *store.Flow, pid uint32) {}
