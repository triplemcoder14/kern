package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/profile"
	"github.com/kern/agent/internal/store"
	"github.com/kern/agent/internal/trace"
)

const AgentVersion = "0.7.0"

type Server struct {
	flows    *store.FlowStore
	tables   *store.TableStore
	tracer   trace.Tracer
	resolver *k8s.Resolver
	profile  profile.Collector
}

type profilePodLookup struct {
	resolver *k8s.Resolver
}

func (p profilePodLookup) LookupPodByUID(uid string) (namespace, name string, ok bool) {
	ref, ok := p.resolver.LookupPodByUID(uid)
	if !ok {
		return "", "", false
	}
	return ref.Namespace, ref.Name, true
}

func NewServer(flows *store.FlowStore, tables *store.TableStore, tracer trace.Tracer, resolver *k8s.Resolver) *Server {
	return &Server{
		flows:    flows,
		tables:   tables,
		tracer:   tracer,
		resolver: resolver,
		profile:  profile.NewCollector(profilePodLookup{resolver: resolver}),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/v1/agent", s.handleAgentInfo)
	mux.HandleFunc("/api/v1/flows", s.handleFlows)
	mux.HandleFunc("/api/v1/flows/stream", s.handleFlowStream)
	mux.HandleFunc("/api/v1/profile", s.handleProfile)
	mux.HandleFunc("/api/v1/tables", s.handleTables)
	mux.HandleFunc("/api/v1/tables/", s.handleTableRows)
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	status := s.tracer.Status()
	writeJSON(w, map[string]interface{}{
		"ok":               true,
		"agent":            "kern-agent",
		"version":          AgentVersion,
		"programs":         status.Programs,
		"flows_per_second": status.FlowsPerSecond,
		"mode":             status.Mode,
		"message":          status.Message,
		"pods_indexed":     s.resolver.PodCount(),
		"services_indexed": s.resolver.ServiceCount(),
	})
}

func (s *Server) handleAgentInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status := s.tracer.Status()
	writeJSON(w, map[string]interface{}{
		"name":             "kern-agent",
		"version":          AgentVersion,
		"api_version":      "v1",
		"mode":             status.Mode,
		"flows_per_second": status.FlowsPerSecond,
		"pods_indexed":     s.resolver.PodCount(),
		"services_indexed": s.resolver.ServiceCount(),
		"endpoints": map[string]string{
			"health":       "/health",
			"flows":        "/api/v1/flows",
			"flow_stream":  "/api/v1/flows/stream",
			"agent_info":   "/api/v1/agent",
			"profile":      "/api/v1/profile",
			"tables":       "/api/v1/tables",
		},
	})
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	snapshot := s.profile.Snapshot(s.flows)
	if s.tables != nil {
		for _, frame := range snapshot.CPUStack {
			s.tables.Append(store.TableCPUStacks, store.Row{
				"node":  snapshot.NodeName,
				"label": frame.Label,
				"depth": frame.Depth,
				"width": frame.Width,
				"heat":  frame.Heat,
				"kind":  frame.Kind,
				"source": snapshot.StackSource,
			})
		}
	}
	writeJSON(w, map[string]interface{}{
		"agent":   "kern-agent",
		"version": AgentVersion,
		"profile": snapshot,
	})
}

func (s *Server) handleTables(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path != "/api/v1/tables" && r.URL.Path != "/api/v1/tables/" {
		s.handleTableRows(w, r)
		return
	}

	tables := []map[string]interface{}{}
	if s.tables != nil {
		for _, name := range s.tables.Names() {
			table, ok := s.tables.Get(name)
			if !ok {
				continue
			}
			count := table.Len()
			if name == store.TableFlows {
				count = len(s.flows.Snapshot(0))
			}
			tables = append(tables, map[string]interface{}{
				"name": name,
				"rows": count,
			})
		}
	}
	writeJSON(w, map[string]interface{}{
		"agent":  "kern-agent",
		"tables": tables,
	})
}

