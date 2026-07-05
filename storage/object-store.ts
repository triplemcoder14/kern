export interface ObjectStore {
  readText(key: string): Promise<string | null>;
  writeText(key: string, body: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
}
