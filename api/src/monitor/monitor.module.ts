import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MonitorController } from "./monitor.controller";
import { MonitorGateway } from "./monitor.gateway";
import { MonitorService } from "./monitor.service";

@Module({
  imports: [AuthModule],
  controllers: [MonitorController],
  providers: [MonitorService, MonitorGateway],
  exports: [MonitorService],
})
export class MonitorModule {}
