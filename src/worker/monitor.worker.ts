import type { MonitorWorkerRequest } from "../core/types/monitor-rpc";
import { MonitorRuntime } from "./monitor-runtime";

const runtime = new MonitorRuntime();

self.onmessage = async (event: MessageEvent<{ id: string; request: MonitorWorkerRequest }>) => {
  const { id, request } = event.data;

  try {
    const data = await runtime.handle(request);
    self.postMessage({
      type: "response",
      response: { id, ok: true, data },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown monitor worker error";
    self.postMessage({
      type: "response",
      response: { id, ok: false, error: message },
    });
    self.postMessage({
      type: "event",
      event: { type: "ERROR", message },
    });
  }
};

runtime.onEvent((workerEvent) => {
  self.postMessage({ type: "event", event: workerEvent });
});

runtime.bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "Monitor bootstrap failed";
  self.postMessage({ type: "event", event: { type: "ERROR", message } });
});