func (s *Server) handleTableRows(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/v1/tables/")
	name = strings.Trim(name, "/")
	if name == "" {
		http.NotFound(w, r)
		return
	}

	limit := 200
	if name == store.TableFlows {
		snapshot := s.flows.Snapshot(limit)
		rows := make([]map[string]interface{}, 0, len(snapshot))
		for _, flow := range snapshot {
			rows = append(rows, flowToJSON(flow))
		}
		writeJSON(w, map[string]interface{}{
			"table": name,
			"rows":  rows,
		})
		return
	}

	if s.tables == nil {
		http.NotFound(w, r)
		return
	}
	table, ok := s.tables.Get(name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, map[string]interface{}{
		"table": name,
		"rows":  table.Snapshot(limit),
	})
}

func (s *Server) handleFlows(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	limit := 200
	snapshot := s.flows.Snapshot(limit)
	out := make([]map[string]interface{}, 0, len(snapshot))
	for _, flow := range snapshot {
		out = append(out, flowToJSON(flow))
	}

	writeJSON(w, map[string]interface{}{
		"agent":   "kern-agent",
		"version": AgentVersion,
		"flows":   out,
	})
}

func (s *Server) handleFlowStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	lastSignature := ""
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			snapshot := s.flows.Snapshot(50)
			payload, err := json.Marshal(map[string]interface{}{
				"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
				"flows":     flowsToJSON(snapshot),
			})
			if err != nil {
				continue
			}

			signature := string(payload)
			if signature == lastSignature {
				fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
				continue
			}
			lastSignature = signature

			fmt.Fprintf(w, "event: flows\ndata: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func flowsToJSON(snapshot []store.Flow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(snapshot))
	for _, flow := range snapshot {
		out = append(out, flowToJSON(flow))
	}
	return out
}

func flowToJSON(flow store.Flow) map[string]interface{} {
	item := map[string]interface{}{
		"timestamp":  flow.Timestamp.UTC().Format(time.RFC3339Nano),
		"first_seen": flow.FirstSeen.UTC().Format(time.RFC3339Nano),
		"last_seen":  flow.LastSeen.UTC().Format(time.RFC3339Nano),
		"src_ip":     flow.SrcIP,
		"dst_ip":     flow.DstIP,
		"protocol":   flow.Protocol,
		"port":       flow.Port,
	}
	setOptional(item, "src_pod", flow.SrcPod)
	setOptional(item, "dst_pod", flow.DstPod)
	setOptional(item, "src_namespace", flow.SrcNamespace)
	setOptional(item, "dst_namespace", flow.DstNamespace)
	setOptional(item, "src_service", flow.SrcService)
	setOptional(item, "src_service_namespace", flow.SrcServiceNamespace)
	setOptional(item, "dst_service", flow.DstService)
	setOptional(item, "dst_service_namespace", flow.DstServiceNamespace)
	setOptional(item, "path", flow.Path)
	setOptional(item, "verdict", flow.Verdict)
	if flow.LatencyMs != nil {
		item["latency_ms"] = *flow.LatencyMs
	}
	if flow.BytesSent != nil {
		item["bytes_sent"] = *flow.BytesSent
	}
	if flow.BytesReceived != nil {
		item["bytes_received"] = *flow.BytesReceived
	}
	if flow.Retransmits != nil {
		item["retransmits"] = *flow.Retransmits
	}
	// setOptional(item, "tcp_state", flow.TcpState)
	// setOptional(item, "tcp_event", flow.TcpEvent)
	setOptional(item, "tcp_state", flow.TcpState)
	setOptional(item, "tcp_event", flow.TcpEvent)
	setOptional(item, "dns_query", flow.DnsQuery)
	setOptional(item, "dns_type", flow.DnsType)
	setOptional(item, "dns_rcode", flow.DnsRcode)
	if len(flow.DnsAnswers) > 0 {
		item["dns_answers"] = flow.DnsAnswers
	}
	if flow.DnsTxid != 0 {
		item["dns_txid"] = flow.DnsTxid
	}
	setOptional(item, "http_method", flow.HttpMethod)
	setOptional(item, "http_path", flow.HttpPath)
	if flow.HttpStatus != nil {
		item["http_status"] = *flow.HttpStatus
	}
	return item
}

func setOptional(item map[string]interface{}, key, value string) {
	if value != "" {
		item[key] = value
	}
}

func writeJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
