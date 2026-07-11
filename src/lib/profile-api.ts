import type { ProfileSnapshot } from "../core/types/profiling";

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

export async function fetchProfileSnapshot(nodeName?: string): Promise<ProfileSnapshot> {
  const query = nodeName ? `?node=${encodeURIComponent(nodeName)}` : "";
  const response = await fetch(`${apiBase()}/api/monitor/profile${query}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load node profile (${response.status})`);
  }
  return (await response.json()) as ProfileSnapshot;
}
