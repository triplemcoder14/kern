package profile

// StackSampler collects sampled kernel stacks for flame-graph profiles.
// The eBPF implementation is compiled with -tags ebpf.
type StackSampler interface {
	Available() bool
	// SampleTopProcess returns the hottest resolved frames for pid (leaf-first or root-first).
	SampleTopProcess(pid int) []string
	// FlameFrames returns aggregated flame-ready stack frames for a pid, or nil.
	FlameFrames(pid int) []StackFrame
	Close()
}

func NewStackSampler() StackSampler {
	return newPlatformStackSampler()
}
