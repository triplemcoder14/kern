import type { SavedStorageSettings, StorageBackend } from "../src/core/types/storage-settings";

export type { StorageBackend };

export interface StorageConfig {
  backend: StorageBackend;
  dataDir: string;
  s3?: {
    endpoint?: string;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function defaultDataDir(env: NodeJS.ProcessEnv): string {
  return env.KERN_DATA_DIR?.trim() || `${process.cwd()}/data`;
}

function s3FromEnv(env: NodeJS.ProcessEnv, dataDir: string): StorageConfig {
  const bucket = env.KERN_S3_BUCKET?.trim();
  const accessKeyId = env.KERN_S3_ACCESS_KEY_ID?.trim() ?? env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    env.KERN_S3_SECRET_ACCESS_KEY?.trim() ?? env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "KERN_STORAGE_BACKEND=s3 requires KERN_S3_BUCKET, KERN_S3_ACCESS_KEY_ID, and KERN_S3_SECRET_ACCESS_KEY",
    );
  }

  return {
    backend: "s3",
    dataDir,
    s3: {
      endpoint: env.KERN_S3_ENDPOINT?.trim() || env.AWS_ENDPOINT_URL?.trim() || undefined,
      region: env.KERN_S3_REGION?.trim() || env.AWS_REGION?.trim() || "us-east-1",
      bucket,
      prefix: trimSlash(env.KERN_S3_PREFIX?.trim() ?? ""),
      accessKeyId,
      secretAccessKey,
    },
  };
}

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const dataDir = defaultDataDir(env);
  const backend = env.KERN_STORAGE_BACKEND === "s3" ? "s3" : "file";

  if (backend !== "s3") {
    return { backend, dataDir };
  }

  return s3FromEnv(env, dataDir);
}

export function resolveStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
  saved?: SavedStorageSettings | null,
): StorageConfig {
  const dataDir = saved?.dataDir?.trim() || defaultDataDir(env);
  const backend = saved?.backend ?? (env.KERN_STORAGE_BACKEND === "s3" ? "s3" : "file");

  if (backend !== "s3") {
    return { backend: "file", dataDir };
  }

  const savedS3 = saved?.s3;
  const bucket = savedS3?.bucket?.trim() || env.KERN_S3_BUCKET?.trim();
  const accessKeyId =
    savedS3?.accessKeyId?.trim() ||
    env.KERN_S3_ACCESS_KEY_ID?.trim() ||
    env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    savedS3?.secretAccessKey?.trim() ||
    env.KERN_S3_SECRET_ACCESS_KEY?.trim() ||
    env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!bucket || !accessKeyId || !secretAccessKey) {
    return { backend: "file", dataDir };
  }

  return {
    backend: "s3",
    dataDir,
    s3: {
      endpoint:
        savedS3?.endpoint?.trim() ||
        env.KERN_S3_ENDPOINT?.trim() ||
        env.AWS_ENDPOINT_URL?.trim() ||
        undefined,
      region:
        savedS3?.region?.trim() ||
        env.KERN_S3_REGION?.trim() ||
        env.AWS_REGION?.trim() ||
        "us-east-1",
      bucket,
      prefix: trimSlash(savedS3?.prefix?.trim() ?? env.KERN_S3_PREFIX?.trim() ?? ""),
      accessKeyId,
      secretAccessKey,
    },
  };
}
