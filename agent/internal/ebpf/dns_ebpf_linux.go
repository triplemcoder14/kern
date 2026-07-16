//go:build linux && ebpf

package ebpf

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 dns ../../bpf/dns.c -- -I../../bpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/kern/agent/internal/dns"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

const dnsProgramCount = 6

// DnsSampler captures UDP DNS payloads via sendto/sendmsg and recvfrom/recvmsg.
type DnsSampler struct {
	objs   dnsObjects
	links  []link.Link
	reader *ringbuf.Reader
	fps    int
}

func NewDnsSampler() (*DnsSampler, error) {
	objs := dnsObjects{}
	if err := loadDnsObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("load dns bpf: %w", err)
	}

	var links []link.Link
	cleanup := func() {
		for _, l := range links {
			_ = l.Close()
		}
		_ = objs.Close()
	}

	attach := func(name string, prog *ebpf.Program) error {
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

	reader, err := ringbuf.NewReader(objs.KernDnsEvents)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("dns ringbuf: %w", err)
	}

	return &DnsSampler{objs: objs, links: links, reader: reader}, nil
}

func (s *DnsSampler) Close() {
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

func (s *DnsSampler) FlowsPerSecond() int {
	if s == nil {
		return 0
	}
	return s.fps
}

func (s *DnsSampler) ProgramCount() int {
	return dnsProgramCount
}

func (s *DnsSampler) Run(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("eBPF DNS sampler attached (sendto/sendmsg + recvfrom/recvmsg, UDP :53 payloads)")

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
			log.Printf("dns ringbuf read: %v", err)
			continue
		}

		flow, ok := decodeDnsEvent(record.RawSample)
		if !ok {
			continue
		}

		dnsPath := flow.Path
		// Connected UDP sockets often omit sockaddr; recover the client pod via cgroup.
		resolver.EnrichClientFromPID(&flow, flowPID(record.RawSample))
		// Drop server-side CoreDNS identity — those syscalls are the resolver, not the client.
		if isDNSResolverPod(flow.SrcPod, flow.SrcNamespace) {
			flow.SrcPod = ""
			flow.SrcNamespace = ""
			flow.SrcIP = ""
			flow.SrcService = ""
			flow.SrcServiceNamespace = ""
		}
		resolver.Enrich(&flow)
		if isDNSResolverPod(flow.SrcPod, flow.SrcNamespace) {
			flow.SrcPod = ""
			flow.SrcNamespace = ""
			flow.SrcIP = ""
			flow.SrcService = ""
			flow.SrcServiceNamespace = ""
		}
		if dnsPath != "" {
			if flow.Path != "" {
				flow.Path = dnsPath + " · " + flow.Path
			} else {
				flow.Path = dnsPath
			}
		}
		flows.Upsert(flow)
		s.fps++
	}
}

func isDNSResolverPod(name, namespace string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "coredns") ||
		(namespace == "kube-system" && (n == "kube-dns" || strings.HasPrefix(n, "kube-dns-")))
}

func flowPID(raw []byte) uint32 {
	if len(raw) < 12 {
		return 0
	}
	return binary.LittleEndian.Uint32(raw[8:12])
}

func decodeDnsEvent(raw []byte) (store.Flow, bool) {
	const header = 28
	if len(raw) < header {
		return store.Flow{}, false
	}

	tsNS := binary.LittleEndian.Uint64(raw[0:8])
	// pid := binary.LittleEndian.Uint32(raw[8:12]) // used via flowPID after decode
	saddr := binary.LittleEndian.Uint32(raw[12:16])
	daddr := binary.LittleEndian.Uint32(raw[16:20])
	sport := binary.LittleEndian.Uint16(raw[20:22])
	dport := binary.LittleEndian.Uint16(raw[22:24])
	direction := raw[24]
	payloadLen := binary.LittleEndian.Uint16(raw[26:28])
	if int(payloadLen) > len(raw)-header {
		payloadLen = uint16(len(raw) - header)
	}
	if payloadLen < 12 {
		return store.Flow{}, false
	}
	payload := raw[header : header+int(payloadLen)]

	msg, ok := dns.Parse(payload)
	if !ok {
		return store.Flow{}, false
	}

	srcIP := emptyIfZeroIP(ipv4String(saddr))
	dstIP := emptyIfZeroIP(ipv4String(daddr))

	port := uint16(53)
	if direction == 0 {
		if dport != 0 {
			port = dport
		}
	} else {
		// Response: sockaddr points at the DNS server, not the client.
		// Keep SrcIP empty here; EnrichClientFromPID fills the client pod.
		if saddr != 0 {
			dstIP = emptyIfZeroIP(ipv4String(saddr))
		}
		if sport != 0 {
			port = sport
		}
		// srcIP = ""
		srcIP = ""
	}

	verdict := "OK"
	if msg.QR {
		switch msg.Rcode {
		case 0, 3:
			verdict = "OK"
		default:
			verdict = "DROPPED"
		}
	}

	rcode := ""
	if msg.QR {
		rcode = msg.RcodeName
	}

	pathParts := []string{}
	if msg.Query != "" {
		pathParts = append(pathParts, msg.Query)
	}
	if msg.QTypeName != "" {
		pathParts = append(pathParts, msg.QTypeName)
	}
	if rcode != "" {
		pathParts = append(pathParts, rcode)
	}

	ts := time.Unix(0, int64(tsNS)).UTC()
	return store.Flow{
		Timestamp:  ts,
		SrcIP:      srcIP,
		DstIP:      dstIP,
		Protocol:   "UDP",
		Port:       port,
		Verdict:    verdict,
		Path:       strings.Join(pathParts, " · "),
		DnsQuery:   msg.Query,
		DnsType:    msg.QTypeName,
		DnsRcode:   rcode,
		DnsAnswers: msg.Answers,
		DnsTxid:    msg.Txid,
	}, true
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
