//go:build linux && ebpf

package ebpf

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 flows ../../bpf/flows.c -- -I../../bpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

const (
	ProgramCount = 2

	flowEvtEstablished = 1
	flowEvtClose       = 2
	flowEvtTimeout     = 3
	flowEvtReset       = 4
	flowEvtRetransmit  = 5
)

var tcpStateNames = map[uint8]string{
	1:  "ESTABLISHED",
	2:  "SYN_SENT",
	3:  "SYN_RECV",
	4:  "FIN_WAIT1",
	5:  "FIN_WAIT2",
	6:  "TIME_WAIT",
	7:  "CLOSE",
	8:  "CLOSE_WAIT",
	9:  "LAST_ACK",
	10: "LISTEN",
	11: "CLOSING",
}

type Collector struct {
	objs   flowsObjects
	links  []link.Link
	reader *ringbuf.Reader
	fps    int
}

func NewCollector() (*Collector, error) {
	objs := flowsObjects{}
	if err := loadFlowsObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("load bpf objects: %w", err)
	}

	var links []link.Link
	cleanup := func() {
		for _, l := range links {
			_ = l.Close()
		}
		_ = objs.Close()
	}

	attach := func(group, name string, prog *ebpf.Program) error {
		l, err := link.Tracepoint(group, name, prog, nil)
		if err != nil {
			cleanup()
			return fmt.Errorf("attach %s/%s: %w", group, name, err)
		}
		links = append(links, l)
		return nil
	}

	if err := attach("sock", "inet_sock_set_state", objs.TpInetSockSetState); err != nil {
		return nil, err
	}
	if err := attach("tcp", "tcp_retransmit_skb", objs.TpTcpRetransmitSkb); err != nil {
		return nil, err
	}

	reader, err := ringbuf.NewReader(objs.KernFlowEvents)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("ringbuf reader: %w", err)
	}

	return &Collector{objs: objs, links: links, reader: reader}, nil
}

func (c *Collector) Close() {
	if c.reader != nil {
		_ = c.reader.Close()
	}
	for _, l := range c.links {
		_ = l.Close()
	}
	_ = c.objs.Close()
}

func (c *Collector) FlowsPerSecond() int {
	return c.fps
}

func (c *Collector) Run(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("eBPF tracer attached (inet_sock_set_state + tcp_retransmit_skb)")

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
	const size = 48
	if len(raw) < size {
		return store.Flow{}, false
	}

	tsNS := binary.LittleEndian.Uint64(raw[0:8])
	saddr := binary.LittleEndian.Uint32(raw[8:12])
	daddr := binary.LittleEndian.Uint32(raw[12:16])
	sport := binary.LittleEndian.Uint16(raw[16:18])
	dport := binary.LittleEndian.Uint16(raw[18:20])
	event := raw[21]
	oldState := raw[22]
	newState := raw[23]
	retransmits := binary.LittleEndian.Uint32(raw[24:28])
	rttUS := binary.LittleEndian.Uint32(raw[28:32])
	bytesSent := binary.LittleEndian.Uint64(raw[32:40])
	bytesRecv := binary.LittleEndian.Uint64(raw[40:48])

	srcIP := net.IPv4(byte(saddr), byte(saddr>>8), byte(saddr>>16), byte(saddr>>24))
	dstIP := net.IPv4(byte(daddr), byte(daddr>>8), byte(daddr>>16), byte(daddr>>24))
	_ = sport

	verdict := "OK"
	switch event {
	case flowEvtTimeout:
		verdict = "TIMEOUT"
	case flowEvtReset:
		verdict = "DROPPED"
	case flowEvtRetransmit:
		verdict = "RETRY"
	case flowEvtClose, flowEvtEstablished:
		verdict = "OK"
	}

	stateName := tcpStateNames[newState]
	if stateName == "" {
		stateName = tcpStateNames[oldState]
	}

	ts := time.Unix(0, int64(tsNS)).UTC()
	flow := store.Flow{
		Timestamp: ts,
		SrcIP:     srcIP.String(),
		DstIP:     dstIP.String(),
		Protocol:  "TCP",
		Port:      dport,
		Verdict:   verdict,
		TcpState:  stateName,
		TcpEvent:  tcpEventName(event),
	}

	if retransmits > 0 {
		r := retransmits
		flow.Retransmits = &r
	}
	if bytesSent > 0 {
		b := bytesSent
		flow.BytesSent = &b
	}
	if bytesRecv > 0 {
		b := bytesRecv
		flow.BytesReceived = &b
	}
	if rttUS > 0 {
		ms := rttUS / 1000
		if ms == 0 {
			ms = 1
		}
		flow.LatencyMs = &ms
	}

	return flow, true
}

func tcpEventName(event uint8) string {
	switch event {
	case flowEvtEstablished:
		return "established"
	case flowEvtClose:
		return "close"
	case flowEvtTimeout:
		return "timeout"
	case flowEvtReset:
		return "reset"
	case flowEvtRetransmit:
		return "retransmit"
	default:
		return "unknown"
	}
}
