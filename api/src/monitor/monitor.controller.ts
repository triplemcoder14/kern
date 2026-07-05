import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import type { ConnectClusterInput } from "../../../src/core/types/monitoring";
import { MonitorService } from "./monitor.service";

@Controller("monitor")
export class MonitorController {
  constructor(@Inject(MonitorService) private readonly monitorService: MonitorService) {}

  @Get("health")
  health() {
    return { ok: true, service: "kern-api" };
  }

  @Post("session")
  session(@Body() body: { ebpfCollectorUrl?: string }) {
    return this.monitorService.handle({
      type: "SET_ORIGIN",
      origin: process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
      ebpfCollectorUrl: body.ebpfCollectorUrl,
    });
  }

  @Post("connect")
  connect(@Body() body: ConnectClusterInput) {
    const proxyUrl = body.proxyUrl ?? process.env.KERN_K8S_PROXY ?? "http://127.0.0.1:8001";
    const ebpfCollectorUrl =
      body.ebpfCollectorUrl ?? process.env.KERN_EBPF_COLLECTOR ?? "http://127.0.0.1:9474";

    return this.monitorService.handle({
      type: "CONNECT",
      input: {
        ...body,
        proxyUrl,
        ebpfCollectorUrl,
        origin: process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
      },
    });
  }

  @Post("disconnect")
  disconnect() {
    return this.monitorService.handle({ type: "DISCONNECT" });
  }

  @Get("snapshot")
  snapshot() {
    return this.monitorService.handle({ type: "GET_SNAPSHOT" });
  }

  @Get("profile")
  profile(@Query("node") nodeName?: string) {
    return this.monitorService.handle({ type: "GET_PROFILE", nodeName });
  }

  @Get("snapshots/history")
  snapshotHistory() {
    return this.monitorService.recentSnapshots(30);
  }

  @Post("incidents/:id/resolve")
  resolveIncident(@Param("id") incidentId: string) {
    return this.monitorService.handle({ type: "RESOLVE_INCIDENT", incidentId });
  }
}
