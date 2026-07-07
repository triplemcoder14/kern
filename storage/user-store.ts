import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredUser } from "../src/core/types/user";
import { hashPassword, verifyPassword } from "./password";

const USERS_FILE = "users.json";

interface UserStoreShape {
  users: StoredUser[];
}

const EMPTY_STORE: UserStoreShape = { users: [] };

function usersPath(dataDir: string): string {
  return path.join(dataDir, USERS_FILE);
}

function defaultDataDir(): string {
  return process.env.KERN_DATA_DIR?.trim() || `${process.cwd()}/data`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

async function readStore(dataDir: string): Promise<UserStoreShape> {
  try {
    const raw = await readFile(usersPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as UserStoreShape;
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch {
    return { ...EMPTY_STORE };
  }
}

async function writeStore(dataDir: string, store: UserStoreShape): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(usersPath(dataDir), JSON.stringify(store, null, 2), "utf8");
}

export async function bootstrapInstallUser(username: string, password: string): Promise<StoredUser | null> {
  const dataDir = defaultDataDir();
  const store = await readStore(dataDir);
  if (store.users.length > 0) {
    return null;
  }

  const normalized = normalizeUsername(username);
  const timestamp = nowIso();
  const created: StoredUser = {
    id: `local:${normalized}`,
    username: normalized,
    name: username.trim() || normalized,
    passwordHash: hashPassword(password),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: timestamp,
  };
  store.users.push(created);
  await writeStore(dataDir, store);
  return created;
}

export async function authenticateLocalUser(
  username: string,
  password: string,
): Promise<StoredUser | null> {
  const store = await readStore(defaultDataDir());
  const normalized = normalizeUsername(username);
  const user = store.users.find((item) => item.username === normalized);
  if (!user) {
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return null;
  }

  const dataDir = defaultDataDir();
  const timestamp = nowIso();
  const next: StoredUser = {
    ...user,
    lastLoginAt: timestamp,
    updatedAt: timestamp,
  };
  const updatedStore = await readStore(dataDir);
  updatedStore.users = updatedStore.users.map((item) => (item.id === user.id ? next : item));
  await writeStore(dataDir, updatedStore);
  return next;
}

export async function getUserById(userId: string): Promise<StoredUser | null> {
  const store = await readStore(defaultDataDir());
  return store.users.find((user) => user.id === userId) ?? null;
}
