package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/profile"
	"github.com/kern/agent/internal/store"
	"github.com/kern/agent/internal/trace"
)

const AgentVersion = "0.6.0"

type Server struct {
	flows     *store.FlowStore
	tracer    trace.Tracer
	resolver  *k8s.Resolver
	profile   profile.Collector
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

func NewServer(flows *store.FlowStore, tracer trace.Tracer, resolver *k8s.Resolver) *Server {
	return &Server{
		flows:    flows,
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
		},
	})
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	snapshot := s.profile.Snapshot(s.flows)
	writeJSON(w, map[string]interface{}{
		"agent":   "kern-agent",
		"version": AgentVersion,
		"profile": snapshot,
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
