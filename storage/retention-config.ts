import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SavedRetentionSettings } from "../src/core/types/retention-settings";

const SETTINGS_FILE = "retention-config.json";

function settingsPath(dataDir: string): string {
  return path.join(dataDir, SETTINGS_FILE);
}

export async function loadSavedRetentionSettings(
  dataDir: string,
): Promise<SavedRetentionSettings | null> {
  try {
    const raw = await readFile(settingsPath(dataDir), "utf8");
    return JSON.parse(raw) as SavedRetentionSettings;
  } catch {
    return null;
  }
}

export async function saveSavedRetentionSettings(
  dataDir: string,
  settings: SavedRetentionSettings,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath(dataDir), JSON.stringify(settings, null, 2), "utf8");
}
