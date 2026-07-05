//go:build linux

package trace

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

type platformTracer struct {
	mode     string
	programs int
	fps      int
}

func newPlatformTracer(mode string) Tracer {
	if mode == "" {
		mode = "proc"
	}
	return &platformTracer{
		mode:     mode,
		programs: 1,
	}
}

func (t *platformTracer) Start(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore) error {
	log.Printf("kernel tracer started (mode=%s)", t.mode)

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			count, err := readProcTCP(resolver, flows)
			if err != nil {
				log.Printf("proc/tcp sample: %v", err)
			} else if count > 0 {
				t.fps = count
			}
		}
	}
}

func readProcTCP(resolver *k8s.Resolver, flows *store.FlowStore) (int, error) {
	data, err := os.ReadFile("/proc/net/tcp")
	if err != nil {
		return 0, err
	}

	now := time.Now().UTC()
	ingested := 0

	for _, line := range strings.Split(string(data), "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		if fields[3] != "01" {
			continue
		}

		srcIP, srcPort, err := decodeHexAddr(fields[1])
		if err != nil {
			continue
		}
		dstIP, dstPort, err := decodeHexAddr(fields[2])
		if err != nil {
			continue
		}

		flow := store.Flow{
			Timestamp: now,
			SrcIP:     srcIP,
			DstIP:     dstIP,
			Protocol:  "TCP",
			Port:      dstPort,
			Verdict:   "OK",
		}

		resolver.Enrich(&flow)
		if flow.SrcPod == "" && flow.DstPod == "" {
			continue
		}

		flows.Upsert(flow)
		ingested++
		_ = srcPort
	}
	return ingested, nil
}

func decodeHexAddr(value string) (string, uint16, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return "", 0, fmt.Errorf("invalid addr %q", value)
	}

	ipRaw, err := strconv.ParseUint(parts[0], 16, 32)
	if err != nil {
		return "", 0, err
	}
	portRaw, err := strconv.ParseUint(parts[1], 16, 16)
	if err != nil {
		return "", 0, err
	}

	ip := make(net.IP, 4)
	ip[0] = byte(ipRaw & 0xff)
	ip[1] = byte((ipRaw >> 8) & 0xff)
	ip[2] = byte((ipRaw >> 16) & 0xff)
	ip[3] = byte((ipRaw >> 24) & 0xff)

	return ip.String(), uint16(portRaw), nil
}

func (t *platformTracer) Status() Status {
	return Status{
		Mode:           t.mode,
		Programs:       t.programs,
		FlowsPerSecond: t.fps,
		Message:        "kernel /proc/net/tcp tracing (host network namespace)",
	}
}
