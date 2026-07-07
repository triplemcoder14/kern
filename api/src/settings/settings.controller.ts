import { Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import type { SavedStorageSettings, StorageSettingsView } from "../../../src/core/types/storage-settings";
import { AuthGuard } from "../auth/auth.guard";
import { SettingsService } from "./settings.service";

@Controller("settings")
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settingsService: SettingsService) {}

  @Get("storage")
  getStorage(): Promise<StorageSettingsView> {
    return this.settingsService.getStorageSettings();
  }

  @Put("storage")
  saveStorage(@Body() body: SavedStorageSettings): Promise<StorageSettingsView> {
    return this.settingsService.saveStorageSettings(body);
  }
}
