import type { StorageConfig } from "./config";
import { FileObjectStore } from "./file-object-store";
import type { ObjectStore } from "./object-store";
import { S3ObjectStore } from "./s3-object-store";

export function createObjectStore(config: StorageConfig): ObjectStore {
  if (config.backend === "s3") {
    if (!config.s3) {
      throw new Error("S3 storage config is missing");
    }
    return new S3ObjectStore(config.s3);
  }

  return new FileObjectStore(config.dataDir);
}
