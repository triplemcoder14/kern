//go:build linux && !ebpf

package profile

type noopStackSampler struct{}

func newPlatformStackSampler() StackSampler {
	return noopStackSampler{}
}

func (noopStackSampler) Available() bool {
	return false
}

func (noopStackSampler) SampleTopProcess(_ int) []string {
	return nil
}

func (noopStackSampler) Close() {}
