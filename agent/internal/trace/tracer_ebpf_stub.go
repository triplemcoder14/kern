//go:build !linux

package trace

func tryEbpfTracer() Tracer {
	return nil
}
