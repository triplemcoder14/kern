import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStore } from "./object-store";

export class FileObjectStore implements ObjectStore {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    return path.join(this.rootDir, key);
  }

  async readText(key: string): Promise<string | null> {
    try {
      return await readFile(this.resolve(key), "utf8");
    } catch {
      return null;
    }
  }

  async writeText(key: string, body: string): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body, "utf8");
  }

  async listKeys(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.posix.join(prefix.replace(/\\/g, "/"), entry.name));
    } catch {
      return [];
    }
  }

  async deleteKey(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // Missing keys are fine during retention sweeps.
    }
  }
}
