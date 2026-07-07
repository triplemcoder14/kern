export interface AuthUser {
  id: string;
  username: string;
  name: string;
}

export interface AuthSession {
  authenticated: boolean;
  user?: AuthUser;
}

function apiBase(): string {
  return import.meta.env.VITE_KERN_API_URL ?? "";
}

export async function fetchAuthSession(): Promise<AuthSession> {
  const response = await fetch(`${apiBase()}/api/auth/me`, {
    credentials: "include",
  });
  if (!response.ok) {
    return { authenticated: false };
  }
  return (await response.json()) as AuthSession;
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const response = await fetch(`${apiBase()}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    return { authenticated: false };
  }
  return (await response.json()) as AuthSession;
}

export async function logout(): Promise<void> {
  await fetch(`${apiBase()}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}
