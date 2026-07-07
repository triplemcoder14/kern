import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { ConnectClusterInput } from "../../../src/core/types/monitoring";
import { AuthGuard } from "../auth/auth.guard";
import { MonitorService } from "./monitor.service";

@Controller("monitor")
export class MonitorController {
  constructor(@Inject(MonitorService) private readonly monitorService: MonitorService) {}

  @Get("health")
  health() {
    return { ok: true, service: "kern-api" };
  }

  @UseGuards(AuthGuard)
  @Post("session")
  session(@Body() body: { ebpfCollectorUrl?: string }) {
    return this.monitorService.handle({
      type: "SET_ORIGIN",
      origin: process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
      ebpfCollectorUrl: body.ebpfCollectorUrl,
    });
  }

  @UseGuards(AuthGuard)
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

  @UseGuards(AuthGuard)
  @Post("disconnect")
  disconnect() {
    return this.monitorService.handle({ type: "DISCONNECT" });
  }

  @UseGuards(AuthGuard)
  @Get("snapshot")
  snapshot() {
    return this.monitorService.handle({ type: "GET_SNAPSHOT" });
  }

  @UseGuards(AuthGuard)
  @Get("profile")
  profile(@Query("node") nodeName?: string) {
    return this.monitorService.handle({ type: "GET_PROFILE", nodeName });
  }

  @UseGuards(AuthGuard)
  @Get("snapshots/history")
  snapshotHistory() {
    return this.monitorService.recentSnapshots(30);
  }

  @UseGuards(AuthGuard)
  @Post("incidents/:id/resolve")
  resolveIncident(@Param("id") incidentId: string) {
    return this.monitorService.handle({ type: "RESOLVE_INCIDENT", incidentId });
  }
}
