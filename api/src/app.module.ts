import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { MonitorModule } from "./monitor/monitor.module";
import { SettingsModule } from "./settings/settings.module";

@Module({
  imports: [AuthModule, MonitorModule, SettingsModule],
})
export class AppModule {}
