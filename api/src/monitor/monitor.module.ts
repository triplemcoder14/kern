import { Module } from "@nestjs/common";
import { MonitorController } from "./monitor.controller";
import { MonitorGateway } from "./monitor.gateway";
import { MonitorService } from "./monitor.service";

@Module({
  controllers: [MonitorController],
  providers: [MonitorService, MonitorGateway],
  exports: [MonitorService],
})
export class MonitorModule {}
