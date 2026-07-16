//go:build linux && ebpf

package ebpf

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 http ../../bpf/http.c -- -I../../bpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	ciliumebpf "github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/kern/agent/internal/httpparse"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

const httpProgramCount = 6

// HttpSampler captures plaintext HTTP/1.x payloads via send*/recv* syscalls.
type HttpSampler struct {
	objs   httpObjects
	links  []link.Link
	reader *ringbuf.Reader
	fps    int
}

func NewHttpSampler() (*HttpSampler, error) {
	objs := httpObjects{}
	if err := loadHttpObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("load http bpf: %w", err)
	}

	var links []link.Link
	cleanup := func() {
		for _, l := range links {
			_ = l.Close()
		}
		_ = objs.Close()
	}

	attach := func(name string, prog *ciliumebpf.Program) error {
		l, err := link.Tracepoint("syscalls", name, prog, nil)
		if err != nil {
			cleanup()
			return fmt.Errorf("attach %s: %w", name, err)
		}
		links = append(links, l)
		return nil
	}

	if err := attach("sys_enter_sendto", objs.TpSysEnterSendto); err != nil {
		return nil, err
	}
	if err := attach("sys_enter_sendmsg", objs.TpSysEnterSendmsg); err != nil {
		return nil, err
	}
	if err := attach("sys_enter_recvfrom", objs.TpSysEnterRecvfrom); err != nil {
		return nil, err
	}
	if err := attach("sys_enter_recvmsg", objs.TpSysEnterRecvmsg); err != nil {
		return nil, err
	}
	if err := attach("sys_exit_recvfrom", objs.TpSysExitRecvfrom); err != nil {
		return nil, err
	}
	if err := attach("sys_exit_recvmsg", objs.TpSysExitRecvmsg); err != nil {
		return nil, err
	}

	reader, err := ringbuf.NewReader(objs.KernHttpEvents)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("http ringbuf: %w", err)
	}

	return &HttpSampler{objs: objs, links: links, reader: reader}, nil
}

func (s *HttpSampler) Close() {
	if s == nil {
		return
	}
	if s.reader != nil {
		_ = s.reader.Close()
	}
	for _, l := range s.links {
		_ = l.Close()
	}
	_ = s.objs.Close()
}

func (s *HttpSampler) FlowsPerSecond() int {
	if s == nil {
		return 0
	}
	return s.fps
}

func (s *HttpSampler) ProgramCount() int {
	return httpProgramCount
}

func (s *HttpSampler) Run(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("eBPF HTTP sampler attached (sendto/sendmsg + recvfrom/recvmsg, plaintext HTTP/1.x)")

	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				s.fps = 0
			}
		}
	}()

	for {
		record, err := s.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			log.Printf("http ringbuf read: %v", err)
			continue
		}

		flow, ok := decodeHttpEvent(record.RawSample)
		if !ok {
			continue
		}

		httpPath := flow.Path
		resolver.Enrich(&flow)
		if httpPath != "" {
			if flow.Path != "" {
				flow.Path = httpPath + " · " + flow.Path
			} else {
				flow.Path = httpPath
			}
		}
		flows.Upsert(flow)
		s.fps++
	}
}

func decodeHttpEvent(raw []byte) (store.Flow, bool) {
	const header = 28
	if len(raw) < header {
		return store.Flow{}, false
	}

	tsNS := binary.LittleEndian.Uint64(raw[0:8])
	saddr := binary.LittleEndian.Uint32(raw[12:16])
	daddr := binary.LittleEndian.Uint32(raw[16:20])
	sport := binary.LittleEndian.Uint16(raw[20:22])
	dport := binary.LittleEndian.Uint16(raw[22:24])
	direction := raw[24]
	payloadLen := binary.LittleEndian.Uint16(raw[26:28])
	if int(payloadLen) > len(raw)-header {
		payloadLen = uint16(len(raw) - header)
	}
	if payloadLen < 8 {
		return store.Flow{}, false
	}
	payload := raw[header : header+int(payloadLen)]

	msg, ok := httpparse.Parse(payload)
	if !ok {
		return store.Flow{}, false
	}

	srcIP := emptyIfZeroIP(ipv4String(saddr))
	dstIP := emptyIfZeroIP(ipv4String(daddr))
	port := dport
	if direction == 1 {
		if saddr != 0 {
			dstIP = emptyIfZeroIP(ipv4String(saddr))
		}
		if sport != 0 {
			port = sport
		}
		srcIP = ""
	}
	if port == 0 {
		port = 80
	}

	verdict := "OK"
	if msg.IsResponse && msg.Status >= 500 {
		verdict = "DROPPED"
	} else if msg.IsResponse && msg.Status >= 400 {
		verdict = "RETRY"
	}

	parts := []string{}
	if msg.Method != "" {
		parts = append(parts, msg.Method)
	}
	if msg.Path != "" {
		parts = append(parts, msg.Path)
	}
	if msg.IsResponse && msg.Status > 0 {
		parts = append(parts, fmt.Sprintf("%d", msg.Status))
	}

	ts := time.Unix(0, int64(tsNS)).UTC()
	flow := store.Flow{
		Timestamp:  ts,
		SrcIP:      srcIP,
		DstIP:      dstIP,
		Protocol:   "TCP",
		Port:       port,
		Verdict:    verdict,
		Path:       strings.Join(parts, " "),
		HttpMethod: msg.Method,
		HttpPath:   msg.Path,
	}
	if msg.IsResponse && msg.Status > 0 {
		st := uint16(msg.Status)
		flow.HttpStatus = &st
	}
	return flow, true
}

func ipv4String(n uint32) string {
	ip := net.IPv4(byte(n), byte(n>>8), byte(n>>16), byte(n>>24))
	return ip.String()
}

func emptyIfZeroIP(ip string) string {
	if ip == "0.0.0.0" {
		return ""
	}
	return ip
}
