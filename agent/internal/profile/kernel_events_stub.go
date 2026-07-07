//go:build !linux

package profile

type kernelEventTracker struct{}

func newKernelEventTracker() *kernelEventTracker {
	return &kernelEventTracker{}
}

func (t *kernelEventTracker) observeOOMKill() uint32 {
	return 0
}

func readKernelEvents(_ uint32) []TimelineEvent {
	return nil
}
