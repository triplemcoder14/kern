import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { ConnectClusterInput } from "../../../src/core/types/monitoring";
import type { MonitorWorkerEvent, MonitorWorkerRequest } from "../../../src/core/types/monitor-rpc";
import { MonitorRuntime } from "../../../src/worker/monitor-runtime";
import { createMonitorPersistence } from "../persistence/create-persistence";
import type { MonitorPersistenceImpl } from "../persistence/file-persistence";

function serverConnectInput(input: ConnectClusterInput): ConnectClusterInput {
  return {
    ...input,
    proxyUrl: input.proxyUrl?.startsWith("http")
      ? input.proxyUrl
      : (process.env.KERN_K8S_PROXY ?? "http://127.0.0.1:8001"),
    ebpfCollectorUrl:
      input.ebpfCollectorUrl?.trim() ||
      process.env.KERN_EBPF_COLLECTOR ||
      "http://127.0.0.1:9474",
    origin: input.origin ?? process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
  };
}

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private persistence!: MonitorPersistenceImpl;
  runtime!: MonitorRuntime;
  private listeners = new Set<(event: MonitorWorkerEvent) => void>();
  private unsubscribe: (() => void) | null = null;

  async onModuleInit(): Promise<void> {
    this.persistence = await createMonitorPersistence();
    this.runtime = new MonitorRuntime(this.persistence);
    this.unsubscribe = this.runtime.onEvent((event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
    await this.runtime.bootstrap();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  onEvent(listener: (event: MonitorWorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  handle(request: MonitorWorkerRequest): Promise<unknown> {
    if (request.type === "CONNECT") {
      return this.runtime.handle({
        type: "CONNECT",
        input: serverConnectInput(request.input),
      });
    }

    if (request.type === "SET_ORIGIN") {
      return this.runtime.handle({
        type: "SET_ORIGIN",
        origin: request.origin ?? process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
        ebpfCollectorUrl:
          request.ebpfCollectorUrl?.trim() ||
          process.env.KERN_EBPF_COLLECTOR ||
          "http://127.0.0.1:9474",
      });
    }

    return this.runtime.handle(request);
  }

  recentSnapshots(limit = 30) {
    return this.persistence.recentSnapshots(limit);
  }
}
