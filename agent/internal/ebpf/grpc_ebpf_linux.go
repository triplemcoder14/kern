//go:build linux && ebpf

package ebpf

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 grpc ../../bpf/grpc.c -- -I../../bpf

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
	"github.com/kern/agent/internal/grpcparse"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

const grpcProgramCount = 6

// GrpcSampler captures plaintext gRPC/HTTP2 payload fragments via send*/recv* syscalls.
type GrpcSampler struct {
	objs   grpcObjects
	links  []link.Link
	reader *ringbuf.Reader
	fps    int
}

func NewGrpcSampler() (*GrpcSampler, error) {
	objs := grpcObjects{}
	if err := loadGrpcObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("load grpc bpf: %w", err)
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

	reader, err := ringbuf.NewReader(objs.KernGrpcEvents)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("grpc ringbuf: %w", err)
	}

	return &GrpcSampler{objs: objs, links: links, reader: reader}, nil
}

func (s *GrpcSampler) Close() {
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

func (s *GrpcSampler) FlowsPerSecond() int {
	if s == nil {
		return 0
	}
	return s.fps
}

func (s *GrpcSampler) ProgramCount() int {
	return grpcProgramCount
}

func (s *GrpcSampler) Run(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("eBPF gRPC sampler attached (sendto/sendmsg + recvfrom/recvmsg, plaintext gRPC/HTTP2)")

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
			log.Printf("grpc ringbuf read: %v", err)
			continue
		}

		flow, ok := decodeGrpcEvent(record.RawSample)
		if !ok {
			continue
		}

		grpcPath := flow.Path
		resolver.Enrich(&flow)
		if grpcPath != "" {
			if flow.Path != "" {
				flow.Path = grpcPath + " · " + flow.Path
			} else {
				flow.Path = grpcPath
			}
		}
		flows.Upsert(flow)
		s.fps++
	}
}

func decodeGrpcEvent(raw []byte) (store.Flow, bool) {
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
	if payloadLen < 9 {
		return store.Flow{}, false
	}
	payload := raw[header : header+int(payloadLen)]

	msg, ok := grpcparse.Parse(payload)
	if !ok {
		return store.Flow{}, false
	}

	srcIP := emptyIfZeroIPGrpc(ipv4StringGrpc(saddr))
	dstIP := emptyIfZeroIPGrpc(ipv4StringGrpc(daddr))
	port := dport
	if direction == 1 {
		if saddr != 0 {
			dstIP = emptyIfZeroIPGrpc(ipv4StringGrpc(saddr))
		}
		if sport != 0 {
			port = sport
		}
		srcIP = ""
	}
	if port == 0 {
		port = 50051
	}

	verdict := "OK"
	if msg.Status != nil {
		switch *msg.Status {
		case 0:
			verdict = "OK"
		case 4:
			verdict = "TIMEOUT"
		case 8, 14:
			verdict = "RETRY"
		default:
			if *msg.Status != 0 {
				verdict = "DROPPED"
			}
		}
	}

	parts := []string{}
	if msg.Method != "" {
		parts = append(parts, msg.Method)
	}
	if msg.Status != nil {
		parts = append(parts, fmt.Sprintf("grpc-status=%d(%s)", *msg.Status, grpcparse.StatusName(*msg.Status)))
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
		GrpcMethod: msg.Method,
	}
	if msg.Status != nil {
		st := uint16(*msg.Status)
		flow.GrpcStatus = &st
	}
	return flow, true
}

func ipv4StringGrpc(n uint32) string {
	ip := net.IPv4(byte(n), byte(n>>8), byte(n>>16), byte(n>>24))
	return ip.String()
}

func emptyIfZeroIPGrpc(ip string) string {
	if ip == "0.0.0.0" {
		return ""
	}
	return ip
}
