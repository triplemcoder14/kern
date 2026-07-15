//go:build !hubble

package trace

import (
	"log"
)

func newHubbleTracer(relayAddr string) Tracer {
	log.Printf("hubble mode requested but this image was built without Hubble support — requiring eBPF")
	_ = relayAddr
	if tracer := tryEbpfTracer(); tracer != nil {
		return tracer
	}
	return &fatalTracer{
		mode: "hubble",
		err:  errString("hubble unavailable and eBPF required"),
	}
}

func newAutoTracer(_ string) Tracer {
	if tracer := tryEbpfTracer(); tracer != nil {
		return tracer
	}
	return &fatalTracer{
		mode: "ebpf",
		err:  errString("eBPF required but unavailable (rebuild with -tags ebpf)"),
	}
}

type stringError string

func (e stringError) Error() string { return string(e) }

func errString(msg string) error { return stringError(msg) }
