package profile

// StackSampler collects kernel stack frames for the profiler.
// The eBPF implementation is compiled with -tags ebpf.
type StackSampler interface {
	Available() bool
	SampleTopProcess(pid int) []string
	Close()
}

func NewStackSampler() StackSampler {
	return newPlatformStackSampler()
}
