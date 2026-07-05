//go:build ignore

package hubble

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	flowpb "github.com/cilium/cilium/api/v1/flow"
	observerpb "github.com/cilium/cilium/api/v1/observer"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Client struct {
	relayAddr string
}

func NewClient(relayAddr string) *Client {
	return &Client{relayAddr: relayAddr}
}

func (c *Client) Ping(ctx context.Context) error {
	conn, err := c.dial(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	client := observerpb.NewObserverClient(conn)
	pingCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	_, err = client.ServerStatus(pingCtx, &observerpb.ServerStatusRequest{})
	return err
}

func (c *Client) Stream(ctx context.Context, resolver *k8s.Resolver, flows *store.FlowStore, onBatch func(count int)) error {
	conn, err := c.dial(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	client := observerpb.NewObserverClient(conn)
	stream, err := client.GetFlows(ctx, &observerpb.GetFlowsRequest{
		Number: 64,
		Follow: true,
	})
	if err != nil {
		return fmt.Errorf("get flows: %w", err)
	}

	for {
		response, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		flow := response.GetFlow()
		if flow == nil {
			continue
		}

		record := mapFlow(flow, resolver)
		if record.SrcPod == "" && record.DstPod == "" {
			continue
		}

		flows.Upsert(record)
		onBatch(1)
	}
}

func (c *Client) dial(ctx context.Context) (*grpc.ClientConn, error) {
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	return grpc.DialContext(
		dialCtx,
		c.relayAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
}

func mapFlow(flow *flowpb.Flow, resolver *k8s.Resolver) store.Flow {
	now := time.Now().UTC()
	if ts := flow.GetTime(); ts != nil {
		now = ts.AsTime().UTC()
	}

	srcIP := flow.GetIP().GetSource()
	dstIP := flow.GetIP().GetDestination()
	protocol, port := l4Info(flow)

	record := store.Flow{
		Timestamp: now,
		SrcIP:     srcIP,
		DstIP:     dstIP,
		Protocol:  protocol,
		Port:      port,
		Verdict:   mapVerdict(flow.GetVerdict()),
	}

	if src := endpointFromFlow(flow.GetSource(), srcIP, resolver); src != nil {
		record.SrcPod = src.Name
		record.SrcNamespace = src.Namespace
	}
	if dst := endpointFromFlow(flow.GetDestination(), dstIP, resolver); dst != nil {
		record.DstPod = dst.Name
		record.DstNamespace = dst.Namespace
	}

	resolver.Enrich(&record)
	return record
}

func endpointFromFlow(endpoint *flowpb.Endpoint, ip string, resolver *k8s.Resolver) *k8s.PodRef {
	if endpoint == nil {
		if ref, ok := resolver.Lookup(ip); ok {
			return &ref
		}
		return nil
	}

	if pod := endpoint.GetPodName(); pod != "" {
		return &k8s.PodRef{
			Name:      pod,
			Namespace: endpoint.GetNamespace(),
		}
	}

	for _, label := range endpoint.GetLabels() {
		if strings.HasPrefix(label, "k8s:io.kubernetes.pod.name=") {
			name := strings.TrimPrefix(label, "k8s:io.kubernetes.pod.name=")
			ns := namespaceFromLabels(endpoint.GetLabels())
			return &k8s.PodRef{Name: name, Namespace: ns}
		}
	}

	if ref, ok := resolver.Lookup(ip); ok {
		return &ref
	}
	return nil
}

func namespaceFromLabels(labels []string) string {
	for _, label := range labels {
		if strings.HasPrefix(label, "k8s:io.kubernetes.pod.namespace=") {
			return strings.TrimPrefix(label, "k8s:io.kubernetes.pod.namespace=")
		}
	}
	return "default"
}

func l4Info(flow *flowpb.Flow) (string, uint16) {
	if tcp := flow.GetL4().GetTCP(); tcp != nil {
		return "TCP", uint16(tcp.GetDestinationPort())
	}
	if udp := flow.GetL4().GetUDP(); udp != nil {
		return "UDP", uint16(udp.GetDestinationPort())
	}
	return "UNKNOWN", 0
}

func mapVerdict(verdict flowpb.Verdict) string {
	switch verdict {
	case flowpb.Verdict_FORWARDED, flowpb.Verdict_TRACED:
		return "OK"
	case flowpb.Verdict_DROPPED:
		return "DROPPED"
	case flowpb.Verdict_ERROR:
		return "TIMEOUT"
	default:
		return "UNKNOWN"
	}
}

func DefaultRelayAddr() string {
	return "hubble-relay.kube-system.svc.cluster.local:4245"
}

func StartWithRetry(ctx context.Context, relayAddr string, resolver *k8s.Resolver, flows *store.FlowStore, onBatch func(int)) {
	client := NewClient(relayAddr)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := client.Stream(ctx, resolver, flows, onBatch)
		if err != nil && ctx.Err() == nil {
			log.Printf("hubble stream ended: %v — reconnecting in 3s", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}
}
