//go:build linux && !ebpf

package profile

import "log"

type noopStackSampler struct{}

func newPlatformStackSampler() StackSampler {
	log.Printf("CPU stack sampler: agent built without ebpf tag — flame stacks need -tags ebpf")
	return noopStackSampler{}
}

func (noopStackSampler) Available() bool               { return false }
func (noopStackSampler) SampleTopProcess(int) []string { return nil }
func (noopStackSampler) FlameFrames(int) []StackFrame  { return nil }
func (noopStackSampler) Close()                        {}
