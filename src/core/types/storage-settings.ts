export type StorageBackend = "file" | "s3";

export interface SavedStorageSettings {
  backend: StorageBackend;
  dataDir?: string;
  s3?: {
    endpoint?: string;
    region?: string;
    bucket?: string;
    prefix?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

export interface StorageSettingsView {
  backend: StorageBackend;
  dataDir: string;
  configured: boolean;
  s3?: {
    endpoint?: string;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId?: string;
    hasSecret: boolean;
  };
  restartRequired?: boolean;
}
