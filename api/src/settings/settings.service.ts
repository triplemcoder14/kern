import { Injectable } from "@nestjs/common";
import { resolveStorageConfig } from "../../../storage/config";
import type {
  SavedStorageSettings,
  StorageSettingsView,
} from "../../../src/core/types/storage-settings";
import {
  loadSavedStorageSettings,
  saveSavedStorageSettings,
} from "../../../storage/settings-config";

function defaultDataDir(): string {
  return process.env.KERN_DATA_DIR?.trim() || `${process.cwd()}/data`;
}

function toView(config: ReturnType<typeof resolveStorageConfig>): StorageSettingsView {
  if (config.backend === "s3" && config.s3) {
    return {
      backend: "s3",
      dataDir: config.dataDir,
      configured: true,
      s3: {
        endpoint: config.s3.endpoint,
        region: config.s3.region,
        bucket: config.s3.bucket,
        prefix: config.s3.prefix,
        accessKeyId: config.s3.accessKeyId,
        hasSecret: Boolean(config.s3.secretAccessKey),
      },
    };
  }

  return {
    backend: "file",
    dataDir: config.dataDir,
    configured: true,
  };
}

@Injectable()
export class SettingsService {
  async getStorageSettings(): Promise<StorageSettingsView> {
    const dataDir = defaultDataDir();
    const saved = await loadSavedStorageSettings(dataDir);
    const config = resolveStorageConfig(process.env, saved);
    return toView(config);
  }

  async saveStorageSettings(input: SavedStorageSettings): Promise<StorageSettingsView> {
    const dataDir = defaultDataDir();
    const existing = await loadSavedStorageSettings(dataDir);
    const next: SavedStorageSettings = {
      backend: input.backend === "s3" ? "s3" : "file",
      dataDir: input.dataDir?.trim() || dataDir,
      s3:
        input.backend === "s3"
          ? {
              endpoint: input.s3?.endpoint?.trim() || undefined,
              region: input.s3?.region?.trim() || "us-east-1",
              bucket: input.s3?.bucket?.trim() || "",
              prefix: input.s3?.prefix?.trim() || "",
              accessKeyId: input.s3?.accessKeyId?.trim() || existing?.s3?.accessKeyId || "",
              secretAccessKey:
                input.s3?.secretAccessKey?.trim() ||
                existing?.s3?.secretAccessKey ||
                "",
            }
          : undefined,
    };

    await saveSavedStorageSettings(dataDir, next);
    const config = resolveStorageConfig(process.env, next);
    const view = toView(config);
    return { ...view, restartRequired: true };
  }
}
