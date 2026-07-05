import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Inject } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import type {
  MonitorWorkerRequest,
  MonitorWorkerToMain,
} from "../../../src/core/types/monitor-rpc";
import { MonitorService } from "./monitor.service";

@WebSocketGateway({
  cors: {
    origin: process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  },
  path: "/monitor/ws",
})
export class MonitorGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(@Inject(MonitorService) private readonly monitorService: MonitorService) {}

  handleConnection(client: Socket): void {
    const unsubscribe = this.monitorService.onEvent((event) => {
      client.emit("monitor", { type: "event", event } satisfies MonitorWorkerToMain);
    });

    client.on("disconnect", () => {
      unsubscribe();
    });
  }

  @SubscribeMessage("request")
  async handleRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { id: string; request: MonitorWorkerRequest },
  ): Promise<void> {
    const { id, request } = payload;

    try {
      const data = await this.monitorService.handle(request);
      client.emit("monitor", {
        type: "response",
        response: { id, ok: true, data },
      } satisfies MonitorWorkerToMain);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Monitor request failed";
      client.emit("monitor", {
        type: "response",
        response: { id, ok: false, error: message },
      } satisfies MonitorWorkerToMain);
      client.emit("monitor", {
        type: "event",
        event: { type: "ERROR", message },
      } satisfies MonitorWorkerToMain);
    }
  }
}
