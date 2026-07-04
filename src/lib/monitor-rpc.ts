import type { MonitorWorkerRequest, MonitorWorkerToMain } from "../core/types/monitor-rpc";
import type { MonitorWorkerEvent } from "../core/types/monitor-rpc";

type EventListener = (event: MonitorWorkerEvent) => void;

let requestCounter = 0;

export class MonitorWorkerClient {
  private worker: Worker;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private listeners = new Set<EventListener>();

  constructor() {
    this.worker = new Worker(new URL("../worker/monitor.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (event: MessageEvent<MonitorWorkerToMain>) => {
      const payload = event.data;
      if (payload.type === "response") {
        const { id, ok, data, error } = payload.response;
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        if (ok) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error ?? "Monitor worker request failed"));
        }
        return;
      }

      if (payload.type === "event") {
        for (const listener of this.listeners) {
          listener(payload.event);
        }
      }
    };
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request<T = unknown>(request: MonitorWorkerRequest): Promise<T> {
    const id = `monitor-${++requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, request });
    });
  }

  subscribe(): Promise<unknown> {
    return this.request({ type: "SUBSCRIBE" });
  }
}

let client: MonitorWorkerClient | null = null;

export function getMonitorWorker(): MonitorWorkerClient {
  if (!client) {
    client = new MonitorWorkerClient();
  }
  return client;
}
