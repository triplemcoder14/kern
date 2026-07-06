//go:build !hubble

package trace

import (
	"log"
)

func newHubbleTracer(relayAddr string) Tracer {
	log.Printf("hubble mode requested but this image was built without Hubble support — using proc")
	return newPlatformTracer("proc")
}

func newAutoTracer(_ string) Tracer {
	if tracer := tryEbpfTracer(); tracer != nil {
		return tracer
	}
	log.Printf("auto mode: eBPF unavailable — using proc")
	return newPlatformTracer("proc")
}
