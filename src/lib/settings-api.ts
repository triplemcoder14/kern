import type { SavedStorageSettings, StorageSettingsView } from "../core/types/storage-settings";
import type {
  RetentionSettingsView,
  SavedRetentionSettings,
} from "../core/types/retention-settings";

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

export async function fetchRetentionSettings(): Promise<RetentionSettingsView> {
  const response = await fetch(`${apiBase()}/api/settings/retention`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load retention settings (${response.status})`);
  }
  return response.json() as Promise<RetentionSettingsView>;
}

export async function saveRetentionSettings(
  settings: SavedRetentionSettings,
): Promise<RetentionSettingsView> {
  const response = await fetch(`${apiBase()}/api/settings/retention`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(`Failed to save retention settings (${response.status})`);
  }
  return response.json() as Promise<RetentionSettingsView>;
}

export type {
  SavedStorageSettings,
  StorageSettingsView,
  SavedRetentionSettings,
  RetentionSettingsView,
};
