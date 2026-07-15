//go:build !linux

package profile

type noopStackSampler struct{}

func newPlatformStackSampler() StackSampler { return noopStackSampler{} }

func (noopStackSampler) Available() bool                 { return false }
func (noopStackSampler) SampleTopProcess(int) []string   { return nil }
func (noopStackSampler) FlameFrames(int) []StackFrame    { return nil }
func (noopStackSampler) Close()                          {}
