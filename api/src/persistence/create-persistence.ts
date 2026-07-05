import { createObjectStore } from "../../../storage/create-object-store";
import { resolveStorageConfig } from "../../../storage/config";
import { loadSavedStorageSettings } from "../../../storage/settings-config";
import { MonitorPersistenceImpl } from "./file-persistence";

export async function createMonitorPersistence(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MonitorPersistenceImpl> {
  const dataDir = env.KERN_DATA_DIR?.trim() || `${process.cwd()}/data`;
  const saved = await loadSavedStorageSettings(dataDir);
  const config = resolveStorageConfig(env, saved);
  const store = createObjectStore(config);
  return new MonitorPersistenceImpl(store);
}
