//go:build linux

package trace

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
)

func readProcSockets(path, protocol string, requireEstablished bool, resolver *k8s.Resolver, flows *store.FlowStore) (int, error) {
	data, err := os.ReadFile(path)
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
		if requireEstablished && fields[3] != "01" {
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
			Protocol:  protocol,
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
