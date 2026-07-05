import type { SavedStorageSettings, StorageSettingsView } from "../core/types/storage-settings";

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

export async function fetchStorageSettings(): Promise<StorageSettingsView> {
  const response = await fetch(`${apiBase()}/api/settings/storage`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load storage settings (${response.status})`);
  }
  return response.json() as Promise<StorageSettingsView>;
}

export async function saveStorageSettings(
  settings: SavedStorageSettings,
): Promise<StorageSettingsView> {
  const response = await fetch(`${apiBase()}/api/settings/storage`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(`Failed to save storage settings (${response.status})`);
  }
  return response.json() as Promise<StorageSettingsView>;
}

export type { SavedStorageSettings, StorageSettingsView };
