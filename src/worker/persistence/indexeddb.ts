import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { K8sResource } from "../../core/types/k8s";

interface ClusterDB extends DBSchema {
  resources: {
    key: string;
    value: K8sResource;
  };
}

const DB_NAME = "port-of-k8s";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ClusterDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ClusterDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ClusterDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("resources")) {
          db.createObjectStore("resources");
        }
      },
    });
  }
  return dbPromise;
}

function storageKey(resource: K8sResource): string {
  const namespace = resource.kind === "Namespace" ? "" : (resource.metadata.namespace ?? "default");
  return `${resource.kind}/${namespace}/${resource.metadata.name}`;
}

export async function loadResourcesFromDb(): Promise<K8sResource[]> {
  const db = await getDb();
  return db.getAll("resources");
}

export async function saveResourceToDb(resource: K8sResource): Promise<void> {
  const db = await getDb();
  await db.put("resources", resource, storageKey(resource));
}

export async function deleteResourceFromDb(
  kind: string,
  namespace: string,
  name: string,
): Promise<void> {
  const db = await getDb();
  await db.delete("resources", `${kind}/${namespace}/${name}`);
}

export async function clearDb(): Promise<void> {
  const db = await getDb();
  await db.clear("resources");
}

export async function syncStoreToDb(resources: K8sResource[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("resources", "readwrite");
  await tx.store.clear();
  for (const resource of resources) {
    await tx.store.put(resource, storageKey(resource));
  }
  await tx.done;
}
