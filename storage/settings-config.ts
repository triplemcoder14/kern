import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SavedStorageSettings } from "../src/core/types/storage-settings";

export type { SavedStorageSettings, StorageSettingsView } from "../src/core/types/storage-settings";

const SETTINGS_FILE = "storage-config.json";

function settingsPath(dataDir: string): string {
  return path.join(dataDir, SETTINGS_FILE);
}

export async function loadSavedStorageSettings(dataDir: string): Promise<SavedStorageSettings | null> {
  try {
    const raw = await readFile(settingsPath(dataDir), "utf8");
    return JSON.parse(raw) as SavedStorageSettings;
  } catch {
    return null;
  }
}

export async function saveSavedStorageSettings(
  dataDir: string,
  settings: SavedStorageSettings,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath(dataDir), JSON.stringify(settings, null, 2), "utf8");
}
