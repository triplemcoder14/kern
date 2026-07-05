package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kern/agent/internal/api"
	"github.com/kern/agent/internal/k8s"
	"github.com/kern/agent/internal/store"
	"github.com/kern/agent/internal/trace"
)

const defaultHubbleRelay = "hubble-relay.kube-system.svc.cluster.local:4245"

func main() {
	addr := flag.String("addr", ":9474", "listen address")
	mode := flag.String("mode", "auto", "flow source: auto, proc, hubble")
	hubbleRelay := flag.String("hubble-relay", envOr("HUBBLE_RELAY", defaultHubbleRelay), "Hubble relay gRPC address")
	flag.Parse()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	flows := store.NewFlowStore()
	tracer := trace.NewTracer(*mode, *hubbleRelay)

	resolver, err := k8s.NewResolver()
	if err != nil {
		log.Printf("k8s resolver unavailable, using noop: %v", err)
		resolver = k8s.NewNoopResolver()
	}

	go func() {
		if err := resolver.Start(ctx); err != nil && ctx.Err() == nil {
			log.Printf("resolver stopped: %v", err)
		}
	}()

	go func() {
		if err := tracer.Start(ctx, resolver, flows); err != nil && ctx.Err() == nil {
			log.Printf("tracer stopped: %v", err)
		}
	}()

	server := api.NewServer(flows, tracer, resolver)
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("KERN agent listening on %s (api v1)", *addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
	log.Printf("agent stopped")
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
