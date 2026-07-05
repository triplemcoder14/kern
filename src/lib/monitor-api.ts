import { io, type Socket } from "socket.io-client";
import type { MonitorWorkerEvent, MonitorWorkerRequest, MonitorWorkerToMain } from "../core/types/monitor-rpc";

type EventListener = (event: MonitorWorkerEvent) => void;

let requestCounter = 0;

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

export class MonitorApiClient {
  private socket: Socket | null = null;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private listeners = new Set<EventListener>();
  private connectPromise: Promise<void> | null = null;

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private ensureSocket(): Promise<void> {
    if (this.socket?.connected) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const socket = io(apiBase(), {
        path: "/monitor/ws",
        transports: ["websocket"],
        autoConnect: true,
      });

      socket.on("connect", () => {
        this.socket = socket;
        resolve(undefined);
      });

      socket.on("connect_error", (error) => {
        reject(error);
      });

      socket.on("monitor", (payload: MonitorWorkerToMain) => {
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
            pending.reject(new Error(error ?? "Monitor API request failed"));
          }
          return;
        }

        for (const listener of this.listeners) {
          listener(payload.event);
        }
      });
    });

    this.connectPromise = promise;
    void promise.finally(() => {
      this.connectPromise = null;
    });

    return promise;
  }

  async request<T = unknown>(request: MonitorWorkerRequest): Promise<T> {
    await this.ensureSocket();
    if (!this.socket) {
      throw new Error("Monitor socket unavailable");
    }

    const id = `monitor-${++requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket?.emit("request", { id, request });
    });
  }

  subscribe(): Promise<unknown> {
    return this.request({ type: "SUBSCRIBE" });
  }

  async initSession(ebpfCollectorUrl?: string): Promise<void> {
    const response = await fetch(`${apiBase()}/api/monitor/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ebpfCollectorUrl }),
    });
    if (!response.ok) {
      throw new Error(`Failed to init monitor session (${response.status})`);
    }
    await this.ensureSocket();
    await this.subscribe();
  }
}

let client: MonitorApiClient | null = null;

export function getMonitorApiClient(): MonitorApiClient {
  if (!client) {
    client = new MonitorApiClient();
  }
  return client;
}
