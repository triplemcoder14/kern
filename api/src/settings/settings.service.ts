import { Injectable, OnModuleInit } from "@nestjs/common";
import { resolveStorageConfig } from "../../../storage/config";
import type {
  SavedStorageSettings,
  StorageSettingsView,
} from "../../../src/core/types/storage-settings";
import type {
  RetentionSettingsView,
  SavedRetentionSettings,
} from "../../../src/core/types/retention-settings";
import {
  loadSavedStorageSettings,
  saveSavedStorageSettings,
} from "../../../storage/settings-config";
import {
  loadSavedRetentionSettings,
  saveSavedRetentionSettings,
} from "../../../storage/retention-config";
import { applySavedRetention, policyToSaved } from "../../../storage/retention";

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

function clampRetention(input: SavedRetentionSettings): SavedRetentionSettings {
  return {
    maxEventAgeHours: Math.min(168, Math.max(0, Math.floor(input.maxEventAgeHours))),
    maxEvents: Math.min(5000, Math.max(50, Math.floor(input.maxEvents))),
    maxIncidents: Math.min(1000, Math.max(10, Math.floor(input.maxIncidents))),
    maxSnapshots: Math.min(500, Math.max(10, Math.floor(input.maxSnapshots))),
    maxFlows: Math.min(2000, Math.max(50, Math.floor(input.maxFlows))),
    maxSnapshotFlows: Math.min(500, Math.max(20, Math.floor(input.maxSnapshotFlows))),
  };
}

@Injectable()
export class SettingsService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    const dataDir = defaultDataDir();
    const saved = await loadSavedRetentionSettings(dataDir);
    applySavedRetention(saved);
  }

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

  async getRetentionSettings(): Promise<RetentionSettingsView> {
    const dataDir = defaultDataDir();
    const saved = await loadSavedRetentionSettings(dataDir);
    const applied = applySavedRetention(saved);
    return { ...policyToSaved(applied), applied };
  }

  async saveRetentionSettings(input: SavedRetentionSettings): Promise<RetentionSettingsView> {
    const dataDir = defaultDataDir();
    const next = clampRetention(input);
    await saveSavedRetentionSettings(dataDir, next);
    const applied = applySavedRetention(next);
    return { ...policyToSaved(applied), applied };
  }
}
