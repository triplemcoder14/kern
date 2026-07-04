import type { WorkerEvent, WorkerRequest, WorkerResponse, WorkerToMain } from "../core/types/rpc";

type EventListener = (event: WorkerEvent) => void;

let requestCounter = 0;

export class ClusterWorkerClient {
  private worker: Worker;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private listeners = new Set<EventListener>();

  constructor() {
    this.worker = new Worker(new URL("../worker/cluster.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
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
          pending.reject(new Error(error ?? "Worker request failed"));
        }
        return;
      }

      if (payload.type === "event") {
        for (const listener of this.listeners) {
          listener(payload.event);
        }
      }
    };

    this.worker.onerror = (error) => {
      for (const listener of this.listeners) {
        listener({ type: "ERROR", message: error.message });
      }
    };
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request<T = unknown>(request: WorkerRequest): Promise<T> {
    const id = `req-${++requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, request });
    });
  }

  subscribe(): Promise<WorkerResponse["data"]> {
    return this.request({ type: "SUBSCRIBE" });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

let client: ClusterWorkerClient | null = null;

export function getClusterWorker(): ClusterWorkerClient {
  if (!client) {
    client = new ClusterWorkerClient();
  }
  return client;
}
