//go:build linux && ebpf

package ebpf

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64 flows ../../bpf/flows.c -- -I../../bpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

const ProgramCount = 1

type Collector struct {
	objs   flowsObjects
	link   link.Link
	reader *ringbuf.Reader
	fps    int
}

func NewCollector() (*Collector, error) {
	objs := flowsObjects{}
	if err := loadFlowsObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("load bpf objects: %w", err)
	}

	tp, err := link.Tracepoint("sock", "inet_sock_set_state", objs.TpInetSockSetState, nil)
	if err != nil {
		_ = objs.Close()
		return nil, fmt.Errorf("attach tracepoint: %w", err)
	}

	reader, err := ringbuf.NewReader(objs.KernFlowEvents)
	if err != nil {
		_ = tp.Close()
		_ = objs.Close()
		return nil, fmt.Errorf("ringbuf reader: %w", err)
	}

	return &Collector{
		objs:   objs,
		link:   tp,
		reader: reader,
	}, nil
}

func (c *Collector) Close() {
	if c.reader != nil {
		_ = c.reader.Close()
	}
	if c.link != nil {
		_ = c.link.Close()
	}
	_ = c.objs.Close()
}

func (c *Collector) FlowsPerSecond() int {
	return c.fps
}

func (c *Collector) Run(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("eBPF tracer attached (tracepoint sock/inet_sock_set_state)")

	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				c.fps = 0
			}
		}
	}()

	for {
		record, err := c.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			log.Printf("ebpf ringbuf read: %v", err)
			continue
		}

		flow, ok := decodeFlowEvent(record.RawSample)
		if !ok {
			continue
		}

		resolver.Enrich(&flow)
		if flow.SrcPod == "" && flow.DstPod == "" {
			continue
		}

		flows.Upsert(flow)
		c.fps++
	}
}

func decodeFlowEvent(raw []byte) (store.Flow, bool) {
	if len(raw) < 20 {
		return store.Flow{}, false
	}

	tsNS := binary.LittleEndian.Uint64(raw[0:8])
	saddr := binary.LittleEndian.Uint32(raw[8:12])
	daddr := binary.LittleEndian.Uint32(raw[12:16])
	sport := binary.LittleEndian.Uint16(raw[16:18])
	dport := binary.LittleEndian.Uint16(raw[18:20])

	srcIP := net.IPv4(byte(saddr), byte(saddr>>8), byte(saddr>>16), byte(saddr>>24))
	dstIP := net.IPv4(byte(daddr), byte(daddr>>8), byte(daddr>>16), byte(daddr>>24))

	ts := time.Unix(0, int64(tsNS)).UTC()
	_ = sport

	return store.Flow{
		Timestamp: ts,
		SrcIP:     srcIP.String(),
		DstIP:     dstIP.String(),
		Protocol:  "TCP",
		Port:      dport,
		Verdict:   "OK",
	}, true
}
